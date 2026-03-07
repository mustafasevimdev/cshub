import { useState, useEffect, useCallback } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Channel } from '@/types'
import { useAuthStore } from '@/stores'

export function useChannels() {
    const [channels, setChannels] = useState<Channel[]>([])
    const [loading, setLoading] = useState(true)
    const userId = useAuthStore((state) => state.user?.id)

    const fetchChannels = useCallback(async () => {
        setLoading(true)
        try {
            const { data, error } = await supabase.from('channels')
                .select('*')
                .order('created_at', { ascending: true })

            if (!error && data) {
                setChannels(data as Channel[])
            }
        } catch (error) {
            console.error('Kanal listesi alınamadı:', error)
        }
        setLoading(false)
    }, [])

    // Fetch channels on mount
    useEffect(() => {
        void fetchChannels()

        const subscription = supabase
            .channel('channels')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'channels',
                },
                (payload: RealtimePostgresChangesPayload<Channel>) => {
                    if (payload.eventType === 'INSERT') {
                        setChannels((prev) => [...prev, payload.new])
                    } else if (payload.eventType === 'DELETE') {
                        setChannels((prev) => prev.filter((channel) => channel.id !== payload.old.id))
                    } else if (payload.eventType === 'UPDATE') {
                        setChannels((prev) =>
                            prev.map((channel) => (channel.id === payload.new.id ? payload.new : channel)),
                        )
                    }
                },
            )
            .subscribe()

        return () => {
            void subscription.unsubscribe()
        }
    }, [fetchChannels])

    const createChannel = useCallback(
        async (name: string, type: 'text' | 'voice') => {
            if (!userId) return { success: false, error: 'Not authenticated' }

            try {
                const { data, error } = await supabase.from('channels')
                    .insert(({
                        name,
                        type,
                        created_by: userId,
                    }) as never)
                    .select()
                    .single()

                if (error) {
                    if (error.message.includes("Could not find the table 'public.channels'")) {
                        return {
                            success: false,
                            error: "Supabase tablolari olusturulmamis. SQL Editor'de proje schema dosyasini calistir.",
                        }
                    }
                    if (
                        error.message.includes('channels_created_by_fkey') ||
                        error.message.toLowerCase().includes('violates foreign key constraint')
                    ) {
                        return {
                            success: false,
                            error: "Oturumdaki kullanici bu veritabaninda bulunamadi. Cikis yapip tekrar giris yap.",
                        }
                    }
                    return { success: false, error: error.message }
                }

                return { success: true, channel: data as Channel }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Ağ hatası'
                if (message.toLowerCase().includes('failed to fetch')) {
                    return {
                        success: false,
                        error: 'Sunucuya bağlanılamadı. İnternet/DNS veya Supabase proje URL ayarını kontrol et.',
                    }
                }
                return { success: false, error: message }
            }
        },
        [userId],
    )

    const deleteChannel = useCallback(async (channelId: string) => {
        const { error } = await supabase.from('channels').delete().eq('id', channelId)

        if (error) {
            return { success: false, error: error.message }
        }

        return { success: true }
    }, [])

    const textChannels = channels.filter((channel) => channel.type === 'text')
    const voiceChannels = channels.filter((channel) => channel.type === 'voice')

    return {
        channels,
        textChannels,
        voiceChannels,
        loading,
        createChannel,
        deleteChannel,
        refetch: fetchChannels,
    }
}

