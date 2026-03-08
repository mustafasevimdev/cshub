const { app, BrowserWindow, Tray, Menu, nativeImage, desktopCapturer, ipcMain, session, shell } = require('electron')
const fs = require('fs/promises')
const http = require('http')
const path = require('path')

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
const ALLOWED_PERMISSIONS = new Set([
    'audioCapture',
    'clipboard-sanitized-write',
    'display-capture',
    'fullscreen',
    'media',
    'mediaKeySystem',
    'videoCapture',
])
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
const TRUSTED_EMBED_HOST_SUFFIXES = [
    'youtube.com',
    'youtu.be',
    'googlevideo.com',
    'ytimg.com',
]
const searchCache = new Map()
const pendingSearches = new Map()
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

function buildMusicPlayerHtml() {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>CsHub Music Player</title>
    <style>
      html, body, #player {
        width: 100%;
        height: 100%;
        margin: 0;
        background: #000;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="player"></div>
    <script>
      (() => {
        let player = null
        let playerReady = false
        let currentVideoId = null
        let currentSongId = null
        let mutedState = true
        let startRetryTimeout = null

        const emit = (type, payload) => {
          console.log(type + JSON.stringify(payload))
        }

        const clearStartRetryTimeout = () => {
          if (startRetryTimeout !== null) {
            window.clearTimeout(startRetryTimeout)
            startRetryTimeout = null
          }
        }

        const getSnapshot = () => {
          const currentTime = playerReady && player ? Number(player.getCurrentTime?.() || 0) : 0
          const duration = playerReady && player ? Number(player.getDuration?.() || 0) : 0
          const playerState = player ? Number(player.getPlayerState?.() ?? -1) : -1
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

        const ensureApi = () => new Promise((resolve) => {
          if (window.YT?.Player) {
            resolve(window.YT)
            return
          }

          const existing = document.querySelector('script[data-youtube-api="true"]')
          if (!existing) {
            const script = document.createElement('script')
            script.src = 'https://www.youtube.com/iframe_api'
            script.async = true
            script.dataset.youtubeApi = 'true'
            document.body.appendChild(script)
          }

          const previousReady = window.onYouTubeIframeAPIReady
          window.onYouTubeIframeAPIReady = () => {
            previousReady?.()
            resolve(window.YT)
          }
        })

        const destroyPlayer = () => {
          clearStartRetryTimeout()
          if (!player) return
          try {
            player.destroy()
          } catch {}
          player = null
          playerReady = false
        }

        const createPlayer = async (videoId, songId, startAt = 0, muted = true) => {
          await ensureApi()
          destroyPlayer()

          currentVideoId = videoId
          currentSongId = songId ?? null
          mutedState = Boolean(muted)

          const playerOrigin = window.location.origin && window.location.origin !== 'null'
            ? window.location.origin
            : undefined

          player = new window.YT.Player('player', {
            width: '320',
            height: '180',
            host: 'https://www.youtube.com',
            videoId,
            playerVars: {
              autoplay: 1,
              controls: 0,
              disablekb: 1,
              fs: 0,
              modestbranding: 1,
              iv_load_policy: 3,
              playsinline: 1,
              rel: 0,
              mute: 1,
              enablejsapi: 1,
              origin: playerOrigin,
            },
            events: {
              onReady: (event) => {
                playerReady = true
                if (startAt > 0) {
                  event.target.seekTo(startAt, true)
                }
                event.target.mute()
                event.target.playVideo()
                clearStartRetryTimeout()
                startRetryTimeout = window.setTimeout(() => {
                  const playerState = player?.getPlayerState?.() ?? -1
                  if (playerState !== 1) {
                    try {
                      player?.playVideo?.()
                    } catch {}
                    emit('__CSHUB_MUSIC_WARN__', { type: 'playback-unstarted-retry', songId: currentSongId, videoId: currentVideoId, playerState })
                  }
                }, 2500)
                emitState()
              },
              onStateChange: (event) => {
                if (event.data === 1) {
                  clearStartRetryTimeout()
                  if (mutedState) event.target.mute()
                  else event.target.unMute()
                }
                emitState()
              },
              onError: (event) => {
                emit('__CSHUB_MUSIC_ERROR__', { code: event.data, songId: currentSongId, videoId: currentVideoId })
              },
            },
          })
        }

        window.__CSHUB_PLAYER__ = {
          getSnapshot,
          async play({ videoId, songId, startAt = 0, muted = true }) {
            if (!videoId) return false
            await createPlayer(videoId, songId, startAt, muted)
            return true
          },
          pause(seconds) {
            if (!player) return false
            if (typeof seconds === 'number' && Number.isFinite(seconds)) {
              player.seekTo(seconds, true)
            }
            player.pauseVideo()
            emitState()
            return true
          },
          resume(seconds) {
            if (!player) return false
            if (typeof seconds === 'number' && Number.isFinite(seconds)) {
              player.seekTo(seconds, true)
            }
            player.playVideo()
            emitState()
            return true
          },
          seek(seconds) {
            if (!player || !Number.isFinite(seconds)) return false
            player.seekTo(seconds, true)
            emitState()
            return true
          },
          setMuted(muted) {
            mutedState = Boolean(muted)
            if (!player) return true
            if (mutedState) player.mute()
            else player.unMute()
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

    if (LOCAL_HOSTS.has(hostname)) {
        return true
    }

    // YouTube iframe and stream hosts need media/fullscreen rights for playback.
    if ((permission === 'media' || permission === 'fullscreen') && isAllowedEmbedHost(hostname)) {
        return true
    }

    return false
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
        const server = http.createServer((_req, res) => {
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

ipcMain.handle('music:play', async (_event, payload) => {
    const videoId = extractYouTubeVideoIdFromUrl(payload?.url)
    if (!videoId || !payload?.songId) {
        return false
    }

    return executeMusicCommand(
        `window.__CSHUB_PLAYER__.play(${JSON.stringify({
            videoId,
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
