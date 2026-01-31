import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Channel } from '@/types'

interface AuthState {
    user: User | null
    isAuthenticated: boolean
    setUser: (user: User | null) => void
    logout: () => void
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            isAuthenticated: false,
            setUser: (user) => set({ user, isAuthenticated: !!user }),
            logout: () => set({ user: null, isAuthenticated: false }),
        }),
        {
            name: 'cshub-auth',
        }
    )
)

interface AppState {
    activeChannel: Channel | null
    setActiveChannel: (channel: Channel | null) => void
    sidebarOpen: boolean
    toggleSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
    activeChannel: null,
    setActiveChannel: (channel) => set({ activeChannel: channel }),
    sidebarOpen: true,
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))
