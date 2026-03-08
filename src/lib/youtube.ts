const LEGACY_SEARCH_PREFIX = 'ytsearch:'
const R_JINA_YOUTUBE_PREFIX = 'https://r.jina.ai/http://www.youtube.com/results?search_query='
const SEARCH_REQUEST_TIMEOUT_MS = 3500

const resolvedCache = new Map<string, ResolvedYouTubeSource>()
const pendingResolutions = new Map<string, Promise<ResolvedYouTubeSource | null>>()

export interface ResolvedYouTubeSource {
  source: string
  title?: string
}

interface SearchResolverResponse {
  url: string
  title?: string
}

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value)
const isYouTubeLikeUrl = (value: string) => /^(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(value)

export const isLegacySearchSource = (value: string) => value.startsWith(LEGACY_SEARCH_PREFIX)

export const toLegacySearchQuery = (value: string) => decodeURIComponent(value.slice(LEGACY_SEARCH_PREFIX.length))

export const normalizeYouTubeInput = (value: string) => {
  const normalized = value.trim()
  if (isHttpUrl(normalized)) return normalized
  if (isYouTubeLikeUrl(normalized)) return `https://${normalized}`
  return null
}

export const extractFirstVideoMatch = (value: string) => {
  const patterns = [
    /https?:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i,
    /https?:\/\/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i,
    /\/watch\?v=([A-Za-z0-9_-]{11})/i,
    /\\"videoId\\":\\"([A-Za-z0-9_-]{11})\\"/i,
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

export const extractFirstVideoTitle = (value: string) => {
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

async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = SEARCH_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function resolveViaElectron(query: string): Promise<ResolvedYouTubeSource | null> {
  if (!window.electronAPI?.resolveYouTubeSearch) return null

  try {
    const result = await window.electronAPI.resolveYouTubeSearch(query)
    if (!result?.url) return null

    return {
      source: result.url,
      title: result.title,
    }
  } catch (error) {
    console.error('Electron YouTube search failed:', error)
    return null
  }
}

async function resolveViaDevServer(query: string): Promise<ResolvedYouTubeSource | null> {
  try {
    const response = await fetchWithTimeout(`/api/youtube/search?q=${encodeURIComponent(query)}`)
    if (!response.ok) return null

    const result = (await response.json()) as SearchResolverResponse
    if (!result.url) return null

    return {
      source: result.url,
      title: result.title,
    }
  } catch (error) {
    console.error('Dev YouTube search failed:', error)
    return null
  }
}

async function resolveViaJina(query: string): Promise<ResolvedYouTubeSource | null> {
  try {
    const response = await fetchWithTimeout(`${R_JINA_YOUTUBE_PREFIX}${encodeURIComponent(query)}`, undefined, 2500)
    if (!response.ok) return null

    const markdown = await response.text()
    const videoId = extractFirstVideoMatch(markdown)
    if (!videoId) return null

    return {
      source: `https://www.youtube.com/watch?v=${videoId}`,
      title: extractFirstVideoTitle(markdown),
    }
  } catch (error) {
    console.error('Direct YouTube search fallback failed:', error)
    return null
  }
}

export async function resolveYouTubeSource(input: string): Promise<ResolvedYouTubeSource | null> {
  const normalizedUrl = normalizeYouTubeInput(input)
  if (normalizedUrl) {
    return { source: normalizedUrl }
  }

  const query = input.trim()
  if (!query) return null

  const cacheKey = query.toLocaleLowerCase('tr-TR')
  const cached = resolvedCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const pending = pendingResolutions.get(cacheKey)
  if (pending) {
    return pending
  }

  const resolution = (async () => {
    const result = (
      (await resolveViaElectron(query)) ??
      (await resolveViaDevServer(query)) ??
      (await resolveViaJina(query))
    )

    if (result) {
      resolvedCache.set(cacheKey, result)
    }

    pendingResolutions.delete(cacheKey)
    return result
  })()

  pendingResolutions.set(cacheKey, resolution)
  return resolution
}
