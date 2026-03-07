import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const YOUTUBE_SEARCH_BASE = 'https://www.youtube.com/results?hl=tr&persist_hl=1&search_query='
const SEARCH_TIMEOUT_MS = 3000
const searchCache = new Map<string, { url: string; title?: string }>()

const extractFirstYouTubeVideoId = (value: string) => {
    const patterns = [
        /https?:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i,
        /watch\?v=([A-Za-z0-9_-]{11})/i,
        /"videoId":"([A-Za-z0-9_-]{11})"/i,
    ]

    for (const pattern of patterns) {
        const match = value.match(pattern)
        if (match?.[1]) {
            return match[1]
        }
    }

    return null
}

const extractFirstYouTubeTitle = (value: string) => {
    const headingMatch = value.match(/### \[(.+?)\]\(http:\/\/www\.youtube\.com\/watch\?v=/i)
    if (headingMatch?.[1]) {
        return headingMatch[1]
    }

    const titleMatch = value.match(/"title":\{"runs":\[\{"text":"(.+?)"/i)
    if (titleMatch?.[1]) {
        return titleMatch[1]
    }

    return undefined
}

export default defineConfig({
    plugins: [
        react(),
        {
            name: 'youtube-search-dev-endpoint',
            configureServer(server) {
                server.middlewares.use('/api/youtube/search', async (req, res) => {
                    const requestUrl = new URL(req.url ?? '/', 'http://localhost:3000')
                    const query = requestUrl.searchParams.get('q')?.trim()

                    if (!query) {
                        res.statusCode = 400
                        res.setHeader('Content-Type', 'application/json')
                        res.end(JSON.stringify({ error: 'Missing search query.' }))
                        return
                    }

                    try {
                        const cacheKey = query.toLocaleLowerCase('tr-TR')
                        const cached = searchCache.get(cacheKey)
                        if (cached) {
                            res.statusCode = 200
                            res.setHeader('Content-Type', 'application/json')
                            res.end(JSON.stringify(cached))
                            return
                        }

                        const controller = new AbortController()
                        const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
                        let response: Response

                        try {
                            response = await fetch(`${YOUTUBE_SEARCH_BASE}${encodeURIComponent(query)}`, {
                                headers: {
                                    'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8',
                                    'user-agent': 'Mozilla/5.0',
                                },
                                signal: controller.signal,
                            })
                        } finally {
                            clearTimeout(timeout)
                        }

                        if (!response.ok) {
                            res.statusCode = response.status
                            res.setHeader('Content-Type', 'application/json')
                            res.end(JSON.stringify({ error: 'Search provider failed.' }))
                            return
                        }

                        const payload = await response.text()
                        const videoId = extractFirstYouTubeVideoId(payload)

                        if (!videoId) {
                            res.statusCode = 404
                            res.setHeader('Content-Type', 'application/json')
                            res.end(JSON.stringify({ error: 'No video found.' }))
                            return
                        }

                        const result = {
                            url: `https://www.youtube.com/watch?v=${videoId}`,
                            title: extractFirstYouTubeTitle(payload),
                        }
                        searchCache.set(cacheKey, result)

                        res.statusCode = 200
                        res.setHeader('Content-Type', 'application/json')
                        res.end(JSON.stringify(result))
                    } catch (error) {
                        console.error('Vite YouTube search endpoint failed:', error)
                        res.statusCode = 500
                        res.setHeader('Content-Type', 'application/json')
                        res.end(JSON.stringify({ error: 'Music search failed.' }))
                    }
                })
            },
        },
    ],
    base: './',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 3000,
        open: false, // Don't open browser automatically
    },
})
