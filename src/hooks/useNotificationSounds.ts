import { useCallback, useRef } from 'react'

let sharedAudioContext: AudioContext | null = null

function getAudioContext(): AudioContext {
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
        sharedAudioContext = new AudioContext()
    }
    if (sharedAudioContext.state === 'suspended') {
        void sharedAudioContext.resume()
    }
    return sharedAudioContext
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.15) {
    try {
        const ctx = getAudioContext()
        const oscillator = ctx.createOscillator()
        const gainNode = ctx.createGain()

        oscillator.type = type
        oscillator.frequency.setValueAtTime(frequency, ctx.currentTime)
        gainNode.gain.setValueAtTime(volume, ctx.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

        oscillator.connect(gainNode)
        gainNode.connect(ctx.destination)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + duration)
    } catch {
        // Audio context might be blocked — silently fail
    }
}

function playJoin() {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    try {
        // Ascending two-note chime
        const osc1 = ctx.createOscillator()
        const osc2 = ctx.createOscillator()
        const gain1 = ctx.createGain()
        const gain2 = ctx.createGain()

        osc1.type = 'sine'
        osc1.frequency.value = 587 // D5
        gain1.gain.setValueAtTime(0.12, now)
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
        osc1.connect(gain1).connect(ctx.destination)
        osc1.start(now)
        osc1.stop(now + 0.15)

        osc2.type = 'sine'
        osc2.frequency.value = 784 // G5
        gain2.gain.setValueAtTime(0.12, now + 0.08)
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
        osc2.connect(gain2).connect(ctx.destination)
        osc2.start(now + 0.08)
        osc2.stop(now + 0.22)
    } catch {
        // silent
    }
}

function playLeave() {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    try {
        // Descending two-note chime
        const osc1 = ctx.createOscillator()
        const osc2 = ctx.createOscillator()
        const gain1 = ctx.createGain()
        const gain2 = ctx.createGain()

        osc1.type = 'sine'
        osc1.frequency.value = 784 // G5
        gain1.gain.setValueAtTime(0.12, now)
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
        osc1.connect(gain1).connect(ctx.destination)
        osc1.start(now)
        osc1.stop(now + 0.15)

        osc2.type = 'sine'
        osc2.frequency.value = 440 // A4
        gain2.gain.setValueAtTime(0.10, now + 0.08)
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
        osc2.connect(gain2).connect(ctx.destination)
        osc2.start(now + 0.08)
        osc2.stop(now + 0.22)
    } catch {
        // silent
    }
}

function playMessage() {
    playTone(880, 0.08, 'sine', 0.08)
}

export function useNotificationSounds() {
    const lastJoinRef = useRef(0)
    const lastLeaveRef = useRef(0)
    const lastMessageRef = useRef(0)

    const playJoinSound = useCallback(() => {
        const now = Date.now()
        if (now - lastJoinRef.current < 300) return
        lastJoinRef.current = now
        playJoin()
    }, [])

    const playLeaveSound = useCallback(() => {
        const now = Date.now()
        if (now - lastLeaveRef.current < 300) return
        lastLeaveRef.current = now
        playLeave()
    }, [])

    const playMessageSound = useCallback(() => {
        const now = Date.now()
        if (now - lastMessageRef.current < 800) return
        lastMessageRef.current = now
        playMessage()
    }, [])

    return { playJoinSound, playLeaveSound, playMessageSound }
}
