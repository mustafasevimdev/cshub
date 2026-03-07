import { describe, expect, it } from 'vitest'
import {
  extractFirstVideoMatch,
  extractFirstVideoTitle,
  isLegacySearchSource,
  normalizeYouTubeInput,
  toLegacySearchQuery,
} from '@/lib/youtube'

describe('youtube helpers', () => {
  it('normalizes direct YouTube inputs', () => {
    expect(normalizeYouTubeInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(normalizeYouTubeInput('youtu.be/dQw4w9WgXcQ')).toBe('https://youtu.be/dQw4w9WgXcQ')
    expect(normalizeYouTubeInput('tarkan simarik')).toBeNull()
  })

  it('extracts the first video id and title from YouTube search content', () => {
    const payload = '### [TARKAN - Simarik](http://www.youtube.com/watch?v=cpp69ghR1IM&list=RDcpp69ghR1IM)'

    expect(extractFirstVideoMatch(payload)).toBe('cpp69ghR1IM')
    expect(extractFirstVideoTitle(payload)).toBe('TARKAN - Simarik')
  })

  it('decodes legacy ytsearch entries', () => {
    const value = 'ytsearch:tarkan%20simarik'

    expect(isLegacySearchSource(value)).toBe(true)
    expect(toLegacySearchQuery(value)).toBe('tarkan simarik')
  })
})
