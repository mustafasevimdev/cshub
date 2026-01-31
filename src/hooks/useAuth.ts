import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores'
import type { User } from '@/types'

// Simple hash function for password (client-side demo - in production use proper auth)
async function hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

export function useAuth() {
    const { user, isAuthenticated, setUser, logout } = useAuthStore()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Update user status on mount/unmount
    useEffect(() => {
        if (user) {
            updateStatus('online')

            const handleBeforeUnload = () => {
                updateStatus('offline')
            }

            window.addEventListener('beforeunload', handleBeforeUnload)
            return () => {
                window.removeEventListener('beforeunload', handleBeforeUnload)
                updateStatus('offline')
            }
        }
    }, [user?.id])

    const updateStatus = async (status: 'online' | 'offline' | 'busy' | 'idle') => {
        if (!user) return

        await (supabase.from('users') as any)
            .update({ status, last_seen: new Date().toISOString() })
            .eq('id', user.id)
    }

    const register = useCallback(async (nickname: string, password: string) => {
        setLoading(true)
        setError(null)

        try {
            // Check if nickname exists
            const { data: existing } = await (supabase
                .from('users') as any)
                .select('id')
                .eq('nickname', nickname)
                .single()

            if (existing) {
                throw new Error('Bu nickname zaten kullanılıyor')
            }

            const passwordHash = await hashPassword(password)

            const { data, error: insertError } = await (supabase
                .from('users') as any)
                .insert({
                    nickname,
                    password_hash: passwordHash,
                    status: 'online'
                })
                .select()
                .single()

            if (insertError) throw insertError

            setUser(data as User)
            return { success: true }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Kayıt başarısız'
            setError(message)
            return { success: false, error: message }
        } finally {
            setLoading(false)
        }
    }, [setUser])

    const login = useCallback(async (nickname: string, password: string) => {
        setLoading(true)
        setError(null)

        try {
            const passwordHash = await hashPassword(password)

            const { data, error: selectError } = await (supabase
                .from('users') as any)
                .select('*')
                .eq('nickname', nickname)
                .eq('password_hash', passwordHash)
                .single()

            if (selectError || !data) {
                throw new Error('Nickname veya şifre hatalı')
            }

            // Update status to online
            await (supabase
                .from('users') as any)
                .update({ status: 'online', last_seen: new Date().toISOString() })
                .eq('id', (data as any).id)

            setUser(data as User)
            return { success: true }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Giriş başarısız'
            setError(message)
            return { success: false, error: message }
        } finally {
            setLoading(false)
        }
    }, [setUser])

    const handleLogout = useCallback(async () => {
        if (user) {
            await updateStatus('offline')
        }
        logout()
    }, [user, logout])

    const updateAvatar = useCallback(async (file: File) => {
        if (!user) return { success: false }

        try {
            const fileExt = file.name.split('.').pop()
            const fileName = `${user.id}.${fileExt}`

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(fileName, file, { upsert: true })

            if (uploadError) throw uploadError

            const { data: urlData } = supabase.storage
                .from('avatars')
                .getPublicUrl(fileName)

            const { error: updateError } = await (supabase
                .from('users') as any)
                .update({ avatar_url: urlData.publicUrl })
                .eq('id', user.id)

            if (updateError) throw updateError

            setUser({ ...user, avatar_url: urlData.publicUrl })
            return { success: true }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Avatar yüklenemedi'
            setError(message)
            return { success: false, error: message }
        }
    }, [user, setUser])

    return {
        user,
        isAuthenticated,
        loading,
        error,
        register,
        login,
        logout: handleLogout,
        updateStatus,
        updateAvatar,
        clearError: () => setError(null)
    }
}
