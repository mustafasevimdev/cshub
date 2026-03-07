import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { isLegacySearchSource, resolveYouTubeSource, toLegacySearchQuery } from '@/lib/youtube'
import { useAuthStore } from '@/stores'
import type { MusicQueueItem } from '@/types'

interface NoEmbedResponse {
    title?: string
}

export interface AddToQueueResult {
    success: boolean
    error?: string
}

export function useMusic(channelId: string | null) {
    const user = useAuthStore((state) => state.user)
    const [queue, setQueue] = useState<MusicQueueItem[]>([])
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentSong, setCurrentSong] = useState<MusicQueueItem | null>(null)
    const currentSongRef = useRef<MusicQueueItem | null>(null)
    const queueRef = useRef<MusicQueueItem[]>([])
    const isAdvancingRef = useRef(false)

    useEffect(() => {
        currentSongRef.current = currentSong
    }, [currentSong])

    useEffect(() => {
        queueRef.current = queue
    }, [queue])

    const migrateLegacyQueueItems = useCallback(
        async (items: MusicQueueItem[]) => {
            const legacyItems = items.filter((item) => isLegacySearchSource(item.youtube_url))
            if (legacyItems.length === 0) return

            await Promise.all(
                legacyItems.map(async (item) => {
                    const query = toLegacySearchQuery(item.youtube_url)
                    const resolved = await resolveYouTubeSource(query)
                    if (!resolved) return

                    const { error } = await supabase.from('music_queue').update({
                        youtube_url: resolved.source,
                        title: item.title === query && resolved.title ? resolved.title : item.title,
                    } as never).eq('id', item.id)

                    if (error) {
                        console.error('Failed to migrate legacy music source:', error)
                    }
                }),
            )
        },
        [],
    )

    const fetchQueue = useCallback(async () => {
        if (!channelId) return

        const { data } = await supabase.from('music_queue')
            .select('*')
            .eq('channel_id', channelId)
            .order('position', { ascending: true })

        if (data) {
            const typedQueue = data as MusicQueueItem[]
            setQueue(typedQueue)
            const playing = typedQueue.find((item) => item.is_playing)
            setCurrentSong(playing || null)
            setIsPlaying(Boolean(playing))

            void migrateLegacyQueueItems(typedQueue)
        }
    }, [channelId, migrateLegacyQueueItems])

    const enrichSongTitle = useCallback(async (songId: string, source: string) => {
        try {
            const response = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(source)}`)
            if (!response.ok) return

            const data = (await response.json()) as NoEmbedResponse
            if (!data.title) return

            const { error } = await supabase.from('music_queue').update({ title: data.title } as never).eq('id', songId)
            if (error) {
                console.error('Failed to update song title:', error)
            }
        } catch (error) {
            console.error('Failed to fetch title', error)
        }
    }, [])

    useEffect(() => {
        if (!channelId) {
            setQueue([])
            setCurrentSong(null)
            setIsPlaying(false)
            return
        }

        void fetchQueue()

        const subscription = supabase
            .channel(`music_queue:${channelId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'music_queue',
                    filter: `channel_id=eq.${channelId}`,
                },
                () => {
                    void fetchQueue()
                },
            )
            .subscribe()

        return () => {
            void subscription.unsubscribe()
        }
    }, [channelId, fetchQueue])

    const addToQueue = useCallback(
        async (input: string, title?: string, isVideo = false): Promise<AddToQueueResult> => {
            if (!channelId || !user) {
                return { success: false, error: 'Muzik eklemek icin ses kanalina bagli olmalisin.' }
            }

            const position = queue.length > 0 ? queue[queue.length - 1].position + 1 : 0
            const resolvedSource = await resolveYouTubeSource(input)
            if (!resolvedSource) {
                return { success: false, error: 'Sarki bulunamadi. YouTube linki veya sarki adini tekrar deneyin.' }
            }

            const fallbackTitle = input.trim() || 'Bilinmeyen Sarki'
            const songTitle = title || resolvedSource.title || fallbackTitle

            const shouldPlay = !isPlaying && !currentSong

            const { data, error } = await supabase.from('music_queue').insert({
                channel_id: channelId,
                user_id: user.id,
                youtube_url: resolvedSource.source,
                title: songTitle,
                position,
                is_playing: shouldPlay,
                is_video: isVideo,
            } as never).select('*').single()

            if (error) {
                console.error('Error adding to music queue:', error)
                return { success: false, error: 'Sarki kuyruga eklenemedi.' }
            }

            if (data) {
                const insertedItem = data as MusicQueueItem
                setQueue((current) => [...current, insertedItem])

                if (insertedItem.is_playing) {
                    setCurrentSong(insertedItem)
                    setIsPlaying(true)
                    currentSongRef.current = insertedItem
                }

                if (!title && !resolvedSource.title) {
                    void enrichSongTitle(insertedItem.id, resolvedSource.source)
                }
            }

            return { success: true }
        },
        [channelId, user, queue, isPlaying, currentSong, enrichSongTitle],
    )

    const nextSong = useCallback(async () => {
        if (!channelId || isAdvancingRef.current) return

        isAdvancingRef.current = true

        const activeSong = currentSongRef.current
        const currentQueue = queueRef.current
        const sortedQueue = [...currentQueue].sort((left, right) => left.position - right.position)
        const fallbackCurrent = sortedQueue.find((item) => item.is_playing) || sortedQueue[0] || null
        const songToAdvance = activeSong || fallbackCurrent

        try {
            let nextItem: MusicQueueItem | null = null

            if (songToAdvance) {
                nextItem = sortedQueue.find((item) => item.position > songToAdvance.position) || null
            } else {
                nextItem = sortedQueue[0] || null
            }

            const nextQueue = sortedQueue
                .filter((item) => item.id !== songToAdvance?.id)
                .map((item) => ({
                    ...item,
                    is_playing: nextItem ? item.id === nextItem.id : false,
                }))

            setQueue(nextQueue)
            setCurrentSong(nextItem)
            currentSongRef.current = nextItem
            setIsPlaying(Boolean(nextItem))

            if (songToAdvance) {
                const { error: deleteError } = await supabase.from('music_queue').delete().eq('id', songToAdvance.id)
                if (deleteError) {
                    console.error('Error removing current song from queue:', deleteError)
                }
            }

            if (nextItem) {
                const { error: updateError } = await supabase.from('music_queue').update({ is_playing: true } as never).eq('id', nextItem.id)
                if (updateError) {
                    console.error('Error promoting next song in queue:', updateError)
                }
            }
        } finally {
            isAdvancingRef.current = false
        }
    }, [channelId])

    const stopSong = useCallback(async () => {
        if (!channelId) return

        setQueue([])
        setCurrentSong(null)
        setIsPlaying(false)
        currentSongRef.current = null

        const { error } = await supabase.from('music_queue').delete().eq('channel_id', channelId)
        if (error) {
            console.error('Error stopping music queue:', error)
        }
    }, [channelId])

    const ensureSongOwnerIsStillInVoice = useCallback(async () => {
        if (!channelId || !currentSongRef.current) return

        const ownerId = currentSongRef.current.user_id
        const { data, error } = await supabase.from('voice_participants')
            .select('id')
            .eq('channel_id', channelId)
            .eq('user_id', ownerId)
            .maybeSingle()

        if (error) {
            console.error('Voice owner check failed:', error)
            return
        }

        if (!data) {
            await stopSong()
        }
    }, [channelId, stopSong])

    useEffect(() => {
        if (!channelId) return

        const ownerGuard = supabase
            .channel(`music_owner_guard:${channelId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'voice_participants',
                    filter: `channel_id=eq.${channelId}`,
                },
                () => {
                    void ensureSongOwnerIsStillInVoice()
                },
            )
            .subscribe()

        return () => {
            void ownerGuard.unsubscribe()
        }
    }, [channelId, ensureSongOwnerIsStillInVoice])

    useEffect(() => {
        void ensureSongOwnerIsStillInVoice()
    }, [currentSong?.id, ensureSongOwnerIsStillInVoice])

    return { queue, isPlaying, currentSong, addToQueue, nextSong, stopSong }
}
