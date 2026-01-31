import { useState, useRef, useEffect, useCallback } from 'react'

interface AudioSettings {
    inputVolume: number
    outputVolume: number
    inputDeviceId: string
    outputDeviceId: string
    noiseSuppression: boolean
    echoCancellation: boolean
}

const defaultSettings: AudioSettings = {
    inputVolume: 100,
    outputVolume: 100,
    inputDeviceId: 'default',
    outputDeviceId: 'default',
    noiseSuppression: true,
    echoCancellation: true
}

export function useAudioSettings() {
    const [settings, setSettings] = useState<AudioSettings>(() => {
        const saved = localStorage.getItem('cshub-audio-settings')
        return saved ? JSON.parse(saved) : defaultSettings
    })

    const [devices, setDevices] = useState<{
        inputs: MediaDeviceInfo[]
        outputs: MediaDeviceInfo[]
    }>({ inputs: [], outputs: [] })

    const [isTesting, setIsTesting] = useState(false)
    const [micLevel, setMicLevel] = useState(0)

    const testStreamRef = useRef<MediaStream | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const animationRef = useRef<number | null>(null)

    // Save settings to localStorage
    useEffect(() => {
        localStorage.setItem('cshub-audio-settings', JSON.stringify(settings))
    }, [settings])

    // Get available devices
    useEffect(() => {
        const getDevices = async () => {
            try {
                // Request permission first
                await navigator.mediaDevices.getUserMedia({ audio: true })
                    .then(stream => stream.getTracks().forEach(t => t.stop()))

                const deviceList = await navigator.mediaDevices.enumerateDevices()

                setDevices({
                    inputs: deviceList.filter(d => d.kind === 'audioinput'),
                    outputs: deviceList.filter(d => d.kind === 'audiooutput')
                })
            } catch (err) {
                console.error('Failed to get devices:', err)
            }
        }

        getDevices()

        navigator.mediaDevices.addEventListener('devicechange', getDevices)
        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', getDevices)
        }
    }, [])

    const updateSetting = useCallback(<K extends keyof AudioSettings>(
        key: K,
        value: AudioSettings[K]
    ) => {
        setSettings(prev => ({ ...prev, [key]: value }))
    }, [])

    const startMicTest = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: settings.inputDeviceId !== 'default'
                        ? { exact: settings.inputDeviceId }
                        : undefined,
                    noiseSuppression: settings.noiseSuppression,
                    echoCancellation: settings.echoCancellation
                }
            })

            testStreamRef.current = stream

            // Create audio context for level monitoring
            audioContextRef.current = new AudioContext()
            const source = audioContextRef.current.createMediaStreamSource(stream)

            // Create gain node for volume control
            const gainNode = audioContextRef.current.createGain()
            gainNode.gain.value = settings.inputVolume / 100

            analyserRef.current = audioContextRef.current.createAnalyser()
            analyserRef.current.fftSize = 256

            source.connect(gainNode)
            gainNode.connect(analyserRef.current)

            // Connect to output for self-hearing (loopback)
            analyserRef.current.connect(audioContextRef.current.destination)

            setIsTesting(true)

            // Monitor mic level
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
            const checkLevel = () => {
                if (!analyserRef.current) return

                analyserRef.current.getByteFrequencyData(dataArray)
                const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
                const normalized = Math.min(100, (average / 128) * 100)
                setMicLevel(normalized)

                animationRef.current = requestAnimationFrame(checkLevel)
            }
            checkLevel()

        } catch (err) {
            console.error('Mic test failed:', err)
        }
    }, [settings])

    const stopMicTest = useCallback(() => {
        testStreamRef.current?.getTracks().forEach(t => t.stop())
        testStreamRef.current = null

        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current)
            animationRef.current = null
        }

        audioContextRef.current?.close()
        audioContextRef.current = null
        analyserRef.current = null

        setIsTesting(false)
        setMicLevel(0)
    }, [])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopMicTest()
        }
    }, [stopMicTest])

    return {
        settings,
        devices,
        isTesting,
        micLevel,
        updateSetting,
        startMicTest,
        stopMicTest,
        resetSettings: () => setSettings(defaultSettings)
    }
}
