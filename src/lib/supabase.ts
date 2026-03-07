import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase env eksik: VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY tanımlanmalı.')
}

export const supabase = createClient<Database, 'public'>(supabaseUrl, supabaseAnonKey)

// Helper to get public URL for avatars
export const getAvatarUrl = (path: string) => {
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    return data.publicUrl
}
