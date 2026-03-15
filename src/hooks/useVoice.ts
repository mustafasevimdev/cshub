import { useState, useEffect, useRef, useCallback } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores'
import type { User, UserRow, VoiceParticipant, VoiceParticipantRow } from '@/types'
import { AUDIO_SETTINGS_CHANGE_EVENT, getSavedAudioSettings } from './useAudioSettings'
import type { AudioSettings } from './useAudioSettings'

const RTC_CONFIG: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'stun:openrelay.metered.ca:80' },
        {
            urls: [
                'turn:openrelay.metered.ca:80',
                'turn:openrelay.metered.ca:443',
                'turn:openrelay.metered.ca:443?transport=tcp',
            ],
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
    ],
}

type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'speaking' | 'renegotiate'
type SignalData = RTCSessionDescriptionInit | RTCIceCandidateInit | { isSpeaking: boolean } | null

interface VoiceSignalPayload {
    type: SignalType
    data: SignalData
    fromUserId: string
    toUserId?: string
}

interface VoiceBroadcastEnvelope {
    payload: VoiceSignalPayload
}

interface PresenceUser {
    user_id: string
}

type SinkableAudioElement = HTMLAudioElement & {
    playsInline?: boolean
    setSinkId?: (deviceId: string) => Promise<void>
}

interface RemoteAudioController {
    audio: SinkableAudioElement
}



interface VoiceState {
    isConnected: boolean
    isMuted: boolean
    isDeafened: boolean
    isScreenSharing: boolean
    screenShareStream: MediaStream | null
    participants: VoiceParticipant[]
    localStream: MediaStream | null
    remoteStreams: Map<string, MediaStream>
    speakingUsers: Set<string>
}

function toPublicUser(userRow: UserRow): User {
    const { password_hash, ...publicUser } = userRow
    void password_hash
    return publicUser
}

function shouldInitiatePeerConnection(currentUserId: string, targetUserId: string) {
    return currentUserId.localeCompare(targetUserId) < 0
}

export function useVoice(channelId: string | null) {
    const userId = useAuthStore((state) => state.user?.id)
    const [state, setState] = useState<VoiceState>({
        isConnected: false,
        isMuted: false,
        isDeafened: false,
        isScreenSharing: false,
        screenShareStream: null,
        participants: [],
        localStream: null,
        remoteStreams: new Map(),
        speakingUsers: new Set(),
    })

    const localStreamRef = useRef<MediaStream | null>(null)
    const rawLocalStreamRef = useRef<MediaStream | null>(null)
    const screenShareStreamRef = useRef<MediaStream | null>(null)
    const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
    const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
    const signalChannelRef = useRef<RealtimeChannel | null>(null)
    const participantsSyncChannelRef = useRef<RealtimeChannel | null>(null)
    const remoteAudioRefs = useRef<Map<string, SinkableAudioElement>>(new Map())
    const remoteAudioControllersRef = useRef<Map<string, RemoteAudioController>>(new Map())

    const audioContextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const microphoneGainRef = useRef<GainNode | null>(null)
    const animationFrameRef = useRef<number | null>(null)
    const isJoiningRef = useRef(false)
    const isConnectedRef = useRef(false)
    const joinAttemptRef = useRef(0)
    const joinRetryIntervalRef = useRef<number | null>(null)
    const muteOperationRef = useRef(0)
    const deafenOperationRef = useRef(0)
    const isMutedRef = useRef(false)
    const isDeafenedRef = useRef(false)
    const audioSettingsRef = useRef<AudioSettings>(getSavedAudioSettings())

    useEffect(() => {
        isMutedRef.current = state.isMuted
    }, [state.isMuted])

    useEffect(() => {
        isDeafenedRef.current = state.isDeafened
    }, [state.isDeafened])

    const setAudioSinkId = useCallback(async (audio: SinkableAudioElement, outputDeviceId: string) => {
        if (typeof audio.setSinkId !== 'function') return

        try {
            await audio.setSinkId(outputDeviceId === 'default' ? '' : outputDeviceId)
        } catch (error) {
            console.error('Failed to set remote output device:', error)
        }
    }, [])

    const disposeRemoteAudioController = useCallback((targetUserId: string) => {
        const controller = remoteAudioControllersRef.current.get(targetUserId)
        if (!controller) return

        controller.audio.pause()
        controller.audio.srcObject = null
        remoteAudioControllersRef.current.delete(targetUserId)
        remoteAudioRefs.current.delete(targetUserId)
    }, [])

    const upsertRemoteTrack = useCallback((targetUserId: string, track: MediaStreamTrack) => {
        setState((prev) => {
            const nextStreams = new Map(prev.remoteStreams)
            const mergedStream = nextStreams.get(targetUserId) ?? new MediaStream()

            mergedStream.getTracks()
                .filter((existingTrack) => existingTrack.kind === track.kind && existingTrack.id !== track.id)
                .forEach((existingTrack) => {
                    mergedStream.removeTrack(existingTrack)
                })

            if (!mergedStream.getTracks().some((existingTrack) => existingTrack.id === track.id)) {
                mergedStream.addTrack(track)
            }

            nextStreams.set(targetUserId, mergedStream)
            return { ...prev, remoteStreams: nextStreams }
        })

        track.onended = () => {
            setState((prev) => {
                const nextStreams = new Map(prev.remoteStreams)
                const mergedStream = nextStreams.get(targetUserId)
                if (!mergedStream) return prev

                mergedStream.getTracks()
                    .filter((existingTrack) => existingTrack.id === track.id)
                    .forEach((existingTrack) => {
                        mergedStream.removeTrack(existingTrack)
                    })

                if (mergedStream.getTracks().length === 0) nextStreams.delete(targetUserId)
                else nextStreams.set(targetUserId, mergedStream)

                return { ...prev, remoteStreams: nextStreams }
            })
        }
    }, [])

    const applyOutputAudioSettings = useCallback(
        async (settings: AudioSettings) => {
            remoteAudioControllersRef.current.forEach((controller) => {
                controller.audio.muted = isDeafenedRef.current
                controller.audio.volume = Math.min(1, Math.max(0, settings.outputVolume / 100))
            })

            await Promise.all(
                Array.from(remoteAudioControllersRef.current.values()).map(({ audio }) =>
                    setAudioSinkId(audio, settings.outputDeviceId),
                ),
            )
        },
        [setAudioSinkId],
    )

    const ensureAudioContextRunning = useCallback(async (audioContext: AudioContext | null) => {
        if (!audioContext || audioContext.state === 'running') return
        if (typeof audioContext.resume !== 'function') return

        try {
            await audioContext.resume()
        } catch (error) {
            console.error('Failed to resume audio context:', error)
        }
    }, [])

    const applyInputAudioSettings = useCallback(async (settings: AudioSettings) => {
        if (microphoneGainRef.current) {
            microphoneGainRef.current.gain.value = settings.inputVolume / 100
        }

        const activeTrack = rawLocalStreamRef.current?.getAudioTracks()[0]
        if (!activeTrack) return

        try {
            await activeTrack.applyConstraints({
                noiseSuppression: settings.noiseSuppression,
                echoCancellation: settings.echoCancellation,
            })
        } catch (error) {
            console.error('Failed to apply live microphone constraints:', error)
        }
    }, [])

    const requestVoiceStream = useCallback(async (settings: AudioSettings) => {
        const baseConstraints: MediaStreamConstraints = {
            audio: {
                deviceId: settings.inputDeviceId !== 'default'
                    ? { exact: settings.inputDeviceId }
                    : undefined,
                echoCancellation: settings.echoCancellation,
                noiseSuppression: settings.noiseSuppression,
                autoGainControl: true,
            },
            video: false,
        }

        try {
            return await navigator.mediaDevices.getUserMedia(baseConstraints)
        } catch (error) {
            console.warn('Initial getUserMedia failed, attempting fallback...', error)
            
            try {
                // Fallback 1: Try without exact deviceId (in case the saved device is gone)
                return await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: settings.echoCancellation,
                        noiseSuppression: settings.noiseSuppression,
                        autoGainControl: true,
                    },
                    video: false,
                })
            } catch (fallbackError) {
                console.warn('Fallback getUserMedia failed, attempting generic audio...', fallbackError)
                
                try {
                    // Fallback 2: Try with absolute generic audio
                    return await navigator.mediaDevices.getUserMedia({ audio: true })
                } catch (finalError) {
                    console.error('All getUserMedia attempts failed:', finalError)
                    window.alert('Mikrofona erisilemedi. Lutfen tarayici/uygulama izinlerini kontrol edin veya mikrofonun takili oldugundan emin olun.')
                    return new MediaStream()
                }
            }
        }
    }, [])

    const withTimeout = useCallback(async <T,>(operation: PromiseLike<T>, timeoutMs: number, label: string) => {
        let timeoutId: number | null = null

        try {
            return await Promise.race([
                Promise.resolve(operation),
                new Promise<T>((_, reject) => {
                    timeoutId = window.setTimeout(() => {
                        reject(new Error(`${label} timed out`))
                    }, timeoutMs)
                }),
            ])
        } finally {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId)
            }
        }
    }, [])

    const updateParticipantState = useCallback(
        async (patch: Partial<Pick<VoiceParticipantRow, 'is_muted' | 'is_deafened' | 'is_screen_sharing'>>) => {
            if (!userId || !channelId) return false

            const { error } = await supabase.from('voice_participants')
                .update(patch as never)
                .eq('channel_id', channelId)
                .eq('user_id', userId)

            if (error) {
                console.error('Voice participant update failed:', error)
                return false
            }

            return true
        },
        [channelId, userId],
    )

    const cleanup = useCallback(async () => {
        joinAttemptRef.current += 1
        isConnectedRef.current = false
        isJoiningRef.current = false
        if (joinRetryIntervalRef.current !== null) {
            window.clearInterval(joinRetryIntervalRef.current)
            joinRetryIntervalRef.current = null
        }

        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = null
        }

        const inputAudioContext = audioContextRef.current
        audioContextRef.current = null
        if (inputAudioContext) {
            await inputAudioContext.close()
        }
        analyserRef.current = null
        microphoneGainRef.current = null

        const outboundStream = localStreamRef.current
        localStreamRef.current = null
        if (outboundStream) {
            outboundStream.getTracks().forEach((track) => track.stop())
        }
        const rawStream = rawLocalStreamRef.current
        rawLocalStreamRef.current = null
        if (rawStream && rawStream !== outboundStream) {
            rawStream.getTracks().forEach((track) => track.stop())
        }
        const screenShareStream = screenShareStreamRef.current
        screenShareStreamRef.current = null
        if (screenShareStream) {
            screenShareStream.getTracks().forEach((track) => track.stop())
        }

        peersRef.current.forEach((peer) => peer.close())
        peersRef.current.clear()
        pendingIceCandidatesRef.current.clear()

        remoteAudioControllersRef.current.forEach((_, targetUserId) => {
            disposeRemoteAudioController(targetUserId)
        })
        remoteAudioRefs.current.clear()
        remoteAudioControllersRef.current.clear()

        const participantsSyncChannel = participantsSyncChannelRef.current
        participantsSyncChannelRef.current = null
        if (participantsSyncChannel) {
            await participantsSyncChannel.unsubscribe()
        }
        const signalChannel = signalChannelRef.current
        signalChannelRef.current = null
        if (signalChannel) {
            await signalChannel.unsubscribe()
        }

        setState((prev) => ({
            ...prev,
            isConnected: false,
            isMuted: false,
            isDeafened: false,
            isScreenSharing: false,
            screenShareStream: null,
            localStream: null,
            remoteStreams: new Map(),
            participants: [],
            speakingUsers: new Set(),
        }))
        isMutedRef.current = false
        isDeafenedRef.current = false

        if (userId && channelId) {
            await supabase.from('voice_participants').delete().eq('channel_id', channelId).eq('user_id', userId)
        }
    }, [channelId, disposeRemoteAudioController, userId])

    const sendSignal = useCallback(
        async (type: SignalType, data: SignalData, toUserId?: string) => {
            if (!signalChannelRef.current || !userId) return

            await signalChannelRef.current.send({
                type: 'broadcast',
                event: 'signal',
                payload: { type, data, fromUserId: userId, toUserId },
            })
        },
        [userId],
    )

    const createPeerConnection = useCallback(
        (targetUserId: string) => {
            const peerConnection = new RTCPeerConnection(RTC_CONFIG)

            localStreamRef.current?.getTracks().forEach((track) => {
                if (localStreamRef.current) {
                    peerConnection.addTrack(track, localStreamRef.current)
                }
            })

            const activeScreenTrack = screenShareStreamRef.current?.getVideoTracks()[0]
            if (activeScreenTrack && screenShareStreamRef.current) {
                peerConnection.addTrack(activeScreenTrack, screenShareStreamRef.current)
            }

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    void sendSignal('ice-candidate', event.candidate.toJSON(), targetUserId)
                }
            }

            peerConnection.ontrack = (event) => {
                const stream = event.streams[0]
                const incomingTrack = event.track
                if (!stream || !incomingTrack) return

                upsertRemoteTrack(targetUserId, incomingTrack)

                if (stream.getAudioTracks().length === 0) return

                disposeRemoteAudioController(targetUserId)

                const audio = new Audio() as SinkableAudioElement
                audio.srcObject = stream
                audio.autoplay = true
                audio.playsInline = true
                audio.volume = Math.min(1, Math.max(0, audioSettingsRef.current.outputVolume / 100))
                audio.muted = isDeafenedRef.current

                stream.getAudioTracks().forEach((track) => {
                    track.enabled = !isDeafenedRef.current
                })

                remoteAudioRefs.current.set(targetUserId, audio)
                remoteAudioControllersRef.current.set(targetUserId, {
                    audio,
                })

                void setAudioSinkId(audio, audioSettingsRef.current.outputDeviceId)
                void audio.play().catch((error) => {
                    console.error('Remote audio autoplay failed:', error)
                    const retryPlayback = () => {
                        void audio.play().catch(() => undefined)
                    }
                    window.addEventListener('pointerdown', retryPlayback, { once: true })
                    window.addEventListener('keydown', retryPlayback, { once: true })
                })
            }

            peerConnection.oniceconnectionstatechange = async () => {
                if (
                    peerConnection.iceConnectionState !== 'failed' ||
                    !userId ||
                    !shouldInitiatePeerConnection(userId, targetUserId) ||
                    !isConnectedRef.current
                ) {
                    return
                }

                try {
                    const restartOffer = await peerConnection.createOffer({ iceRestart: true })
                    await peerConnection.setLocalDescription(restartOffer)
                    await sendSignal('offer', restartOffer, targetUserId)
                } catch (error) {
                    console.error('ICE restart offer failed:', error)
                }
            }

            peerConnection.onnegotiationneeded = async () => {
                if (
                    peerConnection.signalingState !== 'stable' ||
                    !isConnectedRef.current ||
                    !peerConnection.remoteDescription
                ) return

                try {
                    const offer = await peerConnection.createOffer()
                    if (peerConnection.signalingState !== 'stable') return
                    await peerConnection.setLocalDescription(offer)
                    await sendSignal('offer', offer, targetUserId)
                } catch (error) {
                    console.error('Negotiation Error:', error)
                }
            }

            peersRef.current.set(targetUserId, peerConnection)
            return peerConnection
        },
        [disposeRemoteAudioController, sendSignal, setAudioSinkId, upsertRemoteTrack, userId],
    )

    const flushPendingIceCandidates = useCallback(async (targetUserId: string, peerConnection: RTCPeerConnection) => {
        const queuedCandidates = pendingIceCandidatesRef.current.get(targetUserId)
        if (!queuedCandidates || queuedCandidates.length === 0) return

        pendingIceCandidatesRef.current.delete(targetUserId)
        await Promise.all(
            queuedCandidates.map(async (candidate) => {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                } catch (error) {
                    console.error('Failed to apply queued ICE candidate:', error)
                }
            }),
        )
    }, [])

    const handleSignal = useCallback(
        async (payload: VoiceSignalPayload) => {
            const { type, fromUserId, data } = payload
            if (!userId || fromUserId === userId) return

            let peerConnection = peersRef.current.get(fromUserId)
            if (!peerConnection && type === 'offer') {
                peerConnection = createPeerConnection(fromUserId)
            }
            if (!peerConnection) {
                if (type === 'ice-candidate' && data) {
                    const queuedCandidates = pendingIceCandidatesRef.current.get(fromUserId) ?? []
                    queuedCandidates.push(data as RTCIceCandidateInit)
                    pendingIceCandidatesRef.current.set(fromUserId, queuedCandidates)
                }
                return
            }

            try {
                if (type === 'offer' && data) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit))
                    await flushPendingIceCandidates(fromUserId, peerConnection)
                    const answer = await peerConnection.createAnswer()
                    await peerConnection.setLocalDescription(answer)
                    await sendSignal('answer', answer, fromUserId)
                    return
                }

                if (type === 'answer' && data) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit))
                    await flushPendingIceCandidates(fromUserId, peerConnection)
                    return
                }

                if (type === 'ice-candidate' && data) {
                    const candidate = data as RTCIceCandidateInit
                    if (!peerConnection) {
                        const queuedCandidates = pendingIceCandidatesRef.current.get(fromUserId) ?? []
                        queuedCandidates.push(candidate)
                        pendingIceCandidatesRef.current.set(fromUserId, queuedCandidates)
                        return
                    }

                    if (!peerConnection.remoteDescription) {
                        const queuedCandidates = pendingIceCandidatesRef.current.get(fromUserId) ?? []
                        queuedCandidates.push(candidate)
                        pendingIceCandidatesRef.current.set(fromUserId, queuedCandidates)
                        return
                    }

                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                    return
                }

                if (type === 'speaking') {
                    const speakingData = data as { isSpeaking: boolean } | null
                    if (!speakingData) return

                    setState((prev) => {
                        const nextSpeakingUsers = new Set(prev.speakingUsers)
                        if (speakingData.isSpeaking) nextSpeakingUsers.add(fromUserId)
                        else nextSpeakingUsers.delete(fromUserId)
                        return { ...prev, speakingUsers: nextSpeakingUsers }
                    })
                }
            } catch (error) {
                console.error('WebRTC Signal Error:', error)
            }
        },
        [createPeerConnection, flushPendingIceCandidates, sendSignal, userId],
    )

    const fetchParticipants = useCallback(async () => {
        if (!channelId) return

        const { data, error } = await supabase.from('voice_participants').select('*').eq('channel_id', channelId)
        if (error || !data) return

        const typedParticipants = data as VoiceParticipantRow[]
        const userIds = [...new Set(typedParticipants.map((participant) => participant.user_id))]
        const usersMap: Record<string, User> = {}

        if (userIds.length > 0) {
            const { data: users } = await supabase.from('users').select('*').in('id', userIds)
            ;(users as UserRow[] | null)?.forEach((userRow) => {
                usersMap[userRow.id] = toPublicUser(userRow)
            })
        }

        setState((prev) => ({
            ...prev,
            participants: typedParticipants.map((participant: VoiceParticipantRow) => ({
                ...participant,
                user: usersMap[participant.user_id],
            })),
        }))
    }, [channelId])

    const detectSpeaking = useCallback(() => {
        if (!analyserRef.current || !userId) return

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
        let wasSpeaking = false

        const tick = () => {
            if (!analyserRef.current) return

            analyserRef.current.getByteFrequencyData(dataArray)
            const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
            const isSpeaking = !isMutedRef.current && !isDeafenedRef.current && average > 30

            if (isSpeaking !== wasSpeaking) {
                wasSpeaking = isSpeaking

                setState((prev) => {
                    const nextSpeakingUsers = new Set(prev.speakingUsers)
                    if (isSpeaking) nextSpeakingUsers.add(userId)
                    else nextSpeakingUsers.delete(userId)
                    return { ...prev, speakingUsers: nextSpeakingUsers }
                })

                void sendSignal('speaking', { isSpeaking })
            }

            animationFrameRef.current = requestAnimationFrame(tick)
        }

        tick()
    }, [sendSignal, userId])

    const clearLocalSpeaking = useCallback(() => {
        if (!userId) return

        setState((prev) => {
            const nextSpeakingUsers = new Set(prev.speakingUsers)
            nextSpeakingUsers.delete(userId)
            return { ...prev, speakingUsers: nextSpeakingUsers }
        })

        void sendSignal('speaking', { isSpeaking: false })
    }, [sendSignal, userId])

    const initiateConnection = useCallback(
        async (targetUserId: string) => {
            const peerConnection = createPeerConnection(targetUserId)
            const offer = await peerConnection.createOffer()
            await peerConnection.setLocalDescription(offer)
            await sendSignal('offer', offer, targetUserId)
        },
        [createPeerConnection, sendSignal],
    )

    const connectToParticipant = useCallback(
        async (targetUserId: string) => {
            if (!userId || targetUserId === userId) return
            if (!shouldInitiatePeerConnection(userId, targetUserId)) return
            if (peersRef.current.has(targetUserId)) return

            await initiateConnection(targetUserId)
        },
        [initiateConnection, userId],
    )

    const connectToExistingParticipants = useCallback(async () => {
        if (!channelId || !userId) return

        const { data, error } = await supabase.from('voice_participants')
            .select('user_id')
            .eq('channel_id', channelId)

        if (error || !data) {
            if (error) {
                console.error('Failed to fetch existing voice participants:', error)
            }
            return
        }

        const participantUserIds = [...new Set((data as Array<{ user_id: string }>).map((participant) => participant.user_id))]
        await Promise.all(
            participantUserIds
                .filter((participantUserId) => participantUserId !== userId)
                .map((participantUserId) => connectToParticipant(participantUserId)),
        )
    }, [channelId, connectToParticipant, userId])

    const joinVoice = useCallback(async () => {
        if (!userId || !channelId || isConnectedRef.current || isJoiningRef.current) return

        const attemptId = joinAttemptRef.current + 1
        joinAttemptRef.current = attemptId
        isJoiningRef.current = true
        let joinedSignalChannel: RealtimeChannel | null = null
        let joinedParticipantsSyncChannel: RealtimeChannel | null = null
        let joinedRawStream: MediaStream | null = null
        let joinedOutboundStream: MediaStream | null = null
        let joinedAudioContext: AudioContext | null = null
        let joinedAnalyser: AnalyserNode | null = null
        let joinedMicrophoneGain: GainNode | null = null
        let resolveSignalSubscribed: (() => void) | null = null
        const signalSubscribedPromise = new Promise<void>((resolve) => {
            resolveSignalSubscribed = resolve
        })

        const isStaleAttempt = () => joinAttemptRef.current !== attemptId
        const disposeJoinAttemptResources = async () => {
            if (joinedParticipantsSyncChannel && participantsSyncChannelRef.current !== joinedParticipantsSyncChannel) {
                await joinedParticipantsSyncChannel.unsubscribe()
            }
            if (joinedSignalChannel && signalChannelRef.current !== joinedSignalChannel) {
                await joinedSignalChannel.unsubscribe()
            }
            if (joinedAudioContext && audioContextRef.current !== joinedAudioContext) {
                await joinedAudioContext.close()
            }

            const handledStreams = new Set<MediaStream>()
            ;[joinedOutboundStream, joinedRawStream].forEach((stream) => {
                if (!stream || handledStreams.has(stream)) return
                handledStreams.add(stream)
                stream.getTracks().forEach((track) => track.stop())
            })
        }

        try {
            const currentAudioSettings = getSavedAudioSettings()
            audioSettingsRef.current = currentAudioSettings

            const stream = await requestVoiceStream(currentAudioSettings)

            joinedRawStream = stream
            joinedOutboundStream = stream

            if (stream.getAudioTracks().length > 0) {
                try {
                    const inputAudioContext = new AudioContext()
                    joinedAudioContext = inputAudioContext
                    await ensureAudioContextRunning(inputAudioContext)
                    const source = inputAudioContext.createMediaStreamSource(stream)
                    const microphoneGain = inputAudioContext.createGain()
                    microphoneGain.gain.value = currentAudioSettings.inputVolume / 100
                    joinedMicrophoneGain = microphoneGain

                    const analyser = inputAudioContext.createAnalyser()
                    analyser.fftSize = 256
                    joinedAnalyser = analyser
                    const destination = inputAudioContext.createMediaStreamDestination()

                    source.connect(microphoneGain)
                    microphoneGain.connect(analyser)
                    microphoneGain.connect(destination)
                    joinedOutboundStream = destination.stream
                } catch (error) {
                    console.error('Audio analysis setup failed:', error)
                }
            }

            if (isStaleAttempt()) {
                await disposeJoinAttemptResources()
                return
            }

            rawLocalStreamRef.current = joinedRawStream
            localStreamRef.current = joinedOutboundStream
            audioContextRef.current = joinedAudioContext
            analyserRef.current = joinedAnalyser
            microphoneGainRef.current = joinedMicrophoneGain

            if (joinedAnalyser) {
                detectSpeaking()
            }

            const signalChannel = supabase.channel(`voice:${channelId}`, {
                config: { broadcast: { self: false } },
            })
            joinedSignalChannel = signalChannel
            signalChannelRef.current = signalChannel

            signalChannel
                .on('broadcast', { event: 'signal' }, ({ payload }: VoiceBroadcastEnvelope) => {
                    if (!payload.toUserId || payload.toUserId === userId) {
                        void handleSignal(payload)
                    }
                })
                .on('presence', { event: 'join' }, ({ newPresences }: { newPresences: PresenceUser[] }) => {
                    newPresences.forEach((presence) => {
                        void connectToParticipant(presence.user_id)
                    })
                })
                .on('presence', { event: 'leave' }, ({ leftPresences }: { leftPresences: PresenceUser[] }) => {
                    leftPresences.forEach((presence) => {
                        const peerConnection = peersRef.current.get(presence.user_id)
                        peerConnection?.close()
                        peersRef.current.delete(presence.user_id)

                        disposeRemoteAudioController(presence.user_id)

                        setState((prev) => {
                            const nextStreams = new Map(prev.remoteStreams)
                            nextStreams.delete(presence.user_id)
                            return { ...prev, remoteStreams: nextStreams }
                        })
                    })
                })
                .subscribe(async (status) => {
                    if (status === 'SUBSCRIBED') {
                        await signalChannel.track({ user_id: userId, online_at: new Date().toISOString() })
                        resolveSignalSubscribed?.()
                    }
                })

            if (isStaleAttempt()) {
                await disposeJoinAttemptResources()
                return
            }

            await withTimeout(signalSubscribedPromise, 3000, 'voice signal subscribe')

            if (isStaleAttempt()) {
                await disposeJoinAttemptResources()
                return
            }

            const { error: upsertError } = await withTimeout(
                supabase.from('voice_participants').upsert({
                    channel_id: channelId,
                    user_id: userId,
                    is_muted: false,
                    is_deafened: false,
                } as never),
                3000,
                'voice participant upsert',
            )
            if (upsertError) throw upsertError

            if (isStaleAttempt()) {
                await disposeJoinAttemptResources()
                return
            }

            isConnectedRef.current = true
            setState((prev) => ({ ...prev, isConnected: true, localStream: joinedOutboundStream }))
            void fetchParticipants()
            void connectToExistingParticipants()

            const participantsSyncChannel = supabase
                .channel(`participants_sync_${channelId}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'voice_participants',
                        filter: `channel_id=eq.${channelId}`,
                    },
                    () => {
                        void fetchParticipants()
                    },
                )
                .subscribe()

            joinedParticipantsSyncChannel = participantsSyncChannel
            if (isStaleAttempt()) {
                await disposeJoinAttemptResources()
                return
            }

            participantsSyncChannelRef.current = participantsSyncChannel

            if (joinRetryIntervalRef.current !== null) {
                window.clearInterval(joinRetryIntervalRef.current)
                joinRetryIntervalRef.current = null
            }
        } catch (error) {
            if (isStaleAttempt()) {
                await disposeJoinAttemptResources()
                return
            }
            console.error('Failed to join voice channel:', error)
            await cleanup()
        } finally {
            if (!isStaleAttempt()) {
                isJoiningRef.current = false
            }
        }
    }, [
        userId,
        channelId,
        cleanup,
        detectSpeaking,
        disposeRemoteAudioController,
        fetchParticipants,
        handleSignal,
        connectToExistingParticipants,
        connectToParticipant,
        requestVoiceStream,
        ensureAudioContextRunning,
        withTimeout,
    ])

    const leaveVoice = useCallback(async () => {
        await cleanup()
    }, [cleanup])

    const toggleMute = useCallback(async () => {
        if (!userId || !channelId) return

        const previousMuted = isMutedRef.current
        const nextMuted = !previousMuted
        isMutedRef.current = nextMuted
        state.localStream?.getAudioTracks().forEach((track) => {
            track.enabled = !nextMuted
        })

        if (nextMuted) {
            clearLocalSpeaking()
        }

        setState((prev) => ({
            ...prev,
            isMuted: nextMuted,
            participants: prev.participants.map((participant) =>
                participant.user_id === userId ? { ...participant, is_muted: nextMuted } : participant,
            ),
        }))

        muteOperationRef.current += 1
        const operationId = muteOperationRef.current
        const updated = await updateParticipantState({ is_muted: nextMuted })
        if (updated || operationId !== muteOperationRef.current) return

        isMutedRef.current = previousMuted
        state.localStream?.getAudioTracks().forEach((track) => {
            track.enabled = !previousMuted
        })
        setState((prev) => ({
            ...prev,
            isMuted: previousMuted,
            participants: prev.participants.map((participant) =>
                participant.user_id === userId ? { ...participant, is_muted: previousMuted } : participant,
            ),
        }))
    }, [clearLocalSpeaking, state.localStream, userId, channelId, updateParticipantState])

    const toggleDeafen = useCallback(async () => {
        if (!userId || !channelId) return

        const previousDeafened = isDeafenedRef.current
        const previousMuted = isMutedRef.current
        const nextDeafened = !previousDeafened
        const nextMuted = nextDeafened
        isDeafenedRef.current = nextDeafened
        isMutedRef.current = nextMuted
        muteOperationRef.current += 1
        state.remoteStreams.forEach((stream) => {
            stream.getAudioTracks().forEach((track) => {
                track.enabled = !nextDeafened
            })
        })
        state.localStream?.getAudioTracks().forEach((track) => {
            track.enabled = !nextMuted
        })
        remoteAudioRefs.current.forEach((audio) => {
            audio.muted = nextDeafened
        })

        if (nextDeafened || nextMuted) {
            clearLocalSpeaking()
        }

        setState((prev) => ({
            ...prev,
            isMuted: nextMuted,
            isDeafened: nextDeafened,
            participants: prev.participants.map((participant) =>
                participant.user_id === userId
                    ? { ...participant, is_muted: nextMuted, is_deafened: nextDeafened }
                    : participant,
            ),
        }))

        deafenOperationRef.current += 1
        const operationId = deafenOperationRef.current
        const updated = await updateParticipantState({ is_muted: nextMuted, is_deafened: nextDeafened })
        if (updated || operationId !== deafenOperationRef.current) return

        isDeafenedRef.current = previousDeafened
        isMutedRef.current = previousMuted
        state.remoteStreams.forEach((stream) => {
            stream.getAudioTracks().forEach((track) => {
                track.enabled = !previousDeafened
            })
        })
        state.localStream?.getAudioTracks().forEach((track) => {
            track.enabled = !previousMuted
        })
        remoteAudioRefs.current.forEach((audio) => {
            audio.muted = previousDeafened
        })
        setState((prev) => ({
            ...prev,
            isMuted: previousMuted,
            isDeafened: previousDeafened,
            participants: prev.participants.map((participant) =>
                participant.user_id === userId
                    ? { ...participant, is_muted: previousMuted, is_deafened: previousDeafened }
                    : participant,
            ),
        }))
    }, [clearLocalSpeaking, state.remoteStreams, state.localStream, userId, channelId, updateParticipantState])

    const getScreenShareStream = useCallback(async () => {
        return navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 60, max: 60 },
            },
            audio: false,
        })
    }, [])

    const stopScreenShare = useCallback(async () => {
        if (!userId || !channelId) return

        peersRef.current.forEach((peerConnection) => {
            const sender = peerConnection.getSenders().find((candidate) => candidate.track?.kind === 'video')
            if (sender) {
                peerConnection.removeTrack(sender)
            }
        })

        if (screenShareStreamRef.current) {
            screenShareStreamRef.current.getTracks().forEach((track) => track.stop())
            screenShareStreamRef.current = null
        }

        const updated = await updateParticipantState({ is_screen_sharing: false })
        if (!updated) return

        setState((prev) => ({ ...prev, isScreenSharing: false, screenShareStream: null }))
    }, [userId, channelId, updateParticipantState])

    const startScreenShare = useCallback(async () => {
        if (!userId || !channelId || state.isScreenSharing) return

        try {
            const screenStream = await getScreenShareStream()
            const videoTrack = screenStream.getVideoTracks()[0]

            if (!videoTrack) {
                screenStream.getTracks().forEach((track) => track.stop())
                return
            }

            videoTrack.contentHint = 'detail'
            screenShareStreamRef.current = screenStream

            peersRef.current.forEach((peerConnection) => {
                const sender = peerConnection.getSenders().find((candidate) => candidate.track?.kind === 'video')
                if (sender) {
                    void sender.replaceTrack(videoTrack)
                } else {
                    peerConnection.addTrack(videoTrack, screenStream)
                }
            })

            videoTrack.onended = () => {
                void stopScreenShare()
            }

            const updated = await updateParticipantState({ is_screen_sharing: true })
            if (!updated) {
                screenStream.getTracks().forEach((track) => track.stop())
                screenShareStreamRef.current = null
                return
            }

            setState((prev) => ({ ...prev, isScreenSharing: true, screenShareStream: screenStream }))
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return

            const message = error instanceof Error ? error.message : 'Ekran paylasimi baslatilamadi.'
            console.error('Screen share failed:', error)
            window.alert(message)
        }
    }, [userId, channelId, getScreenShareStream, state.isScreenSharing, stopScreenShare, updateParticipantState])

    useEffect(() => {
        const handleAudioSettingsChange = (event: Event) => {
            const nextSettings = (event as CustomEvent<AudioSettings>).detail ?? getSavedAudioSettings()
            audioSettingsRef.current = nextSettings
            void applyInputAudioSettings(nextSettings)
            void applyOutputAudioSettings(nextSettings)
        }

        window.addEventListener(AUDIO_SETTINGS_CHANGE_EVENT, handleAudioSettingsChange as EventListener)
        return () => {
            window.removeEventListener(AUDIO_SETTINGS_CHANGE_EVENT, handleAudioSettingsChange as EventListener)
        }
    }, [applyInputAudioSettings, applyOutputAudioSettings])

    useEffect(() => {
        if (channelId) {
            void joinVoice()
            if (joinRetryIntervalRef.current !== null) {
                window.clearInterval(joinRetryIntervalRef.current)
            }
            joinRetryIntervalRef.current = window.setInterval(() => {
                if (!isConnectedRef.current && !isJoiningRef.current) {
                    void joinVoice()
                }
            }, 1500)
        } else {
            void cleanup()
        }

        const handleBeforeUnload = () => {
            if (!channelId || !userId) return

            const supabaseUrl = (import.meta as unknown as { env: Record<string, string> }).env.VITE_SUPABASE_URL
            const supabaseKey = (import.meta as unknown as { env: Record<string, string> }).env.VITE_SUPABASE_ANON_KEY
            if (!supabaseUrl || !supabaseKey) return

            const url = `${supabaseUrl}/rest/v1/voice_participants?channel_id=eq.${encodeURIComponent(channelId)}&user_id=eq.${encodeURIComponent(userId)}`
            void fetch(url, {
                method: 'DELETE',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                },
                keepalive: true,
            }).catch(() => {})
        }

        window.addEventListener('beforeunload', handleBeforeUnload)

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)
            void cleanup()
        }
    }, [channelId, joinVoice, cleanup, userId])

    return {
        ...state,
        joinVoice,
        leaveVoice,
        toggleMute,
        toggleDeafen,
        startScreenShare,
        stopScreenShare,
    }
}

