export interface User {
    id: string
    nickname: string
    avatar_url: string | null
    status: 'online' | 'offline' | 'busy' | 'idle'
    created_at: string
    last_seen: string
}

export interface Channel {
    id: string
    name: string
    type: 'text' | 'voice'
    created_by: string | null
    created_at: string
}

export interface Message {
    id: string
    channel_id: string
    user_id: string
    content: string
    created_at: string
    user?: User
}

export interface VoiceParticipant {
    id: string
    channel_id: string
    user_id: string
    is_muted: boolean
    is_deafened: boolean
    is_screen_sharing: boolean
    joined_at: string
    user?: User
}

export interface MusicQueueItem {
    id: string
    channel_id: string
    user_id: string
    youtube_url: string
    title: string | null
    thumbnail: string | null
    duration: string | null
    is_playing: boolean
    position: number
    created_at: string
}

export interface Database {
    public: {
        Tables: {
            users: {
                Row: User
                Insert: Omit<User, 'id' | 'created_at' | 'last_seen'> & { password_hash: string }
                Update: Partial<User>
            }
            channels: {
                Row: Channel
                Insert: Omit<Channel, 'id' | 'created_at'>
                Update: Partial<Channel>
            }
            messages: {
                Row: Message
                Insert: Omit<Message, 'id' | 'created_at'>
                Update: Partial<Message>
            }
            voice_participants: {
                Row: VoiceParticipant
                Insert: Omit<VoiceParticipant, 'id' | 'joined_at'>
                Update: Partial<VoiceParticipant>
            }
            music_queue: {
                Row: MusicQueueItem
                Insert: Omit<MusicQueueItem, 'id' | 'created_at'>
                Update: Partial<MusicQueueItem>
            }
        }
    }
}
