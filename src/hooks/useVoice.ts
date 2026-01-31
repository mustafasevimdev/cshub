import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores'
import type { VoiceParticipant, User } from '@/types'

// WebRTC Configuration
const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
}

interface VoiceState {
    isConnected: boolean
    isMuted: boolean
    isDeafened: boolean
    isScreenSharing: boolean
    participants: (VoiceParticipant & { user?: User })[]
    localStream: MediaStream | null
    remoteStreams: Map<string, MediaStream> // mp -> stream
    speakingUsers: Set<string>
}

export function useVoice(channelId: string | null) {
    const { user } = useAuthStore()
    const [state, setState] = useState<VoiceState>({
        isConnected: false,
        isMuted: false,
        isDeafened: false,
        isScreenSharing: false,
        participants: [],
        localStream: null,
        remoteStreams: new Map(),
        speakingUsers: new Set()
    })

    // Refs
    const localStreamRef = useRef<MediaStream | null>(null)
    const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
    const channelRef = useRef<any>(null)

    // Audio Analysis Refs
    const audioContextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const animationFrameRef = useRef<number | null>(null)

    // Cleanup function
    const cleanup = useCallback(async () => {
        console.log('Voice cleanup triggered for channel:', channelId)

        // Close audio context
        if (audioContextRef.current) {
            audioContextRef.current.close()
            audioContextRef.current = null
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current)
        }

        // Stop all tracks using Ref for stability
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop())
            localStreamRef.current = null
        }

        // Close peer connections
        peersRef.current.forEach(pc => pc.close())
        peersRef.current.clear()

        // Cleanup DB and Signal Subscriptions
        if (channelRef.current) {
            // Cleanup DB sync sub if exists
            if (channelRef.current.dbSub) {
                channelRef.current.dbSub.unsubscribe()
            }
            await channelRef.current.unsubscribe()
            channelRef.current = null
        }

        // Reset State
        setState(prev => ({
            ...prev,
            isConnected: false,
            isScreenSharing: false,
            localStream: null,
            remoteStreams: new Map(),
            participants: [],
            speakingUsers: new Set()
        }))

        // DB Cleanup
        if (user && channelId) {
            await (supabase.from('voice_participants') as any)
                .delete()
                .eq('channel_id', channelId)
                .eq('user_id', user.id)
        }
    }, [user?.id, channelId])

    // Signal Handling
    const handleSignal = useCallback(async (payload: any) => {
        const { type, fromUserId, data } = payload
        if (fromUserId === user?.id) return

        let pc = peersRef.current.get(fromUserId)

        // Create PC if needed (for incoming offers)
        if (!pc && type === 'offer') {
            pc = createPeerConnection(fromUserId)
        }

        if (!pc) return

        try {
            if (type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data))
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                sendSignal('answer', answer, fromUserId)
            } else if (type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data))
            } else if (type === 'ice-candidate') {
                if (data) await pc.addIceCandidate(new RTCIceCandidate(data))
            }
        } catch (error) {
            console.error('WebRTC Signal Error:', error)
        }
    }, [user])

    // Create RTCPeerConnection
    const createPeerConnection = (targetUserId: string) => {
        const pc = new RTCPeerConnection(RTC_CONFIG)

        // Add local tracks
        localStreamRef.current?.getTracks().forEach(track => {
            if (localStreamRef.current) {
                pc.addTrack(track, localStreamRef.current)
            }
        })

        // Handle ICE
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal('ice-candidate', event.candidate, targetUserId)
            }
        }

        // Handle Stream
        pc.ontrack = (event) => {
            const stream = event.streams[0]
            if (stream) {
                setState(prev => {
                    const newStreams = new Map(prev.remoteStreams)
                    newStreams.set(targetUserId, stream)

                    // Create invisible audio element to play stream
                    const audio = new Audio()
                    audio.srcObject = stream
                    audio.autoplay = true
                    audio.play().catch(console.error)

                    return { ...prev, remoteStreams: newStreams }
                })
            }
        }

        peersRef.current.set(targetUserId, pc)
        return pc
    }

    const sendSignal = async (type: string, data: any, toUserId?: string) => {
        if (!channelRef.current) return
        await channelRef.current.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type, data, fromUserId: user?.id, toUserId }
        })
    }

    // Join Channel
    const joinVoice = useCallback(async () => {
        if (!user || !channelId || state.isConnected) return

        try {
            // 1. Get Local Stream
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true, // Keep on for voice clarity, maybe off for "music mode" later
                    autoGainControl: true,
                    sampleRate: 48000, // High quality audio
                    channelCount: 2,   // Stereo support
                    sampleSize: 16     // CD Quality bit depth
                },
                video: false
            })
            localStreamRef.current = stream

            // 2. Setup Audio Analysis
            audioContextRef.current = new AudioContext()
            const source = audioContextRef.current.createMediaStreamSource(stream)
            analyserRef.current = audioContextRef.current.createAnalyser()
            analyserRef.current.fftSize = 256
            source.connect(analyserRef.current)
            detectSpeaking()

            // 3. Connect to Supabase Channel for Signaling
            channelRef.current = supabase.channel(`voice:${channelId}`, {
                config: { broadcast: { self: false } }
            })

            channelRef.current
                .on('broadcast', { event: 'signal' }, (payload: any) => {
                    // Filter signals meant for us
                    if (!payload.payload.toUserId || payload.payload.toUserId === user.id) {
                        handleSignal(payload.payload)
                    }
                })
                .on('presence', { event: 'join' }, ({ key, newPresences }: any) => {
                    // Initiate connection to new joiners
                    newPresences.forEach((presence: any) => {
                        if (presence.user_id !== user.id) {
                            initiateConnection(presence.user_id)
                        }
                    })
                })
                .on('presence', { event: 'leave' }, ({ leftPresences }: any) => {
                    leftPresences.forEach((presence: any) => {
                        const pc = peersRef.current.get(presence.user_id)
                        pc?.close()
                        peersRef.current.delete(presence.user_id)
                        setState(prev => {
                            const newStreams = new Map(prev.remoteStreams)
                            newStreams.delete(presence.user_id)
                            return { ...prev, remoteStreams: newStreams }
                        })
                    })
                })
                .subscribe(async (status: string) => {
                    if (status === 'SUBSCRIBED') {
                        // Track presence
                        await channelRef.current.track({ user_id: user.id, online_at: new Date().toISOString() })
                    }
                })

            // 4. Update DB State
            await (supabase.from('voice_participants') as any).upsert({
                channel_id: channelId,
                user_id: user.id,
                is_muted: false,
                is_deafened: false
            })

            // 5. Update Local State
            await fetchParticipants()
            setState(prev => ({ ...prev, isConnected: true, localStream: stream }))

            // 6. Listen for DB changes to sync participants UI
            const dbSubscription = supabase.channel(`participants_sync_${channelId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'voice_participants',
                    filter: `channel_id=eq.${channelId}`
                }, () => {
                    fetchParticipants()
                })
                .subscribe()

            // Store subscription for cleanup
            if (channelRef.current) {
                (channelRef.current as any).dbSub = dbSubscription;
            }

        } catch (err) {
            console.error('Failed to join voice:', err)
            cleanup()
        }
    }, [user, channelId, state.isConnected])

    const initiateConnection = async (targetUserId: string) => {
        const pc = createPeerConnection(targetUserId)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sendSignal('offer', offer, targetUserId)
    }

    const leaveVoice = () => cleanup()

    const fetchParticipants = async () => {
        if (!channelId) return
        try {
            console.log('Fetching participants for channel:', channelId)
            const { data, error } = await (supabase.from('voice_participants') as any).select('*').eq('channel_id', channelId)

            if (error) {
                console.error('Supabase error fetching participants:', error)
                return
            }

            if (data) {
                console.log('Participants data found:', data.length)
                const userIds = [...new Set(data.map((p: any) => p.user_id))]
                const { data: users } = await (supabase.from('users') as any).select('*').in('id', userIds)

                const usersMap: Record<string, User> = {}
                if (users) users.forEach((u: any) => { usersMap[u.id] = u })

                setState(prev => ({
                    ...prev,
                    participants: data.map((p: any) => ({ ...p, user: usersMap[p.user_id] }))
                }))
            }
        } catch (err) {
            console.error('Generic error in fetchParticipants:', err)
        }
    }

    // Audio Analysis Loop
    const detectSpeaking = () => {
        if (!analyserRef.current || !user) return
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)

        let lastIsSpeaking = false

        const check = () => {
            if (!analyserRef.current) return
            analyserRef.current.getByteFrequencyData(dataArray)
            const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

            const isSpeaking = average > 30 // Threshold 

            if (isSpeaking !== lastIsSpeaking) {
                lastIsSpeaking = isSpeaking
                setState(prev => {
                    const newSpeaking = new Set(prev.speakingUsers)
                    if (isSpeaking) newSpeaking.add(user.id)
                    else newSpeaking.delete(user.id)
                    return { ...prev, speakingUsers: newSpeaking }
                })
            }

            animationFrameRef.current = requestAnimationFrame(check)
        }
        check()
    }

    // Mute/Deafen Logic
    const toggleMute = async () => {
        if (!state.localStream || !user) return
        const newMuted = !state.isMuted
        state.localStream.getAudioTracks().forEach(t => t.enabled = !newMuted)
        await supabase.from('voice_participants').update({ is_muted: newMuted }).eq('channel_id', channelId).eq('user_id', user.id)
        setState(prev => ({ ...prev, isMuted: newMuted }))
    }

    const toggleDeafen = async () => {
        if (!user || !channelId) return
        // Toggle remote audio
        state.remoteStreams.forEach(stream => {
            stream.getAudioTracks().forEach(t => t.enabled = state.isDeafened)
        })
        const newDeafened = !state.isDeafened
        await supabase.from('voice_participants').update({ is_deafened: newDeafened }).eq('channel_id', channelId).eq('user_id', user.id)
        setState(prev => ({ ...prev, isDeafened: newDeafened }))
    }

    const startScreenShare = async () => {
        if (!user || !channelId) return
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })

            // Replace video track in all peer connections
            const videoTrack = screenStream.getVideoTracks()[0]

            peersRef.current.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video')
                if (sender) {
                    sender.replaceTrack(videoTrack)
                } else {
                    pc.addTrack(videoTrack, screenStream)
                }
            })

            // Handle stream stop (user clicks "Stop Sharing" in browser UI)
            videoTrack.onended = () => stopScreenShare()

            await supabase.from('voice_participants').update({ is_screen_sharing: true }).eq('channel_id', channelId).eq('user_id', user.id)
            setState(prev => ({ ...prev, isScreenSharing: true }))
        } catch (e) {
            console.error(e)
        }
    }

    const stopScreenShare = async () => {
        if (!user || !channelId) return

        // Remove video tracks
        peersRef.current.forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video')
            if (sender) {
                pc.removeTrack(sender)
            }
        })

        await supabase.from('voice_participants').update({ is_screen_sharing: false }).eq('channel_id', channelId).eq('user_id', user.id)
        setState(prev => ({ ...prev, isScreenSharing: false }))
    }

    // Cleanup on unmount
    useEffect(() => {
        return () => { cleanup() }
    }, [cleanup])

    return {
        ...state,
        joinVoice,
        leaveVoice,
        toggleMute,
        toggleDeafen,
        startScreenShare,
        stopScreenShare
    }
}
