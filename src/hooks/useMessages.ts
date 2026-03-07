import { useState, useEffect, useCallback, useRef } from 'react'
import type { RealtimePostgresDeletePayload, RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Message, MessageRow, User, UserRow } from '@/types'
import { useAuthStore } from '@/stores'

function toPublicUser(userRow: UserRow): User {
    const { password_hash, ...publicUser } = userRow
    void password_hash
    return publicUser
}

export function useMessages(channelId: string | null) {
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(false)
    const [usersCache, setUsersCache] = useState<Record<string, User>>({})
    const user = useAuthStore((state) => state.user)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const usersCacheRef = useRef<Record<string, User>>({})

    useEffect(() => {
        usersCacheRef.current = usersCache
    }, [usersCache])

    const fetchMessages = useCallback(async () => {
        if (!channelId) return

        setLoading(true)

        const { data, error } = await supabase.from('messages')
            .select('*')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: true })
            .limit(100)

        if (!error && data) {
            const typedMessages = data as MessageRow[]
            const userIds = [...new Set(typedMessages.map((message) => message.user_id))]
            let usersMap: Record<string, User> = {}

            if (userIds.length > 0) {
                const { data: users } = await supabase.from('users').select('*').in('id', userIds)

                if (users) {
                    usersMap = (users as UserRow[]).reduce<Record<string, User>>((acc, userRow) => {
                        acc[userRow.id] = toPublicUser(userRow)
                        return acc
                    }, {})
                }
            }

            setUsersCache((prev) => ({ ...prev, ...usersMap }))

            const messagesWithUsers: Message[] = typedMessages.map((message) => ({
                ...message,
                user: usersMap[message.user_id] ?? usersCacheRef.current[message.user_id],
            }))

            setMessages(messagesWithUsers)
        }

        setLoading(false)
    }, [channelId])

    // Fetch messages when channel changes
    useEffect(() => {
        if (!channelId) {
            setMessages([])
            return
        }

        void fetchMessages()

        const subscription = supabase
            .channel(`messages:${channelId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `channel_id=eq.${channelId}`,
                },
                async (payload: RealtimePostgresInsertPayload<MessageRow>) => {
                    const newMessage: Message = payload.new

                    const cachedUser = usersCacheRef.current[newMessage.user_id]
                    if (!cachedUser) {
                        const { data: userData } = await supabase.from('users')
                            .select('*')
                            .eq('id', newMessage.user_id)
                            .maybeSingle()

                        if (userData) {
                            const publicUser = toPublicUser(userData as UserRow)
                            setUsersCache((prev) => ({ ...prev, [newMessage.user_id]: publicUser }))
                            newMessage.user = publicUser
                        }
                    } else {
                        newMessage.user = cachedUser
                    }

                    setMessages((prev) => {
                        if (prev.some((message) => message.id === newMessage.id)) return prev
                        return [...prev, newMessage]
                    })
                },
            )
            .on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'messages',
                    filter: `channel_id=eq.${channelId}`,
                },
                (payload: RealtimePostgresDeletePayload<MessageRow>) => {
                    setMessages((prev) => prev.filter((message) => message.id !== payload.old.id))
                },
            )
            .subscribe()

        return () => {
            void subscription.unsubscribe()
        }
    }, [channelId, fetchMessages])

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const sendMessage = useCallback(
        async (content: string) => {
            if (!user || !channelId || !content.trim()) return { success: false }

            const { error } = await supabase.from('messages').insert({
                channel_id: channelId,
                user_id: user.id,
                content: content.trim(),
            } as never)

            if (error) {
                return { success: false, error: error.message }
            }

            return { success: true }
        },
        [user, channelId],
    )

    const deleteMessage = useCallback(async (messageId: string) => {
        const { error } = await supabase.from('messages').delete().eq('id', messageId)

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
        await supabase.from('messages').delete().eq('channel_id', channelId)
    }, [channelId])

    return {
        messages,
        loading,
        sendMessage,
        deleteMessage,
        clearMessages,
        clearChannelMessages,
        messagesEndRef,
    }
}

