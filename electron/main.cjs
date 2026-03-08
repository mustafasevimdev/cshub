const { app, BrowserWindow, Tray, Menu, nativeImage, desktopCapturer, ipcMain, session, shell } = require('electron')
const fs = require('fs/promises')
const http = require('http')
const path = require('path')

let mainWindow = null
let tray = null
let isQuitting = false
let rendererServer = null
let rendererServerUrl = null

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

    const desktopFriendlyUserAgent = app.userAgentFallback.replace(/\sElectron\/[^\s]+/i, '')
    mainWindow.webContents.setUserAgent(desktopFriendlyUserAgent)

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

app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
        if (!ALLOWED_PERMISSIONS.has(permission)) {
            callback(false)
            return
        }

        const requestingHost = getHostFromUrl(details?.requestingUrl)
        callback(isTrustedRequestingHost(requestingHost, permission))
    })

    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        if (!ALLOWED_PERMISSIONS.has(permission)) {
            return false
        }

        const requestingHost = getHostFromUrl(requestingOrigin)
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
    rendererServer?.close()
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
