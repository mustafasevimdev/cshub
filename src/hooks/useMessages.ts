import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Message, User } from '@/types'
import { useAuthStore } from '@/stores'

export function useMessages(channelId: string | null) {
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(false)
    const [usersCache, setUsersCache] = useState<Record<string, User>>({})
    const { user } = useAuthStore()
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Fetch messages when channel changes
    useEffect(() => {
        if (!channelId) {
            setMessages([])
            return
        }

        fetchMessages()

        // Subscribe to new messages
        const subscription = supabase
            .channel(`messages:${channelId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `channel_id=eq.${channelId}`
            }, async (payload) => {
                const newMessage = payload.new as Message

                // Get user info if not cached
                if (!usersCache[newMessage.user_id]) {
                    const { data: userData } = await supabase
                        .from('users')
                        .select('*')
                        .eq('id', newMessage.user_id)
                        .single()

                    if (userData) {
                        setUsersCache(prev => ({ ...prev, [newMessage.user_id]: userData }))
                        newMessage.user = userData
                    }
                } else {
                    newMessage.user = usersCache[newMessage.user_id]
                }

                setMessages(prev => [...prev, newMessage])
            })
            .on('postgres_changes', {
                event: 'DELETE',
                schema: 'public',
                table: 'messages',
                filter: `channel_id=eq.${channelId}`
            }, (payload) => {
                setMessages(prev => prev.filter(m => m.id !== payload.old.id))
            })
            .subscribe()

        return () => {
            subscription.unsubscribe()
        }
    }, [channelId])

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const fetchMessages = async () => {
        if (!channelId) return

        setLoading(true)

        // Fetch messages with user info
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: true })
            .limit(100)

        if (!error && data) {
            // Fetch user info for all unique user IDs
            const userIds = [...new Set((data as any[]).map((m: any) => m.user_id))]
            const { data: users } = await supabase
                .from('users')
                .select('*')
                .in('id', userIds)

            const usersMap: Record<string, User> = {}
            if (users) {
                (users as any[]).forEach((u: any) => {
                    usersMap[u.id] = u
                })
            }
            setUsersCache(prev => ({ ...prev, ...usersMap }))

            // Attach user info to messages
            const messagesWithUsers = (data as any[]).map((m: any) => ({
                ...m,
                user: usersMap[m.user_id]
            }))

            setMessages(messagesWithUsers as any)
        }

        setLoading(false)
    }

    const sendMessage = useCallback(async (content: string) => {
        if (!user || !channelId || !content.trim()) return { success: false }

        const tempId = crypto.randomUUID()
        const newMessage: Message = {
            id: tempId,
            channel_id: channelId,
            user_id: user.id,
            content: content.trim(),
            created_at: new Date().toISOString(),
            user: user
        }

        // Optimistic Update
        setMessages(prev => [...prev, newMessage])

        const { data, error } = await (supabase.from('messages') as any)
            .insert({
                channel_id: channelId,
                user_id: user.id,
                content: content.trim()
            })
            .select()
            .single()

        if (error) {
            // Rollback on error
            setMessages(prev => prev.filter(m => m.id !== tempId))
            return { success: false, error: error.message }
        }

        // Replace temp ID with real ID (optional, but good for consistency)
        if (data) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: (data as any).id } : m))
        }

        return { success: true }
    }, [user, channelId])

    const deleteMessage = useCallback(async (messageId: string) => {
        const { error } = await supabase
            .from('messages')
            .delete()
            .eq('id', messageId)

        if (error) {
            return { success: false, error: error.message }
        }

        return { success: true }
    }, [])

    const clearMessages = useCallback(() => {
        setMessages([])
    }, [])

    const clearChannelMessages = useCallback(async () => {
        if (!channelId) return
        await (supabase.from('messages') as any).delete().eq('channel_id', channelId)
    }, [channelId])

    return {
        messages,
        loading,
        sendMessage,
        deleteMessage,
        clearMessages,
        clearChannelMessages,
        messagesEndRef
    }
}
