const { app, BrowserWindow, Tray, Menu, nativeImage, desktopCapturer, ipcMain, session, shell } = require('electron')
const fs = require('fs/promises')
const http = require('http')
const path = require('path')
const { Readable } = require('stream')
const ytdl = require('@distube/ytdl-core')

let mainWindow = null
let tray = null
let isQuitting = false
let rendererServer = null
let rendererServerUrl = null
let musicPlayerServer = null
let musicPlayerServerUrl = null
let musicWindow = null
let musicWindowReadyPromise = null
let musicStatePollInterval = null

const DEFAULT_MUSIC_STATE = {
    songId: null,
    currentTime: 0,
    duration: 0,
    playerState: -1,
    isMuted: true,
    isReady: false,
    videoId: null,
}
let musicPlaybackState = { ...DEFAULT_MUSIC_STATE }

const YOUTUBE_SEARCH_BASE = 'https://www.youtube.com/results?hl=tr&gl=TR&persist_hl=1&persist_gl=1&has_verified=1&bpctr=9999999999&search_query='
const YOUTUBE_SEARCH_FALLBACK_BASE = 'https://r.jina.ai/http://www.youtube.com/results?hl=tr&gl=TR&persist_hl=1&persist_gl=1&has_verified=1&bpctr=9999999999&search_query='
const SEARCH_TIMEOUT_MS = 3000
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000
const AUDIO_SOURCE_CACHE_TTL_MS = 10 * 60 * 1000
const ALLOWED_PERMISSIONS = new Set([
    'audioCapture',
    'clipboard-sanitized-write',
    'display-capture',
    'fullscreen',
    'media',
    'mediaKeySystem',
    'videoCapture',
])
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', 'cshub.vercel.app'])
const TRUSTED_EMBED_HOST_SUFFIXES = [
    'youtube.com',
    'youtu.be',
    'googlevideo.com',
    'ytimg.com',
    'youtube-nocookie.com',
]
const YOUTUBE_CONSENT_COOKIES = [
    {
        url: 'https://www.youtube.com',
        name: 'CONSENT',
        value: 'YES+cb.20210328-17-p0.en+FX+111',
    },
    {
        url: 'https://www.youtube.com',
        name: 'SOCS',
        value: 'CAI',
    },
    {
        url: 'https://www.youtube.com',
        name: 'PREF',
        value: 'hl=tr&gl=TR',
    },
    {
        url: 'https://www.youtube-nocookie.com',
        name: 'CONSENT',
        value: 'YES+cb.20210328-17-p0.en+FX+111',
    },
]
const searchCache = new Map()
const pendingSearches = new Map()
const audioSourceCache = new Map()
const audioProxyEntries = new Map()
const DIST_DIR = path.join(__dirname, '../dist')
const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function getDesktopFriendlyUserAgent() {
    return app.userAgentFallback.replace(/\sElectron\/[^\s]+/i, '')
}

function getYouTubeCookieHeader() {
    return 'CONSENT=YES+cb.20210328-17-p0.en+FX+111; SOCS=CAI; PREF=hl=tr&gl=TR'
}

function extractYouTubeVideoIdFromUrl(value) {
    if (typeof value !== 'string') return null

    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
        /[?&]v=([A-Za-z0-9_-]{11})/i,
        /\/embed\/([A-Za-z0-9_-]{11})/i,
    ]

    for (const pattern of patterns) {
        const match = value.match(pattern)
        if (match?.[1]) return match[1]
    }

    return null
}

async function resolveYouTubeAudioSource(url) {
    const videoId = extractYouTubeVideoIdFromUrl(url)
    if (!videoId) {
        console.error('ytdl: Could not extract video ID from URL:', url)
        return null
    }

    const now = Date.now()
    const cached = audioSourceCache.get(videoId)
    if (cached && cached.expiresAt > now) {
        return cached.value
    }

    let info
    try {
        info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8',
                    cookie: getYouTubeCookieHeader(),
                    origin: 'https://www.youtube.com',
                    referer: 'https://www.youtube.com/',
                    'user-agent': getDesktopFriendlyUserAgent(),
                },
            },
        })
    } catch (error) {
        console.error('ytdl.getInfo FAILED for', url, ':', error?.message || error)
        return null
    }

    const candidateFormats = info.formats.filter((format) => format.hasAudio && typeof format.url === 'string' && format.url.length > 0)

    if (candidateFormats.length === 0) {
        console.error('ytdl: No audio formats found for', url, '- total formats:', info.formats.length)
        return null
    }

    let selectedFormat = null
    try {
        selectedFormat = ytdl.chooseFormat(candidateFormats, { quality: 'highestaudio', filter: 'audioonly' })
    } catch {
        const audioOnly = candidateFormats
            .filter((format) => format.hasAudio && !format.hasVideo)
            .sort((left, right) => (right.audioBitrate || 0) - (left.audioBitrate || 0))

        selectedFormat = audioOnly[0] || candidateFormats.sort((left, right) => (right.bitrate || 0) - (left.bitrate || 0))[0] || null
    }

    if (!selectedFormat?.url) {
        console.error('ytdl: Selected format has no stream URL for', url)
        return null
    }

    const resolved = {
        streamUrl: selectedFormat.url,
        videoId: info.videoDetails.videoId || videoId,
        duration: Number(info.videoDetails.lengthSeconds || 0),
        title: info.videoDetails.title || undefined,
    }

    audioSourceCache.set(videoId, {
        value: resolved,
        expiresAt: now + AUDIO_SOURCE_CACHE_TTL_MS,
    })

    return resolved
}

function createAudioProxyUrl(streamUrl, videoId) {
    const token = `${videoId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
    audioProxyEntries.set(token, {
        streamUrl,
        expiresAt: Date.now() + AUDIO_SOURCE_CACHE_TTL_MS,
    })
    return token
}

function buildMusicPlayerHtml() {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>CsHub Music Player</title>
    <style>
      html, body, #audio {
        width: 100%;
        height: 100%;
        margin: 0;
        background: #000;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <audio id="audio" preload="auto"></audio>
    <script>
      (() => {
        const audio = document.getElementById('audio')
        let playerReady = false
        let currentVideoId = null
        let currentSongId = null
        let mutedState = true
        let playerState = -1

        const emit = (type, payload) => {
          console.log(type + JSON.stringify(payload))
        }

        const getSnapshot = () => {
          const currentTime = playerReady ? Number(audio.currentTime || 0) : 0
          const duration = playerReady ? Number(audio.duration || 0) : 0
          return {
            songId: currentSongId,
            currentTime: Number.isFinite(currentTime) ? currentTime : 0,
            duration: Number.isFinite(duration) ? duration : 0,
            playerState,
            isMuted: mutedState,
            isReady: playerReady,
            videoId: currentVideoId,
          }
        }

        const emitState = () => emit('__CSHUB_MUSIC_STATE__', getSnapshot())

        const destroyPlayer = () => {
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
          playerReady = false
          playerState = -1
        }

        const createPlayer = async (streamUrl, videoId, songId, startAt = 0, muted = true) => {
          destroyPlayer()

          currentVideoId = videoId
          currentSongId = songId ?? null
          mutedState = Boolean(muted)

          audio.currentTime = 0
          audio.muted = mutedState
          audio.src = streamUrl
          playerState = 3
          emitState()
          audio.load()

          const attemptPlayback = async () => {
            try {
              if (startAt > 0 && Number.isFinite(startAt)) {
                audio.currentTime = startAt
              }
            } catch {}

            try {
              await audio.play()
            } catch (error) {
              emit('__CSHUB_MUSIC_ERROR__', { code: 'play-failed', message: String(error), songId: currentSongId, videoId: currentVideoId })
            }
          }

          if (audio.readyState >= 1) {
            playerReady = true
            await attemptPlayback()
          } else {
            audio.addEventListener('loadedmetadata', () => {
              playerReady = true
              void attemptPlayback()
              emitState()
            }, { once: true })
          }
        }

        audio.addEventListener('playing', () => {
          playerReady = true
          playerState = 1
          emitState()
        })

        audio.addEventListener('pause', () => {
          if (audio.ended) return
          playerState = 2
          emitState()
        })

        audio.addEventListener('waiting', () => {
          playerState = 3
          emitState()
        })

        audio.addEventListener('stalled', () => {
          playerState = 3
          emitState()
        })

        audio.addEventListener('ended', () => {
          playerState = 0
          emitState()
        })

        audio.addEventListener('error', () => {
          const mediaError = audio.error
          emit('__CSHUB_MUSIC_ERROR__', {
            code: mediaError?.code || 'audio-error',
            message: mediaError?.message || 'Audio element failed to play',
            songId: currentSongId,
            videoId: currentVideoId,
          })
        })

        window.__CSHUB_PLAYER__ = {
          getSnapshot,
          async play({ streamUrl, videoId, songId, startAt = 0, muted = true }) {
            if (!streamUrl || !videoId) return false
            await createPlayer(streamUrl, videoId, songId, startAt, muted)
            return true
          },
          pause(seconds) {
            if (!audio.src) return false
            if (typeof seconds === 'number' && Number.isFinite(seconds)) {
              try {
                audio.currentTime = seconds
              } catch {}
            }
            audio.pause()
            emitState()
            return true
          },
          resume(seconds) {
            if (!audio.src) return false
            if (typeof seconds === 'number' && Number.isFinite(seconds)) {
              try {
                audio.currentTime = seconds
              } catch {}
            }
            void audio.play().catch((error) => {
              emit('__CSHUB_MUSIC_ERROR__', { code: 'resume-failed', message: String(error), songId: currentSongId, videoId: currentVideoId })
            })
            emitState()
            return true
          },
          seek(seconds) {
            if (!audio.src || !Number.isFinite(seconds)) return false
            try {
              audio.currentTime = seconds
            } catch {
              return false
            }
            emitState()
            return true
          },
          setMuted(muted) {
            mutedState = Boolean(muted)
            audio.muted = mutedState
            emitState()
            return true
          },
          stop() {
            destroyPlayer()
            currentVideoId = null
            currentSongId = null
            mutedState = true
            emitState()
            return true
          },
        }

        window.setInterval(emitState, 500)
      })()
    </script>
  </body>
</html>`
}

function broadcastMusicState() {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('music:state-change', musicPlaybackState)
}

function resetMusicState() {
    musicPlaybackState = { ...DEFAULT_MUSIC_STATE }
    broadcastMusicState()
}

async function ensureMusicWindow() {
    if (musicWindow && !musicWindow.isDestroyed()) {
        return musicWindow
    }

    if (musicWindowReadyPromise) {
        await musicWindowReadyPromise
        return musicWindow
    }

    musicWindow = new BrowserWindow({
        show: true,
        width: 1,
        height: 1,
        x: -10000,
        y: -10000,
        frame: false,
        transparent: true,
        backgroundColor: '#000000',
        resizable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        focusable: false,
        skipTaskbar: true,
        webPreferences: {
            autoplayPolicy: 'no-user-gesture-required',
            backgroundThrottling: false,
            contextIsolation: true,
            sandbox: false,
        },
    })
    musicWindow.setIgnoreMouseEvents(true)
    musicWindow.setVisibleOnAllWorkspaces(false)
    musicWindow.webContents.setAudioMuted(false)
    musicWindow.webContents.setUserAgent(getDesktopFriendlyUserAgent())
    musicWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    musicWindow.on('closed', () => {
        musicWindow = null
        musicWindowReadyPromise = null
        if (musicStatePollInterval !== null) {
            clearInterval(musicStatePollInterval)
            musicStatePollInterval = null
        }
        resetMusicState()
    })
    musicWindow.webContents.on('console-message', (_event, _level, message) => {
        if (typeof message !== 'string') return

        if (message.startsWith('__CSHUB_MUSIC_STATE__')) {
            try {
                musicPlaybackState = {
                    ...DEFAULT_MUSIC_STATE,
                    ...JSON.parse(message.slice('__CSHUB_MUSIC_STATE__'.length)),
                }
                broadcastMusicState()
            } catch (error) {
                console.error('Failed to parse music player state:', error)
            }
            return
        }

        if (message.startsWith('__CSHUB_MUSIC_ERROR__')) {
            console.error('Hidden music player error:', message.slice('__CSHUB_MUSIC_ERROR__'.length))
            return
        }

        if (message.startsWith('__CSHUB_MUSIC_WARN__')) {
            console.warn('Hidden music player warning:', message.slice('__CSHUB_MUSIC_WARN__'.length))
        }
    })

    musicWindowReadyPromise = startMusicPlayerServer().then((pageUrl) => musicWindow.loadURL(pageUrl)).then(async () => {
        await musicWindow.webContents.executeJavaScript(
            `new Promise((resolve) => {
                const check = () => {
                    if (window.__CSHUB_PLAYER__) {
                        resolve(true)
                        return
                    }
                    window.setTimeout(check, 25)
                }
                check()
            })`,
            true,
        )

        if (musicStatePollInterval !== null) {
            clearInterval(musicStatePollInterval)
        }
        musicStatePollInterval = setInterval(async () => {
            if (!musicWindow || musicWindow.isDestroyed()) return
            try {
                const snapshot = await musicWindow.webContents.executeJavaScript(
                    'window.__CSHUB_PLAYER__ ? window.__CSHUB_PLAYER__.getSnapshot() : null',
                    true,
                )
                if (snapshot) {
                    musicPlaybackState = { ...DEFAULT_MUSIC_STATE, ...snapshot }
                    broadcastMusicState()
                }
            } catch {}
        }, 500)
        return musicWindow
    }).finally(() => {
        musicWindowReadyPromise = null
    })

    await musicWindowReadyPromise
    return musicWindow
}

async function executeMusicCommand(script) {
    const win = await ensureMusicWindow()
    if (!win || win.isDestroyed()) return false

    try {
        return await win.webContents.executeJavaScript(script, true)
    } catch (error) {
        console.error('Music command failed:', error)
        return false
    }
}

function extractFirstYouTubeVideoId(value) {
    const patterns = [
        /https?:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i,
        /https?:\/\/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i,
        /\/watch\?v=([A-Za-z0-9_-]{11})/i,
        /\\"videoId\\":\\"([A-Za-z0-9_-]{11})\\"/i,
        /watch\?v=([A-Za-z0-9_-]{11})/i,
        /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/i,
        /"videoId":"([A-Za-z0-9_-]{11})"/i,
    ]

    for (const pattern of patterns) {
        const match = value.match(pattern)
        if (match && match[1]) {
            return match[1]
        }
    }

    return null
}

function sanitizeSearchTitle(value) {
    if (typeof value !== 'string' || !value) return undefined

    return value
        .replace(/\\u0026/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&amp;/g, '&')
        .trim()
}

function extractFirstYouTubeTitle(value) {
    const headingMatch = value.match(/### \[(.+?)\]\(http:\/\/www\.youtube\.com\/watch\?v=/i)
    if (headingMatch && headingMatch[1]) {
        return sanitizeSearchTitle(headingMatch[1])
    }

    const titleMatch = value.match(/"title":\{"runs":\[\{"text":"(.+?)"/i)
    if (titleMatch && titleMatch[1]) {
        return sanitizeSearchTitle(titleMatch[1])
    }

    return undefined
}

async function requestSearchPayload(baseUrl, query) {
    const normalizedQuery = query.trim()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

    try {
        const response = await fetch(`${baseUrl}${encodeURIComponent(normalizedQuery)}`, {
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8',
                cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+111',
                referer: 'https://www.youtube.com/',
                'user-agent': 'Mozilla/5.0',
            },
            signal: controller.signal,
        })

        if (!response.ok) return null
        return await response.text()
    } finally {
        clearTimeout(timeout)
    }
}

function parseSearchPayload(payload) {
    const videoId = extractFirstYouTubeVideoId(payload)
    if (!videoId) return null

    return {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: extractFirstYouTubeTitle(payload),
    }
}

async function resolveYouTubeSearch(query) {
    if (typeof query !== 'string' || !query.trim()) {
        return null
    }

    const normalizedQuery = query.trim()
    const cacheKey = normalizedQuery.toLocaleLowerCase('tr-TR')
    const now = Date.now()
    const cached = searchCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
        return cached.value
    }

    const pending = pendingSearches.get(cacheKey)
    if (pending) {
        return pending
    }

    const searchPromise = (async () => {
        const primaryPayload = await requestSearchPayload(YOUTUBE_SEARCH_BASE, normalizedQuery)
        const primaryResult = primaryPayload ? parseSearchPayload(primaryPayload) : null
        if (primaryResult) {
            searchCache.set(cacheKey, {
                value: primaryResult,
                expiresAt: now + SEARCH_CACHE_TTL_MS,
            })
            return primaryResult
        }

        const fallbackPayload = await requestSearchPayload(YOUTUBE_SEARCH_FALLBACK_BASE, normalizedQuery)
        const fallbackResult = fallbackPayload ? parseSearchPayload(fallbackPayload) : null
        if (fallbackResult) {
            searchCache.set(cacheKey, {
                value: fallbackResult,
                expiresAt: now + SEARCH_CACHE_TTL_MS,
            })
            return fallbackResult
        }

        return null
    })()

    pendingSearches.set(cacheKey, searchPromise)
    try {
        return await searchPromise
    } finally {
        pendingSearches.delete(cacheKey)
    }
}

function getContentType(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function getHostFromUrl(urlValue) {
    if (!urlValue || typeof urlValue !== 'string') return null

    try {
        return new URL(urlValue).hostname.toLowerCase()
    } catch {
        return null
    }
}

function isAllowedEmbedHost(hostname) {
    if (!hostname) return false
    return TRUSTED_EMBED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

function isTrustedRequestingHost(hostname, permission) {
    if (!hostname) return false

    // Allow localhost or trusted production hosts
    if (LOCAL_HOSTS.has(hostname) || hostname.includes('vercel.app')) {
        return true
    }

    // YouTube iframe and stream hosts need media/fullscreen rights for playback.
    if ((permission === 'media' || permission === 'fullscreen') && isAllowedEmbedHost(hostname)) {
        return true
    }

    return false
}

function appendCookieHeader(existingValue, requiredCookies) {
    const existing = typeof existingValue === 'string'
        ? existingValue.split(';').map((part) => part.trim()).filter(Boolean)
        : []
    const merged = new Map()

    for (const cookie of existing) {
        const [name, ...rest] = cookie.split('=')
        if (!name) continue
        merged.set(name.trim(), rest.join('=').trim())
    }

    for (const cookie of requiredCookies) {
        const [name, ...rest] = cookie.split('=')
        if (!name) continue
        merged.set(name.trim(), rest.join('=').trim())
    }

    return Array.from(merged.entries()).map(([name, value]) => `${name}=${value}`).join('; ')
}

async function primeYouTubeSessionCookies(targetSession) {
    await Promise.all(
        YOUTUBE_CONSENT_COOKIES.map((cookie) => targetSession.cookies.set({
            ...cookie,
            secure: true,
            sameSite: 'no_restriction',
            expirationDate: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365),
        }).catch((error) => {
            console.error('Failed to prime YouTube session cookie:', cookie.name, error)
        })),
    )
}

async function serveRendererRequest(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const requestPath = decodeURIComponent(url.pathname)
    const normalizedPath = requestPath === '/'
        ? 'index.html'
        : path.normalize(requestPath)
            .replace(/^([\\/])+/, '')
            .replace(/^(\.\.(?:[\\/]|$))+/, '')

    let filePath = path.join(DIST_DIR, normalizedPath)

    try {
        const stats = await fs.stat(filePath)
        if (stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html')
        }
    } catch {
        if (!path.extname(filePath)) {
            filePath = path.join(DIST_DIR, 'index.html')
        }
    }

    try {
        const body = await fs.readFile(filePath)
        res.writeHead(200, { 'Content-Type': getContentType(filePath) })
        res.end(body)
    } catch (error) {
        console.error('Renderer asset load failed:', filePath, error)
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
    }
}

async function startMusicPlayerServer() {
    if (musicPlayerServerUrl) return musicPlayerServerUrl

    musicPlayerServerUrl = await new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')

            if (requestUrl.pathname === '/stream') {
                const token = requestUrl.searchParams.get('token') || ''
                const entry = audioProxyEntries.get(token)
                if (!entry || entry.expiresAt <= Date.now()) {
                    audioProxyEntries.delete(token)
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
                    res.end('Audio source expired')
                    return
                }

                try {
                    const upstreamHeaders = {
                        'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8',
                        referer: 'https://www.youtube.com/',
                        'user-agent': getDesktopFriendlyUserAgent(),
                    }

                    if (typeof req.headers.range === 'string' && req.headers.range.trim().length > 0) {
                        upstreamHeaders.range = req.headers.range
                    }

                    const upstreamResponse = await fetch(entry.streamUrl, {
                        headers: upstreamHeaders,
                    })

                    if (!upstreamResponse.ok || !upstreamResponse.body) {
                        res.writeHead(upstreamResponse.status || 502, { 'Content-Type': 'text/plain; charset=utf-8' })
                        res.end('Upstream audio stream failed')
                        return
                    }

                    const responseHeaders = {
                        'Accept-Ranges': upstreamResponse.headers.get('accept-ranges') || 'bytes',
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'no-store',
                        'Content-Type': upstreamResponse.headers.get('content-type') || 'audio/webm',
                    }

                    const contentLength = upstreamResponse.headers.get('content-length')
                    const contentRange = upstreamResponse.headers.get('content-range')
                    if (contentLength) {
                        responseHeaders['Content-Length'] = contentLength
                    }
                    if (contentRange) {
                        responseHeaders['Content-Range'] = contentRange
                    }

                    res.writeHead(upstreamResponse.status, responseHeaders)
                    Readable.fromWeb(upstreamResponse.body).pipe(res)
                } catch (error) {
                    console.error('Audio proxy request failed:', error)
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
                    res.end('Audio proxy failed')
                }
                return
            }

            res.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/html; charset=utf-8',
            })
            res.end(buildMusicPlayerHtml())
        })

        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (!address || typeof address === 'string') {
                reject(new Error('Failed to start music player server'))
                return
            }

            musicPlayerServer = server
            resolve(`http://127.0.0.1:${address.port}`)
        })
    })

    return musicPlayerServerUrl
}

async function startRendererServer() {
    if (rendererServerUrl) return rendererServerUrl

    rendererServerUrl = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            void serveRendererRequest(req, res)
        })

        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (!address || typeof address === 'string') {
                reject(new Error('Failed to start renderer server'))
                return
            }

            rendererServer = server
            resolve(`http://127.0.0.1:${address.port}`)
        })
    })

    return rendererServerUrl
}

async function createWindow() {
    const isDev = !app.isPackaged

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 940,
        minHeight: 560,
        title: 'CsHub',
        backgroundColor: '#0a0a0f',
        frame: false,
        titleBarStyle: 'hidden',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
    })

    mainWindow.webContents.setUserAgent(getDesktopFriendlyUserAgent())

    mainWindow.once('ready-to-show', () => {
        mainWindow.show()
    })

    const startUrl = isDev
        ? 'http://localhost:3000'
        : await startRendererServer()

    void mainWindow.loadURL(startUrl)

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error('Renderer failed to load:', { errorCode, errorDescription, validatedURL })
    })

    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level >= 2) {
            console.error('Renderer console:', { level, message, line, sourceId })
        }
    })

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url)
        return { action: 'deny' }
    })

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault()
            mainWindow.hide()
        }
    })

    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window:maximized-change', true)
    })

    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('window:maximized-change', false)
    })

    if (isDev) {
        mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
}

function createTray() {
    const iconSize = 16
    const icon = nativeImage.createEmpty()
    const canvas = Buffer.alloc(iconSize * iconSize * 4, 0)
    for (let y = 0; y < iconSize; y++) {
        for (let x = 0; x < iconSize; x++) {
            const i = (y * iconSize + x) * 4
            const cx = x - iconSize / 2
            const cy = y - iconSize / 2
            if (cx * cx + cy * cy <= (iconSize / 2 - 1) * (iconSize / 2 - 1)) {
                canvas[i] = 88
                canvas[i + 1] = 101
                canvas[i + 2] = 242
                canvas[i + 3] = 255
            }
        }
    }
    const trayIcon = nativeImage.createFromBuffer(canvas, { width: iconSize, height: iconSize })

    tray = new Tray(trayIcon)
    tray.setToolTip('CsHub')

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'CsHub\'u Ac',
            click: () => {
                if (mainWindow) {
                    mainWindow.show()
                    mainWindow.focus()
                }
            },
        },
        { type: 'separator' },
        {
            label: 'Cikis',
            click: () => {
                isQuitting = true
                app.quit()
            },
        },
    ])

    tray.setContextMenu(contextMenu)

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show()
            mainWindow.focus()
        }
    })
}

// Window control IPC
ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize()
    } else {
        mainWindow?.maximize()
    }
})

ipcMain.handle('window:close', () => {
    mainWindow?.close()
})

ipcMain.handle('window:is-maximized', () => {
    return mainWindow?.isMaximized() ?? false
})

ipcMain.handle('app:get-version', () => app.getVersion())
ipcMain.handle('app:open-external', (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        return false
    }

    void shell.openExternal(url)
    return true
})

ipcMain.handle('music:resolve-youtube-search', async (_event, query) => {
    try {
        return await resolveYouTubeSearch(query)
    } catch (error) {
        console.error('Failed to resolve YouTube search in main process:', error)
        return null
    }
})

ipcMain.handle('music:resolve-audio-source', async (_event, url) => {
    try {
        const resolved = await resolveYouTubeAudioSource(url)
        if (!resolved?.streamUrl || !resolved.videoId) return null

        const baseUrl = await startMusicPlayerServer()
        const token = createAudioProxyUrl(resolved.streamUrl, resolved.videoId)

        return {
            ...resolved,
            proxyUrl: `${baseUrl}/stream?token=${encodeURIComponent(token)}`,
        }
    } catch (error) {
        console.error('Failed to resolve audio source in main process:', error)
        return null
    }
})

ipcMain.handle('music:play', async (_event, payload) => {
    if (!payload?.url || !payload?.songId) {
        console.error('music:play - Missing url or songId in payload')
        return false
    }

    console.log('music:play - Attempting to play:', payload.url, 'songId:', payload.songId)

    let audioSource = null
    try {
        audioSource = await resolveYouTubeAudioSource(payload.url)
    } catch (error) {
        console.error('music:play - ytdl-core resolution threw:', error?.message || error)
        return false
    }

    if (!audioSource?.streamUrl || !audioSource.videoId) {
        console.error('music:play - ytdl-core returned empty/invalid audio source for:', payload.url)
        return false
    }

    console.log('music:play - Audio source resolved, videoId:', audioSource.videoId)

    const baseUrl = await startMusicPlayerServer()
    const token = createAudioProxyUrl(audioSource.streamUrl, audioSource.videoId)

    return executeMusicCommand(
        `window.__CSHUB_PLAYER__.play(${JSON.stringify({
            streamUrl: `${baseUrl}/stream?token=${encodeURIComponent(token)}`,
            videoId: audioSource.videoId,
            songId: payload.songId,
            startAt: payload.startAt ?? 0,
            muted: payload.muted ?? true,
        })})`,
    )
})

ipcMain.handle('music:pause', async (_event, seconds) => {
    return executeMusicCommand(`window.__CSHUB_PLAYER__.pause(${JSON.stringify(seconds)})`)
})

ipcMain.handle('music:resume', async (_event, seconds) => {
    return executeMusicCommand(`window.__CSHUB_PLAYER__.resume(${JSON.stringify(seconds)})`)
})

ipcMain.handle('music:seek', async (_event, seconds) => {
    return executeMusicCommand(`window.__CSHUB_PLAYER__.seek(${JSON.stringify(seconds)})`)
})

ipcMain.handle('music:stop', async () => {
    const stopped = await executeMusicCommand('window.__CSHUB_PLAYER__.stop()')
    if (stopped) {
        resetMusicState()
    }
    return stopped
})

ipcMain.handle('music:set-muted', async (_event, muted) => {
    return executeMusicCommand(`window.__CSHUB_PLAYER__.setMuted(${JSON.stringify(Boolean(muted))})`)
})

ipcMain.handle('music:get-state', async () => {
    return musicPlaybackState
})

app.whenReady().then(() => {
    void primeYouTubeSessionCookies(session.defaultSession)

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const hostname = getHostFromUrl(details.url)
        if (!isAllowedEmbedHost(hostname)) {
            callback({ requestHeaders: details.requestHeaders })
            return
        }

        const requestHeaders = { ...details.requestHeaders }
        const requiredCookies = [
            'CONSENT=YES+cb.20210328-17-p0.en+FX+111',
            'SOCS=CAI',
            'PREF=hl=tr&gl=TR',
        ]

        requestHeaders['User-Agent'] = getDesktopFriendlyUserAgent()
        requestHeaders['Referer'] = 'https://www.youtube.com/'
        requestHeaders['Origin'] = 'https://www.youtube.com'
        requestHeaders['Cookie'] = appendCookieHeader(requestHeaders['Cookie'] ?? requestHeaders['cookie'], requiredCookies)

        callback({ requestHeaders })
    })

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        if (!ALLOWED_PERMISSIONS.has(permission)) {
            callback(false)
            return
        }

        const requestingHost = getHostFromUrl(details?.requestingUrl) ??
            getHostFromUrl(details?.embeddingOrigin) ??
            getHostFromUrl(webContents?.getURL?.())

        if (!requestingHost) {
            callback(permission === 'media' || permission === 'fullscreen' || permission === 'mediaKeySystem')
            return
        }

        callback(isTrustedRequestingHost(requestingHost, permission))
    })

    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        if (!ALLOWED_PERMISSIONS.has(permission)) {
            return false
        }

        const requestingHost = getHostFromUrl(requestingOrigin) ?? getHostFromUrl(webContents?.getURL?.())
        if (!requestingHost) {
            return permission === 'media' || permission === 'fullscreen' || permission === 'mediaKeySystem'
        }

        return isTrustedRequestingHost(requestingHost, permission)
    })

    if (typeof session.defaultSession.setDevicePermissionHandler === 'function') {
        session.defaultSession.setDevicePermissionHandler((_details) => true)
    }

    session.defaultSession.setDisplayMediaRequestHandler(
        async (_request, callback) => {
            try {
                const sources = await desktopCapturer.getSources({
                    types: ['screen', 'window'],
                    thumbnailSize: { width: 0, height: 0 },
                })

                callback({ video: sources[0] })
            } catch (error) {
                console.error('Display capture handler failed:', error)
                callback({})
            }
        },
        { useSystemPicker: true },
    )

    createTray()
    void createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        } else if (mainWindow) {
            mainWindow.show()
        }
    })
})

app.on('before-quit', () => {
    isQuitting = true
    if (musicStatePollInterval !== null) {
        clearInterval(musicStatePollInterval)
        musicStatePollInterval = null
    }
    if (musicWindow && !musicWindow.isDestroyed()) {
        musicWindow.destroy()
        musicWindow = null
    }
    musicPlayerServer?.close()
    musicPlayerServer = null
    musicPlayerServerUrl = null
    rendererServer?.close()
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
