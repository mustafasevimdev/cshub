import type { Database as GeneratedDatabase } from './database.generated'

export type Database = GeneratedDatabase

type PublicTables = Database['public']['Tables']

export type TableName = keyof PublicTables
export type TableRow<T extends TableName> = PublicTables[T]['Row']
export type TableInsert<T extends TableName> = PublicTables[T]['Insert']
export type TableUpdate<T extends TableName> = PublicTables[T]['Update']

export type UserRow = TableRow<'users'>
export type User = Omit<UserRow, 'password_hash'>

export type Channel = TableRow<'channels'>
export type ChannelType = Channel['type']

export type MessageRow = TableRow<'messages'>
export type Message = MessageRow & { user?: User }

export type VoiceParticipantRow = TableRow<'voice_participants'>
export type VoiceParticipant = VoiceParticipantRow & { user?: User }

export type MusicQueueItem = TableRow<'music_queue'>
export type UserStatus = UserRow['status']

