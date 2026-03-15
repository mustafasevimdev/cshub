/// <reference types="vite/client" />

interface Window {
    electronAPI?: {
        getAppVersion: () => Promise<string>
        openExternal: (url: string) => Promise<boolean>
        resolveYouTubeSearch: (query: string) => Promise<{ url: string; title?: string } | null>
        resolveAudioSource: (url: string) => Promise<{ streamUrl: string; proxyUrl?: string; videoId: string; duration: number; title?: string } | null>
        playMusic: (payload: { songId: string; url: string; startAt?: number; muted?: boolean }) => Promise<boolean>
        pauseMusic: (seconds?: number) => Promise<boolean>
        resumeMusic: (seconds?: number) => Promise<boolean>
        seekMusic: (seconds: number) => Promise<boolean>
        stopMusic: () => Promise<boolean>
        setMusicMuted: (muted: boolean) => Promise<boolean>
        getMusicState: () => Promise<{
            songId: string | null
            currentTime: number
            duration: number
            playerState: number
            isMuted: boolean
            isReady: boolean
            videoId: string | null
        }>
        minimizeWindow: () => Promise<void>
        maximizeWindow: () => Promise<void>
        closeWindow: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMusicStateChange: (callback: (payload: {
            songId: string | null
            currentTime: number
            duration: number
            playerState: number
            isMuted: boolean
            isReady: boolean
            videoId: string | null
        }) => void) => () => void
        onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void
    }
}


type YTPlayerStateValue = -1 | 0 | 1 | 2 | 3 | 5

interface Window {
    YT?: {
        Player: new (
            element: HTMLElement,
            options: {
                width?: string
                height?: string
                host?: string
                videoId?: string
                playerVars?: Record<string, string | number | undefined>
                events?: {
                    onReady?: (event: { target: YT.Player }) => void
                    onError?: (event: { data: number; target: YT.Player }) => void
                    onStateChange?: (event: { data: YTPlayerStateValue; target: YT.Player }) => void
                }
            },
        ) => YT.Player
        PlayerState: {
            ENDED: 0
            PLAYING: 1
            PAUSED: 2
            BUFFERING: 3
        }
    }
    onYouTubeIframeAPIReady?: () => void
}

declare namespace YT {
    interface Player {
        destroy: () => void
        getIframe: () => HTMLIFrameElement
        getCurrentTime: () => number
        getDuration: () => number
        mute: () => void
        pauseVideo: () => void
        playVideo: () => void
        seekTo: (seconds: number, allowSeekAhead: boolean) => void
        stopVideo: () => void
        unMute: () => void
    }
}
