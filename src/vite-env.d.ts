/// <reference types="vite/client" />

interface Window {
    electronAPI?: {
        getAppVersion: () => Promise<string>
        openExternal: (url: string) => Promise<boolean>
        resolveYouTubeSearch: (query: string) => Promise<{ url: string; title?: string } | null>
        minimizeWindow: () => Promise<void>
        maximizeWindow: () => Promise<void>
        closeWindow: () => Promise<void>
        isMaximized: () => Promise<boolean>
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
