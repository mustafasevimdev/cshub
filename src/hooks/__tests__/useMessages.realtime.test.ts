import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import type { MessageRow, User } from '@/types'

const mocks = vi.hoisted(() => {
    const baseUser: User = {
        id: 'user-1',
        nickname: 'Mustafa',
        avatar_url: null,
        status: 'online',
        created_at: '2026-03-07T10:00:00.000Z',
        last_seen: '2026-03-07T10:00:00.000Z',
    }

    const baseUserRow = {
        ...baseUser,
        password_hash: 'hash',
    }

    const firstMessage: MessageRow = {
        id: 'message-1',
        channel_id: 'channel-1',
        user_id: baseUser.id,
        content: 'ilk mesaj',
        created_at: '2026-03-07T10:01:00.000Z',
    }

    const insertMessage: MessageRow = {
        id: 'message-2',
        channel_id: 'channel-1',
        user_id: baseUser.id,
        content: 'realtime mesaj',
        created_at: '2026-03-07T10:02:00.000Z',
    }

    const state: {
        insertHandler?: (payload: RealtimePostgresInsertPayload<MessageRow>) => Promise<void> | void
    } = {}

    const channelMock = {
        on: vi.fn((event: string, filter: { event: string }, callback: unknown) => {
            if (event === 'postgres_changes' && filter.event === 'INSERT') {
                state.insertHandler = callback as (
                    payload: RealtimePostgresInsertPayload<MessageRow>,
                ) => Promise<void> | void
            }
            return channelMock
        }),
        subscribe: vi.fn(() => channelMock),
        unsubscribe: vi.fn(async () => 'ok'),
    }

    const fromTableMock = vi.fn((table: string) => {
        if (table === 'messages') {
            return {
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        order: vi.fn(() => ({
                            limit: vi.fn(async () => ({ data: [firstMessage], error: null })),
                        })),
                    })),
                })),
                insert: vi.fn(async () => ({ error: null })),
                delete: vi.fn(() => ({
                    eq: vi.fn(async () => ({ error: null })),
                })),
            }
        }

        if (table === 'users') {
            return {
                select: vi.fn(() => ({
                    in: vi.fn(async () => ({ data: [baseUserRow], error: null })),
                    eq: vi.fn(() => ({
                        maybeSingle: vi.fn(async () => ({ data: baseUserRow, error: null })),
                    })),
                })),
            }
        }

        throw new Error(`Unexpected table: ${table}`)
    })

    return {
        state,
        baseUser,
        insertMessage,
        channelMock,
        fromTableMock,
    }
})

vi.mock('@/lib/supabase', () => ({
    supabase: {
        channel: vi.fn(() => mocks.channelMock),
        from: mocks.fromTableMock,
    },
}))

vi.mock('@/stores', () => ({
    useAuthStore: <T>(selector: (state: { user: User }) => T) => selector({ user: mocks.baseUser }),
}))

import { useMessages } from '@/hooks/useMessages'

describe('useMessages realtime flow', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.state.insertHandler = undefined
    })

    it('realtime insert ile mesaj listesine yeni mesaj ekler', async () => {
        const { result, unmount } = renderHook(() => useMessages('channel-1'))

        await waitFor(() => {
            expect(result.current.messages).toHaveLength(1)
        })
        expect(result.current.messages[0].user?.nickname).toBe('Mustafa')

        await act(async () => {
            await mocks.state.insertHandler?.({
                schema: 'public',
                table: 'messages',
                commit_timestamp: new Date().toISOString(),
                eventType: 'INSERT',
                errors: [],
                new: mocks.insertMessage,
                old: {} as MessageRow,
            })
        })

        await waitFor(() => {
            expect(result.current.messages).toHaveLength(2)
        })
        expect(result.current.messages[1].content).toBe('realtime mesaj')
        expect(result.current.messages[1].user?.id).toBe(mocks.baseUser.id)

        unmount()
        expect(mocks.channelMock.unsubscribe).toHaveBeenCalled()
    })
})
