import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/types'

const mocks = vi.hoisted(() => {
    const testUser: User = {
        id: 'user-1',
        nickname: 'Mustafa',
        avatar_url: null,
        status: 'online',
        created_at: '2026-03-07T10:00:00.000Z',
        last_seen: '2026-03-07T10:00:00.000Z',
    }

    const userRow = {
        ...testUser,
        password_hash: 'hash',
    }

    const participantRow = {
        id: 'participant-1',
        channel_id: 'voice-1',
        user_id: testUser.id,
        is_muted: false,
        is_deafened: false,
        is_screen_sharing: false,
        joined_at: '2026-03-07T10:00:00.000Z',
    }

    const deleteByUserEqMock = vi.fn(async () => ({ error: null }))
    const deleteByChannelEqMock = vi.fn(() => ({ eq: deleteByUserEqMock }))
    const upsertMock = vi.fn(async () => ({ error: null as unknown }))
    const updateByUserEqMock = vi.fn(async () => ({ error: null }))
    const updateByChannelEqMock = vi.fn(() => ({ eq: updateByUserEqMock }))
    const updateMock = vi.fn(() => ({ eq: updateByChannelEqMock }))

    const signalChannelMock = {
        on: vi.fn(() => signalChannelMock),
        subscribe: vi.fn((callback?: (status: string) => void) => {
            callback?.('SUBSCRIBED')
            return signalChannelMock
        }),
        track: vi.fn(async () => 'ok'),
        send: vi.fn(async () => 'ok'),
        unsubscribe: vi.fn(async () => 'ok'),
    }

    const participantsSyncChannelMock = {
        on: vi.fn(() => participantsSyncChannelMock),
        subscribe: vi.fn(() => participantsSyncChannelMock),
        unsubscribe: vi.fn(async () => 'ok'),
    }

    const channelFactoryMock = vi
        .fn()
        .mockImplementationOnce(() => signalChannelMock)
        .mockImplementationOnce(() => participantsSyncChannelMock)

    const fromTableMock = vi.fn((table: string) => {
        if (table === 'voice_participants') {
            return {
                upsert: upsertMock,
                select: vi.fn(() => ({
                    eq: vi.fn(async () => ({ data: [participantRow], error: null })),
                })),
                delete: vi.fn(() => ({
                    eq: deleteByChannelEqMock,
                })),
                update: updateMock,
            }
        }

        if (table === 'users') {
            return {
                select: vi.fn(() => ({
                    in: vi.fn(async () => ({ data: [userRow], error: null })),
                })),
            }
        }

        throw new Error(`Unexpected table: ${table}`)
    })

    const trackMock = {
        enabled: true,
        stop: vi.fn(),
    }

    const streamMock = {
        getTracks: vi.fn(() => [trackMock]),
        getAudioTracks: vi.fn(() => [trackMock]),
    }

    return {
        testUser,
        trackMock,
        streamMock,
        upsertMock,
        updateMock,
        updateByChannelEqMock,
        updateByUserEqMock,
        deleteByChannelEqMock,
        deleteByUserEqMock,
        signalChannelMock,
        participantsSyncChannelMock,
        channelFactoryMock,
        fromTableMock,
    }
})

vi.mock('@/lib/supabase', () => ({
    supabase: {
        channel: mocks.channelFactoryMock,
        from: mocks.fromTableMock,
    },
}))

vi.mock('@/stores', () => ({
    useAuthStore: <T>(selector: (state: { user: User }) => T) => selector({ user: mocks.testUser }),
}))

beforeAll(() => {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        value: {
            getUserMedia: vi.fn(async () => mocks.streamMock),
            getDisplayMedia: vi.fn(),
        },
        configurable: true,
    })

    class FakeAnalyserNode {
        fftSize = 256
        frequencyBinCount = 32

        getByteFrequencyData(buffer: Uint8Array) {
            buffer.fill(0)
        }
    }

    class FakeAudioContext {
        createMediaStreamSource() {
            return {
                connect: vi.fn(),
                disconnect: vi.fn(),
            }
        }

        createAnalyser() {
            return new FakeAnalyserNode() as unknown as AnalyserNode
        }

        createGain() {
            return {
                gain: { value: 1 },
                connect: vi.fn(),
                disconnect: vi.fn(),
            } as unknown as GainNode
        }

        createMediaStreamDestination() {
            return {
                stream: mocks.streamMock as unknown as MediaStream,
                connect: vi.fn(),
                disconnect: vi.fn(),
            } as unknown as MediaStreamAudioDestinationNode
        }

        async close() {
            return undefined
        }
    }

    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

import { useVoice } from '@/hooks/useVoice'

describe('useVoice join/leave flow', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
            async () => mocks.streamMock as unknown as MediaStream,
        )
        mocks.channelFactoryMock.mockReset()
        mocks.channelFactoryMock
            .mockImplementationOnce(() => mocks.signalChannelMock)
            .mockImplementationOnce(() => mocks.participantsSyncChannelMock)
    })

    it('kanala bağlanır ve ayrılırken kaynakları temizler', async () => {
        const { result, rerender, unmount } = renderHook(
            ({ activeChannelId }) => useVoice(activeChannelId),
            { initialProps: { activeChannelId: 'voice-1' as string | null } },
        )

        await waitFor(() => {
            expect(result.current.isConnected).toBe(true)
        })
        expect(mocks.upsertMock).toHaveBeenCalled()

        await act(async () => {
            rerender({ activeChannelId: null })
        })

        await waitFor(() => {
            expect(result.current.isConnected).toBe(false)
        })

        expect(mocks.deleteByChannelEqMock).toHaveBeenCalledWith('channel_id', 'voice-1')
        expect(mocks.deleteByUserEqMock).toHaveBeenCalledWith('user_id', mocks.testUser.id)
        expect(mocks.signalChannelMock.unsubscribe).toHaveBeenCalled()
        expect(mocks.participantsSyncChannelMock.unsubscribe).toHaveBeenCalled()

        unmount()
    })

    it('mute toggle komutu participant state kaydini gunceller', async () => {
        const { result } = renderHook(
            ({ activeChannelId }) => useVoice(activeChannelId),
            { initialProps: { activeChannelId: 'voice-1' as string | null } },
        )

        await waitFor(() => {
            expect(result.current.isConnected).toBe(true)
        })

        await act(async () => {
            await result.current.toggleMute()
        })

        expect(result.current.isMuted).toBe(true)
        expect(mocks.updateMock).toHaveBeenCalledWith({ is_muted: true })
        expect(mocks.updateByChannelEqMock).toHaveBeenCalledWith('channel_id', 'voice-1')
        expect(mocks.updateByUserEqMock).toHaveBeenCalledWith('user_id', mocks.testUser.id)
    })

    it('deafen toggle mikrofonu da birlikte kapatip acar', async () => {
        const { result } = renderHook(
            ({ activeChannelId }) => useVoice(activeChannelId),
            { initialProps: { activeChannelId: 'voice-1' as string | null } },
        )

        await waitFor(() => {
            expect(result.current.isConnected).toBe(true)
        })

        await act(async () => {
            await result.current.toggleDeafen()
        })

        expect(result.current.isDeafened).toBe(true)
        expect(result.current.isMuted).toBe(true)
        expect(mocks.trackMock.enabled).toBe(false)
        expect(mocks.updateMock).toHaveBeenCalledWith({ is_muted: true, is_deafened: true })

        await act(async () => {
            await result.current.toggleDeafen()
        })

        expect(result.current.isDeafened).toBe(false)
        expect(result.current.isMuted).toBe(false)
        expect(mocks.trackMock.enabled).toBe(true)
        expect(mocks.updateMock).toHaveBeenCalledWith({ is_muted: false, is_deafened: false })
    })

    it('join sirasinda upsert hatasi olursa bagli statee gecmez', async () => {
        mocks.upsertMock.mockImplementationOnce(async () => ({ error: { message: 'fk error' } as unknown }))

        const { result } = renderHook(
            ({ activeChannelId }) => useVoice(activeChannelId),
            { initialProps: { activeChannelId: 'voice-1' as string | null } },
        )

        await waitFor(() => {
            expect(result.current.isConnected).toBe(false)
        })

        expect(mocks.deleteByChannelEqMock).toHaveBeenCalledWith('channel_id', 'voice-1')
    })

    it('ilk join denemesi stale kalirsa ikinci denemede tek seferde baglanir', async () => {
        let resolveFirstJoin: ((value: MediaStream) => void) | null = null
        const firstJoinPromise = new Promise<MediaStream>((resolve) => {
            resolveFirstJoin = resolve
        })

        vi.mocked(navigator.mediaDevices.getUserMedia)
            .mockImplementationOnce(() => firstJoinPromise)
            .mockImplementationOnce(async () => mocks.streamMock as unknown as MediaStream)

        const { result, rerender } = renderHook(
            ({ activeChannelId }) => useVoice(activeChannelId),
            { initialProps: { activeChannelId: 'voice-1' as string | null } },
        )

        await act(async () => {
            rerender({ activeChannelId: null })
        })

        await act(async () => {
            rerender({ activeChannelId: 'voice-1' })
        })

        await waitFor(() => {
            expect(result.current.isConnected).toBe(true)
        })

        await act(async () => {
            resolveFirstJoin?.(mocks.streamMock as unknown as MediaStream)
            await Promise.resolve()
        })

        expect(mocks.upsertMock).toHaveBeenCalledTimes(1)
    })
})
