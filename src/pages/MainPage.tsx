import { useState, useRef, useEffect } from 'react'
import { useChannels, useMessages, useAuth, useVoice, useMusic } from '@/hooks'
import { useAppStore, useAuthStore } from '@/stores'
import { SettingsModal } from '@/components'
import type { Channel } from '@/types'

// Icons as simple text for now
const Icons = {
    hash: '#',
    volume: '🔊',
    plus: '+',
    send: '➤',
    settings: '⚙',
    mic: '🎤',
    micOff: '🔇',
    headphones: '🎧',
    screen: '🖥',
    logout: '🚪',
    trash: '🗑',
}

export function MainPage() {
    const { user } = useAuthStore()
    const { logout, updateAvatar } = useAuth()
    const { textChannels, voiceChannels, createChannel, deleteChannel, loading: channelsLoading } = useChannels()
    const { activeChannel, setActiveChannel } = useAppStore()
    const {
        messages,
        loading: messagesLoading,
        sendMessage,
        clearMessages,
        clearChannelMessages,
        messagesEndRef
    } = useMessages(activeChannel?.id || null)

    // Music Hook
    const { isPlaying: musicIsPlaying, currentSong, addToQueue, nextSong, stopSong } = useMusic(activeChannel?.type === 'voice' ? activeChannel.id : null)

    // Voice Hooks
    const {
        joinVoice,
        leaveVoice,
        toggleMute,
        toggleDeafen,
        startScreenShare,
        stopScreenShare,
        isMuted,
        isDeafened,
        isScreenSharing,
        speakingUsers,
        isConnected,
        participants,
        remoteStreams,
        localStream
    } = useVoice(activeChannel?.type === 'voice' ? activeChannel.id : null)

    const [messageInput, setMessageInput] = useState('')
    const [showCreateChannel, setShowCreateChannel] = useState(false)
    const [showSettings, setShowSettings] = useState(false)
    const [newChannelName, setNewChannelName] = useState('')
    const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text')
    const fileInputRef = useRef<HTMLInputElement>(null)

    // YouTube ID Parser
    const getYoutubeId = (url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
        const match = url.match(regExp)
        return (match && match[2].length === 11) ? match[2] : null
    }

    const handleSendMessage = async () => {
        if (!messageInput.trim() || !activeChannel) return

        // Command Parser
        if (messageInput.startsWith('!')) {
            const [cmd, ...args] = messageInput.split(' ')
            if (args.length > 0 && (cmd === '!play' || cmd === '!video')) {
                // Strip quotes if present
                let url = args[0]
                if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
                    url = url.slice(1, -1)
                }

                const isVideo = cmd === '!video'
                await addToQueue(url, undefined, isVideo)

                // Also send the command as a message for visibility
                await sendMessage(messageInput)
                setMessageInput('')
                return
            }
            if (cmd === '!skip') {
                await nextSong()
                await sendMessage(messageInput)
                setMessageInput('')
                return
            }
            if (cmd === '!stop') {
                await stopSong()
                await sendMessage('⏹️ Müzik durduruldu ve liste temizlendi.')
                setMessageInput('')
                return
            }
            if (cmd === '!clear') {
                await clearChannelMessages()
                setMessageInput('')
                return
            }
        }

        await sendMessage(messageInput)
        setMessageInput('')
    }

    // Music Player Embed (Client-Side Sync)
    // This plays the audio for EVERYONE in the channel if they are connected
    const renderMusicPlayer = () => {
        if (!currentSong || !activeChannel) return null
        const videoId = getYoutubeId(currentSong.youtube_url)
        if (!videoId) return null

        // If it's a video command, show cinema mode
        // If it's just audio (!play), show the minimal player
        const isCinemaMode = (currentSong as any).is_video // Type assertion until types is regenerated

        if (isCinemaMode) {
            return (
                <div className="cinema-mode-overlay" style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.9)',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{ width: '80%', maxWidth: '1000px', position: 'relative' }}>
                        <div style={{ padding: '10px', color: 'white', display: 'flex', justifyContent: 'space-between' }}>
                            <h3>📺 {currentSong.title}</h3>
                            <button onClick={nextSong} style={{ background: 'red', color: 'white', border: 'none', padding: '5px 10px', cursor: 'pointer' }}>Kapat / Sonraki</button>
                        </div>
                        <div style={{ position: 'relative', paddingTop: '56.25%' /* 16:9 Aspect Ratio */ }}>
                            <iframe
                                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                                src={`https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&origin=${window.location.origin}`}
                                title="Video Player"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                            />
                        </div>
                    </div>
                </div>
            )
        }

        // Standard Audio-Only Player (Here we HIDE the video but keep audio)
        return (
            <div className="music-player-container" style={{ position: 'relative', width: '100%', padding: '10px', background: 'rgba(0,0,0,0.3)', marginTop: '10px', borderRadius: '8px' }}>
                <div style={{ marginBottom: '8px', fontSize: '12px', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold' }}>🎵 {currentSong.title}</span>
                </div>

                {/* Manual Play Button for Autoplay Block */}
                {!musicIsPlaying && (
                    <button
                        onClick={() => nextSong()}
                        style={{ width: '100%', padding: '8px', marginBottom: '8px', background: '#5865F2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                    >
                        Başlamadıysa Tıkla
                    </button>
                )}

                {/* HIDDEN Player for Audio Only - 1px size to keep it active but invisible */}
                <div style={{ width: '1px', height: '1px', overflow: 'hidden', opacity: 0.01 }}>
                    <iframe
                        width="100%"
                        height="100%"
                        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&origin=${window.location.origin}`}
                        title="Music Player"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    />
                </div>
            </div>
        )
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSendMessage()
        }
    }

    const handleCreateChannel = async () => {
        if (!newChannelName.trim()) return

        const result = await createChannel(newChannelName.trim(), newChannelType)
        if (result.success) {
            setNewChannelName('')
            setShowCreateChannel(false)
        }
    }

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            await updateAvatar(file)
        }
    }

    // Auto-join voice
    useEffect(() => {
        if (activeChannel?.type === 'voice' && !isConnected) {
            joinVoice()
        } else if (activeChannel?.type !== 'voice' && isConnected) {
            leaveVoice()
        }
    }, [activeChannel, isConnected])

    const isSpeaking = user && speakingUsers.has(user.id)
    // console.log('Current user is speaking:', isSpeaking) // Using isSpeaking to fix lint

    const formatTime = (dateString: string) => {
        const date = new Date(dateString)
        return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    }

    const getDefaultAvatar = (nickname: string) => {
        return `https://api.dicebear.com/7.x/initials/svg?seed=${nickname}&backgroundColor=5865F2`
    }

    return (
        <div className="app-layout">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-header">
                    <h1>CsHub</h1>
                    <button onClick={() => setShowCreateChannel(true)} title="Kanal Oluştur">
                        {Icons.plus}
                    </button>
                </div>

                <div className="sidebar-content">
                    {/* Text Channels */}
                    <div className="channel-section">
                        <div className="channel-section-header">
                            <span>Metin Kanalları</span>
                            <button onClick={() => { setNewChannelType('text'); setShowCreateChannel(true) }}>
                                {Icons.plus}
                            </button>
                        </div>
                        {textChannels.map(channel => (
                            <ChannelItem
                                key={channel.id}
                                channel={channel}
                                isActive={activeChannel?.id === channel.id}
                                onClick={() => setActiveChannel(channel)}
                                onDelete={() => deleteChannel(channel.id)}
                            />
                        ))}
                        {textChannels.length === 0 && !channelsLoading && (
                            <div className="channel-item" style={{ opacity: 0.5, cursor: 'default' }}>
                                <span className="icon">{Icons.hash}</span>
                                <span>Kanal yok</span>
                            </div>
                        )}
                    </div>

                    {/* Voice Channels */}
                    <div className="channel-section">
                        <div className="channel-section-header">
                            <span>Ses Kanalları</span>
                            <button onClick={() => { setNewChannelType('voice'); setShowCreateChannel(true) }}>
                                {Icons.plus}
                            </button>
                        </div>
                        {voiceChannels.map(channel => (
                            <ChannelItem
                                key={channel.id}
                                channel={channel}
                                isActive={activeChannel?.id === channel.id}
                                onClick={() => setActiveChannel(channel)}
                                onDelete={() => deleteChannel(channel.id)}
                                isVoice
                            />
                        ))}
                        {voiceChannels.length === 0 && !channelsLoading && (
                            <div className="channel-item voice" style={{ opacity: 0.5, cursor: 'default' }}>
                                <span className="icon">{Icons.volume}</span>
                                <span>Kanal yok</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* User Panel */}
                <div className="sidebar-footer">
                    <div className="user-panel">
                        <img
                            src={user?.avatar_url || getDefaultAvatar(user?.nickname || 'U')}
                            alt={user?.nickname}
                            className={`user-avatar ${isSpeaking ? 'speaking' : ''}`}
                            onClick={() => fileInputRef.current?.click()}
                            style={{ cursor: 'pointer' }}
                            title="Avatar değiştir"
                        />
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleAvatarChange}
                            style={{ display: 'none' }}
                        />
                        <div className="user-info">
                            <div className="user-name">{user?.nickname}</div>
                            <div className="user-status">Çevrimiçi</div>
                        </div>
                        <div className="user-controls">
                            <button title="Ayarlar" onClick={() => setShowSettings(true)}>{Icons.settings}</button>
                            <button onClick={logout} title="Çıkış">{Icons.logout}</button>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                {activeChannel ? (
                    <>
                        {/* Header */}
                        <div className="main-header">
                            <span className="channel-type">
                                {activeChannel.type === 'text' ? Icons.hash : Icons.volume}
                            </span>
                            <span className="channel-name">{activeChannel.name}</span>
                        </div>

                        <div className="chat-container">
                            {/* Voice Interface (Optional Overlay/Top Section) */}
                            {activeChannel.type === 'voice' && (
                                <div className="voice-container animate-fade-in" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', zIndex: 10 }}>
                                    <div className="voice-participants" style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                                        {participants.map(p => (
                                            <div
                                                key={p.id}
                                                className={`voice-participant ${speakingUsers.has(p.user_id) ? 'speaking' : ''} ${p.is_muted ? 'muted' : ''}`}
                                                style={{ minWidth: '80px' }}
                                            >
                                                <img
                                                    src={p.user?.avatar_url || getDefaultAvatar(p.user?.nickname || 'U')}
                                                    alt={p.user?.nickname}
                                                    className="avatar"
                                                />
                                                <span className="name" style={{ fontSize: '12px' }}>{p.user?.nickname || 'Bilinmeyen'}</span>
                                                <div className="status-icons">
                                                    {p.is_muted && <span>{Icons.micOff}</span>}
                                                    {p.is_deafened && <span>{Icons.headphones}</span>}
                                                </div>
                                            </div>
                                        ))}
                                        {(!isConnected || participants.length === 0) && (
                                            <div className="voice-participant" style={{ opacity: 0.5, border: '1px dashed var(--border)' }}>
                                                <span className="name">{isConnected ? 'Kimse yok...' : 'Bağlanılıyor...'}</span>
                                            </div>
                                        )}
                                    </div>

                                    {isConnected && (
                                        <div className="voice-controls" style={{ padding: '8px 16px', background: 'rgba(0,0,0,0.2)', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                            <button className={`voice-control-btn ${isMuted ? 'active' : ''}`} onClick={toggleMute} title="Sesi Aç/Kapat">{isMuted ? Icons.micOff : Icons.mic}</button>
                                            <button className={`voice-control-btn ${isDeafened ? 'active' : ''}`} onClick={toggleDeafen} title="Sağırlaştır">{Icons.headphones}</button>
                                            <button className={`voice-control-btn ${isScreenSharing ? 'active' : ''}`} onClick={isScreenSharing ? stopScreenShare : startScreenShare} title="Ekran Paylaş">{Icons.screen}</button>
                                            <button className="voice-control-btn disconnect" onClick={() => setActiveChannel(null)} title="Ayrıl">✕</button>
                                        </div>
                                    )}

                                    {/* Music Player Hidden Embed */}
                                    {renderMusicPlayer()}

                                    {/* Screen Share Grid in Voice Section */}
                                    {(participants.some(p => p.is_screen_sharing) || isScreenSharing) && (
                                        <div className="screen-share-grid" style={{ padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', background: '#000' }}>
                                            {isScreenSharing && localStream && (
                                                <div className="screen-share-view">
                                                    <video autoPlay muted playsInline ref={v => { if (v) v.srcObject = localStream }} style={{ width: '100%', borderRadius: '4px' }} />
                                                    <div style={{ fontSize: '10px', padding: '4px', textAlign: 'center' }}>Senin Yayının</div>
                                                </div>
                                            )}
                                            {participants.map(p => {
                                                const stream = remoteStreams.get(p.user_id);
                                                if (p.is_screen_sharing && stream) {
                                                    return (
                                                        <div key={p.id} className="screen-share-view">
                                                            <video autoPlay playsInline ref={v => { if (v) v.srcObject = stream }} style={{ width: '100%', borderRadius: '4px' }} />
                                                            <div style={{ fontSize: '10px', padding: '4px', textAlign: 'center' }}>{p.user?.nickname} yayını</div>
                                                        </div>
                                                    )
                                                }
                                                return null
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Messages Container */}
                            <div className="messages-container">
                                {messagesLoading ? (
                                    <div className="loading"><div className="spinner"></div></div>
                                ) : messages.length === 0 ? (
                                    <div className="empty-state">
                                        <div className="empty-state-icon">{activeChannel.type === 'text' ? Icons.hash : Icons.volume}</div>
                                        <h3 className="empty-state-title">#{activeChannel.name} kanalına hoş geldin!</h3>
                                        <p className="empty-state-text">Bu kanalın başlangıcı. Bir mesaj gönder!</p>
                                    </div>
                                ) : (
                                    messages.map(message => (
                                        <div key={message.id} className="message">
                                            <img src={message.user?.avatar_url || getDefaultAvatar(message.user?.nickname || 'U')} alt="" className="message-avatar" />
                                            <div className="message-content">
                                                <div className="message-header">
                                                    <span className="message-author">{message.user?.nickname}</span>
                                                    <span className="message-time">{formatTime(message.created_at)}</span>
                                                </div>
                                                <div className="message-text">{message.content}</div>
                                            </div>
                                        </div>
                                    ))
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Music Player Overlay in Chat */}
                            {currentSong && (
                                <div className="music-player-overlay" style={{ margin: '0 16px 8px 16px', background: 'rgba(var(--primary-rgb), 0.1)', border: '1px solid var(--primary)', borderRadius: '8px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ fontSize: '20px' }}>🎵</div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{currentSong.title}</div>
                                        <div style={{ fontSize: '11px', opacity: 0.6 }}>{musicIsPlaying ? 'Oynatılıyor' : 'Duraklatıldı'}</div>
                                    </div>
                                    <button className="btn-icon" onClick={nextSong}>⏭️</button>
                                </div>
                            )}

                            {/* Message Input */}
                            <div className="message-input-container" style={{ position: 'relative' }}>
                                {/* Command Autocomplete */}
                                {messageInput.startsWith('!') && !messageInput.includes(' ') && (
                                    <div className="command-suggestions" style={{
                                        position: 'absolute',
                                        bottom: '100%',
                                        left: '20px',
                                        width: '300px',
                                        background: '#2f3136',
                                        border: '1px solid #202225',
                                        borderRadius: '8px 8px 0 0',
                                        marginBottom: '8px',
                                        boxShadow: '0 -4px 12px rgba(0,0,0,0.2)',
                                        overflow: 'hidden',
                                        zIndex: 1000
                                    }}>
                                        <div style={{ padding: '8px 12px', fontSize: '12px', fontWeight: 'bold', color: '#b9bbbe', background: '#202225' }}>
                                            KOMUTLAR
                                        </div>
                                        {[
                                            { cmd: '!play', desc: 'Müzik çal (Radyo Modu)', example: '!play <link>' },
                                            { cmd: '!video', desc: 'Video izle (Sinema Modu)', example: '!video <link>' },
                                            { cmd: '!skip', desc: 'Sıradaki şarkıya geç', example: '!skip' },
                                            { cmd: '!stop', desc: 'Müziği durdur ve listeyi temizle', example: '!stop' },
                                            { cmd: '!clear', desc: 'Sohbeti temizle (Sadece sende)', example: '!clear' }
                                        ].filter(c => c.cmd.startsWith(messageInput)).map(c => (
                                            <div
                                                key={c.cmd}
                                                className="command-item"
                                                onClick={() => {
                                                    setMessageInput(c.cmd + ' ');
                                                    // document.querySelector('.message-input')?.focus(); // Focus is tricky with React render, but user is likely still focused
                                                }}
                                                style={{
                                                    padding: '8px 12px',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    borderBottom: '1px solid #292b2f',
                                                    color: '#dcddde'
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = '#40444b'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{c.cmd}</span>
                                                    <span style={{ fontSize: '12px', opacity: 0.7 }}>{c.example}</span>
                                                </div>
                                                <div style={{ fontSize: '11px', color: '#b9bbbe', marginTop: '2px' }}>{c.desc}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="message-input-wrapper">
                                    <input
                                        type="text"
                                        className="message-input"
                                        placeholder={`#${activeChannel.name} kanalına mesaj gönder`}
                                        value={messageInput}
                                        onChange={(e) => setMessageInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                    />
                                    <button className="send-button" onClick={handleSendMessage} disabled={!messageInput.trim()}>{Icons.send}</button>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    /* No Channel Selected */
                    <div className="empty-state">
                        <div className="empty-state-icon">💬</div>
                        <h3 className="empty-state-title">Hoş Geldin!</h3>
                        <p className="empty-state-text">
                            Sohbete başlamak için sol taraftan bir kanal seç veya yeni bir kanal oluştur.
                        </p>
                    </div>
                )}
            </main>

            {/* Modals */}
            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

            {/* Create Channel Modal */}
            {
                showCreateChannel && (
                    <div className="modal-overlay" onClick={() => setShowCreateChannel(false)}>
                        <div className="modal" onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2 className="modal-title">Kanal Oluştur</h2>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">Kanal Türü</label>
                                    <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                                        <button
                                            className={`btn ${newChannelType === 'text' ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setNewChannelType('text')}
                                            type="button"
                                        >
                                            {Icons.hash} Metin
                                        </button>
                                        <button
                                            className={`btn ${newChannelType === 'voice' ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setNewChannelType('voice')}
                                            type="button"
                                        >
                                            {Icons.volume} Ses
                                        </button>
                                    </div>
                                </div>
                                <div className="form-group" style={{ marginTop: '16px' }}>
                                    <label className="form-label" htmlFor="channelName">Kanal Adı</label>
                                    <input
                                        id="channelName"
                                        type="text"
                                        className="form-input"
                                        placeholder="yeni-kanal"
                                        value={newChannelName}
                                        onChange={(e) => setNewChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-secondary" onClick={() => setShowCreateChannel(false)}>
                                    İptal
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleCreateChannel}
                                    disabled={!newChannelName.trim()}
                                >
                                    Oluştur
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    )
}

// Channel Item Component
function ChannelItem({
    channel,
    isActive,
    onClick,
    onDelete,
    isVoice
}: {
    channel: Channel
    isActive: boolean
    onClick: () => void
    onDelete: () => void
    isVoice?: boolean
}) {
    const [showDelete, setShowDelete] = useState(false)

    return (
        <div
            className={`channel-item ${isActive ? 'active' : ''} ${isVoice ? 'voice' : ''}`}
            onClick={onClick}
            onMouseEnter={() => setShowDelete(true)}
            onMouseLeave={() => setShowDelete(false)}
        >
            <span className="icon">{isVoice ? Icons.volume : Icons.hash}</span>
            <span style={{ flex: 1 }}>{channel.name}</span>
            {showDelete && (
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`"${channel.name}" kanalını silmek istediğine emin misin?`)) {
                            onDelete()
                        }
                    }}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--danger)',
                        cursor: 'pointer',
                        padding: '2px'
                    }}
                >
                    {Icons.trash}
                </button>
            )}
        </div>
    )
}
