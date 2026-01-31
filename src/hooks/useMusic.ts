import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores'
import type { MusicQueueItem } from '@/types'

export function useMusic(channelId: string | null) {
    const { user } = useAuthStore()
    const [queue, setQueue] = useState<MusicQueueItem[]>([])
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentSong, setCurrentSong] = useState<MusicQueueItem | null>(null)

    const fetchQueue = useCallback(async () => {
        if (!channelId) return
        const { data, error } = await (supabase.from('music_queue') as any)
            .select('*')
            .eq('channel_id', channelId)
            .order('position', { ascending: true })

        if (data) {
            setQueue(data)
            const playing = data.find((item: any) => item.is_playing)
            setCurrentSong(playing || null)
            setIsPlaying(!!playing)
        }
    }, [channelId])

    useEffect(() => {
        console.log('[Music] Mounting hook for channel:', channelId)
        fetchQueue()

        if (channelId) {
            console.log('[Music] Subscribing to channel:', channelId)
            const subscription = supabase.channel(`music_queue:${channelId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'music_queue',
                    filter: `channel_id=eq.${channelId}`
                }, (payload) => {
                    console.log('[Music] Realtime Event Received:', payload)
                    fetchQueue()
                })
                .subscribe((status) => {
                    console.log('[Music] Subscription Status:', status)
                })

            return () => {
                console.log('[Music] Unsubscribing')
                subscription.unsubscribe()
            }
        }
    }, [channelId, fetchQueue])

    const addToQueue = async (url: string, title?: string, isVideo: boolean = false) => {
        if (!channelId || !user) return

        const position = queue.length > 0 ? queue[queue.length - 1].position + 1 : 0

        let songTitle = title || 'Yükleniyor...'

        // Fetch Title if not provided
        if (!title) {
            try {
                const res = await fetch(`https://noembed.com/embed?url=${url}`)
                const data = await res.json()
                if (data.title) songTitle = data.title
            } catch (e) {
                console.error('Failed to fetch title', e)
                songTitle = 'Bilinmeyen Şarkı'
            }
        }

        // AUTO-PLAY FIX: Play if nothing is currently playing!
        const shouldPlay = !isPlaying && !currentSong

        const { error } = await (supabase.from('music_queue') as any).insert({
            channel_id: channelId,
            user_id: user.id,
            youtube_url: url,
            title: songTitle,
            position,
            is_playing: shouldPlay,
            is_video: isVideo
        })

        if (error) {
            console.error('Error adding to music queue:', error)
        }
    }

    const nextSong = async () => {
        if (!channelId) return

        // If we currently have a song, delete it
        if (currentSong) {
            await (supabase.from('music_queue') as any).delete().eq('id', currentSong.id)
        }

        // Logic to find the next one to play
        // If we are stuck (deadlock), pick the very first one in queue
        if (!currentSong && queue.length > 0) {
            await (supabase.from('music_queue') as any).update({ is_playing: true }).eq('id', queue[0].id)
            return
        }

        // Normal flow: Pick the next one in line
        if (currentSong) {
            const next = queue.find(item => item.position > currentSong.position)
            if (next) {
                await (supabase.from('music_queue') as any).update({ is_playing: true }).eq('id', next.id)
            }
        }
    }

    const stopSong = async () => {
        if (!channelId) return

        // Delete all songs for this channel
        await (supabase.from('music_queue') as any).delete().eq('channel_id', channelId)

        // Optimistically clear local state
        setQueue([])
        setCurrentSong(null)
        setIsPlaying(false)
    }

    return { queue, isPlaying, currentSong, addToQueue, nextSong, stopSong }
}
