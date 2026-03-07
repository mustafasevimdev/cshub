// This file is auto-generated from Supabase schema.
// Regenerate with: npm run db:types

export interface Database {
    public: {
        Tables: {
            users: {
                Row: {
                    id: string
                    nickname: string
                    avatar_url: string | null
                    status: 'online' | 'offline' | 'busy' | 'idle'
                    password_hash: string
                    created_at: string
                    last_seen: string
                }
                Insert: {
                    id?: string
                    nickname: string
                    avatar_url?: string | null
                    status?: 'online' | 'offline' | 'busy' | 'idle'
                    password_hash: string
                    created_at?: string
                    last_seen?: string
                }
                Update: {
                    id?: string
                    nickname?: string
                    avatar_url?: string | null
                    status?: 'online' | 'offline' | 'busy' | 'idle'
                    password_hash?: string
                    created_at?: string
                    last_seen?: string
                }
                Relationships: []
            }
            channels: {
                Row: {
                    id: string
                    name: string
                    type: 'text' | 'voice'
                    created_by: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    type: 'text' | 'voice'
                    created_by?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    type?: 'text' | 'voice'
                    created_by?: string | null
                    created_at?: string
                }
                Relationships: []
            }
            messages: {
                Row: {
                    id: string
                    channel_id: string
                    user_id: string
                    content: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    channel_id: string
                    user_id: string
                    content: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    channel_id?: string
                    user_id?: string
                    content?: string
                    created_at?: string
                }
                Relationships: []
            }
            voice_participants: {
                Row: {
                    id: string
                    channel_id: string
                    user_id: string
                    is_muted: boolean
                    is_deafened: boolean
                    is_screen_sharing: boolean
                    joined_at: string
                }
                Insert: {
                    id?: string
                    channel_id: string
                    user_id: string
                    is_muted?: boolean
                    is_deafened?: boolean
                    is_screen_sharing?: boolean
                    joined_at?: string
                }
                Update: {
                    id?: string
                    channel_id?: string
                    user_id?: string
                    is_muted?: boolean
                    is_deafened?: boolean
                    is_screen_sharing?: boolean
                    joined_at?: string
                }
                Relationships: []
            }
            music_queue: {
                Row: {
                    id: string
                    channel_id: string
                    user_id: string
                    youtube_url: string
                    title: string | null
                    thumbnail: string | null
                    duration: string | null
                    is_playing: boolean
                    is_video: boolean
                    position: number
                    created_at: string
                }
                Insert: {
                    id?: string
                    channel_id: string
                    user_id: string
                    youtube_url: string
                    title?: string | null
                    thumbnail?: string | null
                    duration?: string | null
                    is_playing?: boolean
                    is_video?: boolean
                    position: number
                    created_at?: string
                }
                Update: {
                    id?: string
                    channel_id?: string
                    user_id?: string
                    youtube_url?: string
                    title?: string | null
                    thumbnail?: string | null
                    duration?: string | null
                    is_playing?: boolean
                    is_video?: boolean
                    position?: number
                    created_at?: string
                }
                Relationships: []
            }
        }
        Views: Record<string, never>
        Functions: Record<string, never>
        Enums: Record<string, never>
        CompositeTypes: Record<string, never>
    }
}
