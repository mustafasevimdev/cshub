import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = 'https://swahydtbyqbvpovmcqfb.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3YWh5ZHRieXFidnBvdm1jcWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NTIzMzUsImV4cCI6MjA4NTQyODMzNX0.vdoAnBj-I9jGZVcLoyiTROIaxiArCVH_BLVgK3u9Dbs'

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

// Helper to get public URL for avatars
export const getAvatarUrl = (path: string) => {
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    return data.publicUrl
}
