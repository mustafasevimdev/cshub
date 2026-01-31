import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Channel } from '@/types'
import { useAuthStore } from '@/stores'

export function useChannels() {
    const [channels, setChannels] = useState<Channel[]>([])
    const [loading, setLoading] = useState(true)
    const { user } = useAuthStore()

    // Fetch channels on mount
    useEffect(() => {
        fetchChannels()

        // Subscribe to channel changes
        const subscription = supabase
            .channel('channels')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'channels'
            }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    setChannels(prev => [...prev, payload.new as Channel])
                } else if (payload.eventType === 'DELETE') {
                    setChannels(prev => prev.filter(c => c.id !== payload.old.id))
                } else if (payload.eventType === 'UPDATE') {
                    setChannels(prev => prev.map(c =>
                        c.id === payload.new.id ? payload.new as Channel : c
                    ))
                }
            })
            .subscribe()

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    const fetchChannels = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from('channels')
            .select('*')
            .order('created_at', { ascending: true })

        if (!error && data) {
            setChannels(data)
        }
        setLoading(false)
    }

    const createChannel = useCallback(async (name: string, type: 'text' | 'voice') => {
        if (!user) return { success: false, error: 'Not authenticated' }

        const { data, error } = await supabase
            .from('channels')
            .insert({
                name,
                type,
                created_by: user.id
            })
            .select()
            .single()

        if (error) {
            return { success: false, error: error.message }
        }

        return { success: true, channel: data }
    }, [user])

    const deleteChannel = useCallback(async (channelId: string) => {
        const { error } = await supabase
            .from('channels')
            .delete()
            .eq('id', channelId)

        if (error) {
            return { success: false, error: error.message }
        }

        return { success: true }
    }, [])

    const textChannels = channels.filter(c => c.type === 'text')
    const voiceChannels = channels.filter(c => c.type === 'voice')

    return {
        channels,
        textChannels,
        voiceChannels,
        loading,
        createChannel,
        deleteChannel,
        refetch: fetchChannels
    }
}
