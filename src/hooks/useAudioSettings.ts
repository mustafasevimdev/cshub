import { useState, useRef, useEffect, useCallback } from 'react'

export interface AudioSettings {
    inputVolume: number
    outputVolume: number
    inputDeviceId: string
    outputDeviceId: string
    noiseSuppression: boolean
    echoCancellation: boolean
}

type SinkableAudioElement = HTMLAudioElement & {
    setSinkId?: (deviceId: string) => Promise<void>
}

export const AUDIO_SETTINGS_STORAGE_KEY = 'cshub-audio-settings'
export const AUDIO_SETTINGS_CHANGE_EVENT = 'cshub-audio-settings-changed'

const defaultSettings: AudioSettings = {
    inputVolume: 100,
    outputVolume: 100,
    inputDeviceId: 'default',
    outputDeviceId: 'default',
    noiseSuppression: true,
    echoCancellation: true,
}

export function getSavedAudioSettings(): AudioSettings {
    if (typeof window === 'undefined') return defaultSettings

    const saved = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY)
    if (!saved) return defaultSettings

    try {
        return { ...defaultSettings, ...(JSON.parse(saved) as Partial<AudioSettings>) }
    } catch {
        return defaultSettings
    }
}

function persistAudioSettings(nextSettings: AudioSettings) {
    if (typeof window === 'undefined') return

    window.localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings))
    window.dispatchEvent(new CustomEvent<AudioSettings>(AUDIO_SETTINGS_CHANGE_EVENT, { detail: nextSettings }))
}

async function applySinkId(audio: SinkableAudioElement, outputDeviceId: string) {
    if (typeof audio.setSinkId !== 'function') return

    try {
        await audio.setSinkId(outputDeviceId === 'default' ? '' : outputDeviceId)
    } catch (error) {
        console.error('Failed to set output device:', error)
    }
}

export function useAudioSettings() {
    const [settings, setSettings] = useState<AudioSettings>(getSavedAudioSettings)
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
    const testInputGainRef = useRef<GainNode | null>(null)
    const testOutputGainRef = useRef<GainNode | null>(null)
    const testMonitorAudioRef = useRef<SinkableAudioElement | null>(null)
    const testConstraintKeyRef = useRef(
        `${settings.inputDeviceId}|${settings.noiseSuppression}|${settings.echoCancellation}`,
    )

    useEffect(() => {
        const getDevices = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                stream.getTracks().forEach((track) => track.stop())

                const deviceList = await navigator.mediaDevices.enumerateDevices()
                setDevices({
                    inputs: deviceList.filter((device) => device.kind === 'audioinput'),
                    outputs: deviceList.filter((device) => device.kind === 'audiooutput'),
                })
            } catch (error) {
                console.error('Failed to get devices:', error)
            }
        }

        void getDevices()
        navigator.mediaDevices.addEventListener('devicechange', getDevices)

        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', getDevices)
        }
    }, [])

    const updateSetting = useCallback(<K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
        setSettings((previousSettings) => {
            const nextSettings = { ...previousSettings, [key]: value }
            persistAudioSettings(nextSettings)
            return nextSettings
        })
    }, [])

    const resetSettings = useCallback(() => {
        setSettings(defaultSettings)
        persistAudioSettings(defaultSettings)
    }, [])

    const stopMicTest = useCallback(() => {
        testStreamRef.current?.getTracks().forEach((track) => track.stop())
        testStreamRef.current = null

        if (animationRef.current !== null) {
            cancelAnimationFrame(animationRef.current)
            animationRef.current = null
        }

        if (testMonitorAudioRef.current) {
            testMonitorAudioRef.current.pause()
            testMonitorAudioRef.current.srcObject = null
            testMonitorAudioRef.current = null
        }

        if (audioContextRef.current) {
            void audioContextRef.current.close()
            audioContextRef.current = null
        }

        testInputGainRef.current = null
        testOutputGainRef.current = null
        analyserRef.current = null
        setIsTesting(false)
        setMicLevel(0)
    }, [])

    const startMicTest = useCallback(async () => {
        stopMicTest()

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: settings.inputDeviceId !== 'default' ? { exact: settings.inputDeviceId } : undefined,
                    noiseSuppression: settings.noiseSuppression,
                    echoCancellation: settings.echoCancellation,
                    autoGainControl: true,
                },
            })

            testStreamRef.current = stream

            const audioContext = new AudioContext()
            audioContextRef.current = audioContext

            const source = audioContext.createMediaStreamSource(stream)
            const inputGain = audioContext.createGain()
            inputGain.gain.value = settings.inputVolume / 100
            testInputGainRef.current = inputGain

            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 256
            analyserRef.current = analyser

            const outputGain = audioContext.createGain()
            outputGain.gain.value = settings.outputVolume / 100
            testOutputGainRef.current = outputGain

            const monitorDestination = audioContext.createMediaStreamDestination()
            const monitorAudio = new Audio() as SinkableAudioElement
            monitorAudio.srcObject = monitorDestination.stream
            monitorAudio.autoplay = true
            monitorAudio.volume = 1
            await applySinkId(monitorAudio, settings.outputDeviceId)
            testMonitorAudioRef.current = monitorAudio

            source.connect(inputGain)
            inputGain.connect(analyser)
            inputGain.connect(outputGain)
            outputGain.connect(monitorDestination)

            await monitorAudio.play().catch((error) => {
                console.error('Mic monitor playback failed:', error)
            })

            setIsTesting(true)

            const dataArray = new Uint8Array(analyser.frequencyBinCount)
            const checkLevel = () => {
                if (!analyserRef.current) return

                analyserRef.current.getByteFrequencyData(dataArray)
                const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
                const normalized = Math.min(100, (average / 128) * 100)
                setMicLevel(normalized)

                animationRef.current = requestAnimationFrame(checkLevel)
            }

            checkLevel()
        } catch (error) {
            console.error('Mic test failed:', error)
            stopMicTest()
        }
    }, [settings, stopMicTest])

    useEffect(() => {
        if (testInputGainRef.current) {
            testInputGainRef.current.gain.value = settings.inputVolume / 100
        }
    }, [settings.inputVolume])

    useEffect(() => {
        if (testOutputGainRef.current) {
            testOutputGainRef.current.gain.value = settings.outputVolume / 100
        }
    }, [settings.outputVolume])

    useEffect(() => {
        if (testMonitorAudioRef.current) {
            void applySinkId(testMonitorAudioRef.current, settings.outputDeviceId)
        }
    }, [settings.outputDeviceId])

    useEffect(() => {
        const constraintKey = `${settings.inputDeviceId}|${settings.noiseSuppression}|${settings.echoCancellation}`
        const previousKey = testConstraintKeyRef.current
        testConstraintKeyRef.current = constraintKey

        if (isTesting && previousKey !== constraintKey) {
            void startMicTest()
        }
    }, [
        isTesting,
        settings.inputDeviceId,
        settings.noiseSuppression,
        settings.echoCancellation,
        startMicTest,
    ])

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
        resetSettings,
    }
}
