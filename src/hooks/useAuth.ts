import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores'
import type { User, UserRow, UserStatus } from '@/types'

// Simple hash function for password (client-side demo - in production use proper auth)
async function hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
}

function toPublicUser(userRow: UserRow): User {
    const { password_hash, ...publicUser } = userRow
    void password_hash
    return publicUser
}

export function useAuth() {
    const { user, isAuthenticated, setUser, logout } = useAuthStore()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const userId = user?.id

    useEffect(() => {
        const validateSessionUser = async () => {
            if (!userId) return

            const { data, error } = await supabase.from('users')
                .select('id')
                .eq('id', userId)
                .maybeSingle()

            if (error) {
                console.error('Oturum kullanicisi dogrulanamadi:', error)
                return
            }

            if (!data) {
                logout()
                setError('Oturum gecersiz. Bu veritabaninda tekrar giris yapin.')
            }
        }

        void validateSessionUser()
    }, [userId, logout])

    const updateStatus = useCallback(
        async (status: UserStatus) => {
            if (!userId) return

            await supabase.from('users')
                .update({ status, last_seen: new Date().toISOString() } as never)
                .eq('id', userId)
        },
        [userId],
    )

    // Update user status on mount/unmount
    useEffect(() => {
        if (!user) return

        void updateStatus('online')

        const handleBeforeUnload = () => {
            void updateStatus('offline')
        }

        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)
            void updateStatus('offline')
        }
    }, [user, updateStatus])

    const register = useCallback(
        async (nickname: string, password: string) => {
            setLoading(true)
            setError(null)

            try {
                const { data: existing, error: existingError } = await supabase.from('users')
                    .select('id')
                    .eq('nickname', nickname)
                    .maybeSingle()

                if (existingError) throw existingError
                if (existing) {
                    throw new Error('Bu nickname zaten kullanılıyor')
                }

                const passwordHash = await hashPassword(password)

                const { data, error: insertError } = await supabase.from('users')
                    .insert(({
                        nickname,
                        password_hash: passwordHash,
                        status: 'online',
                    }) as never)
                    .select('*')
                    .single()

                if (insertError || !data) throw insertError ?? new Error('Kayıt başarısız')

                setUser(toPublicUser(data as UserRow))
                return { success: true }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Kayıt başarısız'
                setError(message)
                return { success: false, error: message }
            } finally {
                setLoading(false)
            }
        },
        [setUser],
    )

    const login = useCallback(
        async (nickname: string, password: string) => {
            setLoading(true)
            setError(null)

            try {
                const passwordHash = await hashPassword(password)

                const { data, error: selectError } = await supabase.from('users')
                    .select('*')
                    .eq('nickname', nickname)
                    .eq('password_hash', passwordHash)
                    .single()

                if (selectError || !data) {
                    throw new Error('Nickname veya şifre hatalı')
                }

                await supabase.from('users')
                    .update({ status: 'online', last_seen: new Date().toISOString() } as never)
                    .eq('id', (data as UserRow).id)

                setUser(toPublicUser(data as UserRow))
                return { success: true }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Giriş başarısız'
                setError(message)
                return { success: false, error: message }
            } finally {
                setLoading(false)
            }
        },
        [setUser],
    )

    const handleLogout = useCallback(async () => {
        if (userId) {
            await updateStatus('offline')
        }
        logout()
    }, [userId, logout, updateStatus])

    const updateAvatar = useCallback(
        async (file: File) => {
            if (!userId || !user) return { success: false }

            try {
                const fileExt = file.name.split('.').pop() ?? 'png'
                const fileName = `${userId}.${fileExt}`

                const { error: uploadError } = await supabase.storage
                    .from('avatars')
                    .upload(fileName, file, { upsert: true })

                if (uploadError) throw uploadError

                const { data: urlData } = supabase.storage
                    .from('avatars')
                    .getPublicUrl(fileName)

                const { error: updateError } = await supabase.from('users')
                    .update({ avatar_url: urlData.publicUrl } as never)
                    .eq('id', userId)

                if (updateError) throw updateError

                setUser({ ...user, avatar_url: urlData.publicUrl })
                return { success: true }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Avatar yüklenemedi'
                setError(message)
                return { success: false, error: message }
            }
        },
        [userId, user, setUser],
    )

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
        clearError: () => setError(null),
    }
}

