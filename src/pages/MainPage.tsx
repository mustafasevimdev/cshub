import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChannels, useMessages, useAuth, useVoice, useMusic } from '@/hooks'
import { useAppStore, useAuthStore } from '@/stores'
import { SettingsModal, TitleBar } from '@/components'
import { supabase } from '@/lib/supabase'
import { resolveYouTubeSource } from '@/lib/youtube'
import type { Channel } from '@/types'

const UI = {
  brandSubline: 'social cockpit',
  textChannels: 'Metin Kanallar?',
  voiceChannels: 'Ses Kanallar\u0131',
  noChannel: 'Kanal yok',
  quickAccess: 'H\u0131zl\u0131 Bak\u0131\u015f',
  quickTip: 'Sol \u00fcstteki + ile an\u0131nda kanal a\u00e7abilirsin.',
  connected: 'Ses ba\u011fl\u0131',
  connectingInline: 'Ba\u011flan\u0131yor',
  voiceFallback: 'Ses kanal\u0131',
  changeAvatar: 'Avatar de\u011fi\u015ftir',
  online: '\u00c7evrimi\u00e7i',
  settings: 'Ayarlar',
  logout: '\u00c7\u0131k\u0131\u015f',
  createChannel: 'Kanal Olu\u015ftur',
  channelType: 'Kanal T\u00fcr\u00fc',
  channelName: 'Kanal Ad\u0131',
  cancel: '\u0130ptal',
  create: 'Olu\u015ftur',
  unknownUser: 'Bilinmeyen',
  welcome: "CsHub'a Ho\u015f Geldin!",
  welcomeBody: 'Sohbete ba\u015flamak i\u00e7in soldan bir kanal se\u00e7 veya yeni bir kanal olu\u015ftur.',
  channelStart: 'Bu kanal\u0131n ba\u015flang\u0131c\u0131. Bir mesaj g\u00f6nder!',
  noPeople: 'Kimse yok...',
  connecting: 'Ba\u011flan\u0131l\u0131yor...',
  yourStream: 'Senin yay\u0131n\u0131n',
  playing: 'Oynat\u0131l\u0131yor',
  paused: 'Duraklat\u0131ld\u0131',
  resume: 'Devam',
  addUrl: 'L\u00fctfen bir link veya \u015fark\u0131 ad\u0131 girin. \u00d6rn: !play tarkan simarik',
  stopped: 'M\u00fczik durduruldu ve liste temizlendi.',
  musicNow: '\u015eu an \u00e7al\u0131yor',
  musicStart: 'Oynatma baslamadiysa tikla',
  songBar: 'Aktif parca',
  searching: 'araniyor...',
  sendPlaceholder: (name: string) => `#${name} kanal\u0131na mesaj g\u00f6nder`,
  deleteConfirm: (name: string) => `"${name}" kanal\u0131n\u0131 silmek istedi\u011fine emin misin?`,
}

const COMMANDS = [
  { cmd: '!play', desc: 'M\u00fczik \u00e7al (link veya isim)', example: '!play tarkan simarik' },
  { cmd: '!video', desc: 'Video oynat', example: '!video <link>' },
  { cmd: '!skip', desc: 'S\u0131radaki \u015fark\u0131ya ge\u00e7', example: '!skip' },
  { cmd: '!stop', desc: 'M\u00fczi\u011fi durdur', example: '!stop' },
  { cmd: '!clear', desc: 'Sohbeti temizle', example: '!clear' },
]

const Icons = {
  hash: '#',
  voice: '\uD83D\uDD0A',
  add: '+',
  send: '\u27A4',
  settings: '\u2699\uFE0F',
  logout: '\uD83D\uDEAA',
  mic: '\uD83C\uDFA4',
  micOff: '\uD83D\uDD07',
  deafen: '\uD83C\uDFA7',
  share: '\uD83D\uDDA5\uFE0F',
  leave: '\u2715',
  delete: '\uD83D\uDDD1\uFE0F',
  music: '\uD83C\uDFB5',
}

type MusicSyncAction = 'pause' | 'resume' | 'restart'

interface MusicSyncPayload {
  action: MusicSyncAction
  songId: string
  issuedBy?: string
  positionSeconds?: number
  sentAtMs?: number
}

export function MainPage() {
  const user = useAuthStore((state) => state.user)
  const { logout, updateAvatar } = useAuth()
  const { textChannels, voiceChannels, createChannel, deleteChannel, loading: channelsLoading } = useChannels()
  const activeChannel = useAppStore((state) => state.activeChannel)
  const setActiveChannel = useAppStore((state) => state.setActiveChannel)
  const voiceChannelId = useAppStore((state) => state.voiceChannelId)
  const setVoiceChannelId = useAppStore((state) => state.setVoiceChannelId)
  const { messages, loading: messagesLoading, sendMessage, clearChannelMessages, messagesEndRef } = useMessages(activeChannel?.id || null)
  const { isPlaying, currentSong, addToQueue, nextSong, stopSong } = useMusic(voiceChannelId)
  const { toggleMute, toggleDeafen, startScreenShare, stopScreenShare, isMuted, isDeafened, isScreenSharing, speakingUsers, isConnected, participants, remoteStreams, screenShareStream } = useVoice(voiceChannelId)

  const [messageInput, setMessageInput] = useState('')
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSearchingMusic, setIsSearchingMusic] = useState(false)
  const [playerNonce, setPlayerNonce] = useState(0)
  const [songProgress, setSongProgress] = useState(0)
  const [songTimeLabel, setSongTimeLabel] = useState('0:00 / 0:00')
  const [isPlaybackPaused, setIsPlaybackPaused] = useState(false)
  const [watchingScreen, setWatchingScreen] = useState<{ userId: string; nickname: string } | null>(null)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const playerReadyRef = useRef(false)
  const playerRecoveryTimeoutRef = useRef<number | null>(null)
  const playerStartTimeoutRef = useRef<number | null>(null)
  const progressTimerRef = useRef<number | null>(null)
  const playerSessionRef = useRef(0)
  const hasPlaybackStartedRef = useRef(false)
  const isSkippingRef = useRef(false)
  const isMusicControlBusyRef = useRef(false)
  const musicSyncChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const startSyncSentForSongRef = useRef<string | null>(null)
  const pendingMusicSyncRef = useRef<MusicSyncPayload | null>(null)
  const disablePlayerOriginRef = useRef(false)
  const persistedResolvedSourceForSongRef = useRef<string | null>(null)
  const isSongOwner = Boolean(currentSong && user?.id === currentSong.user_id)
  const currentSongId = currentSong?.id ?? null

  const isSearchSource = (value: string) => value.startsWith('ytsearch:')
  const toSearchQuery = (value: string) => decodeURIComponent(value.slice('ytsearch:'.length))

  const getYoutubeId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
    const match = url.match(regExp)
    return match && match[2].length === 11 ? match[2] : null
  }

  const hasVideoTrack = useCallback((stream: MediaStream | undefined | null) => {
    return Boolean(stream && stream.getVideoTracks().length > 0)
  }, [])

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !activeChannel || isProcessing) return

    setIsProcessing(true)
    try {
      const input = messageInput.trim()
      if (input.startsWith('!')) {
        const [cmd, ...args] = input.split(' ')
        if (cmd === '!play' || cmd === '!video') {
          if (args.length === 0) {
            await sendMessage(UI.addUrl)
            setMessageInput('')
            return
          }

          let sourceInput = args.join(' ').trim()
          if ((sourceInput.startsWith('"') && sourceInput.endsWith('"')) || (sourceInput.startsWith("'") && sourceInput.endsWith("'"))) {
            sourceInput = sourceInput.slice(1, -1)
          }
          if (!sourceInput) {
            await sendMessage(UI.addUrl)
            setMessageInput('')
            return
          }

          setIsSearchingMusic(true)
          const result = await addToQueue(sourceInput, undefined, cmd === '!video')
          setIsSearchingMusic(false)
          if (!result.success) {
            await sendMessage(result.error || 'Sarki kuyruga eklenemedi.')
            setMessageInput('')
            return
          }
          await sendMessage(input)
          setMessageInput('')
          return
        }

        if (cmd === '!skip') {
          await nextSong()
          await sendMessage(input)
          setMessageInput('')
          return
        }

        if (cmd === '!stop') {
          await stopSong()
          await sendMessage(UI.stopped)
          setMessageInput('')
          return
        }

        if (cmd === '!clear') {
          await clearChannelMessages()
          setMessageInput('')
          return
        }
      }

      await sendMessage(input)
      setMessageInput('')
    } finally {
      setIsProcessing(false)
      setIsSearchingMusic(false)
    }
  }

  const handleDisconnectVoice = async () => {
    if (currentSong && user && currentSong.user_id === user.id) {
      void stopSong()
    }
    setVoiceChannelId(null)
    if (activeChannel?.type === 'voice') {
      setActiveChannel(null)
    }
  }

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) return

    const result = await createChannel(newChannelName.trim(), newChannelType)
    if (result.success) {
      setNewChannelName('')
      setShowCreateChannel(false)
      return
    }

    alert(`Kanal olu\u015fturulamad\u0131:\n${result.error || 'Bilinmeyen hata'}`)
  }

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) await updateAvatar(file)
  }

  const formatTime = (dateString: string) => new Date(dateString).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const getDefaultAvatar = (nickname: string) => `https://api.dicebear.com/7.x/initials/svg?seed=${nickname}&backgroundColor=5865F2`
  const filteredCommands = useMemo(
    () => (messageInput.startsWith('!') && !messageInput.includes(' ')
      ? COMMANDS.filter((command) => command.cmd.startsWith(messageInput))
      : []),
    [messageInput],
  )

  useEffect(() => {
    if (filteredCommands.length === 0) {
      setSelectedCommandIndex(0)
      return
    }

    setSelectedCommandIndex((current) => Math.min(current, filteredCommands.length - 1))
  }, [filteredCommands])

  const applyCommandSelection = (command: { cmd: string }) => {
    setMessageInput(`${command.cmd} `)
    setSelectedCommandIndex(0)
  }

  useEffect(() => {
    startSyncSentForSongRef.current = null
    disablePlayerOriginRef.current = false
    persistedResolvedSourceForSongRef.current = null
    if (!currentSongId && pendingMusicSyncRef.current) {
      pendingMusicSyncRef.current = null
      return
    }
    if (currentSongId && pendingMusicSyncRef.current && pendingMusicSyncRef.current.songId !== currentSongId) {
      pendingMusicSyncRef.current = null
    }
  }, [currentSongId])

  const formatDuration = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
    const totalSeconds = Math.floor(seconds)
    const minutes = Math.floor(totalSeconds / 60)
    const remainingSeconds = totalSeconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }, [])

  const updateProgressFromPlayer = useCallback(() => {
    const player = playerRef.current
    if (!player) return

    const duration = player.getDuration()
    const currentTime = player.getCurrentTime()

    if (!Number.isFinite(duration) || duration <= 0) {
      setSongProgress(0)
      setSongTimeLabel('0:00 / 0:00')
      return
    }

    setSongProgress(Math.min(100, (currentTime / duration) * 100))
    setSongTimeLabel(`${formatDuration(currentTime)} / ${formatDuration(duration)}`)
  }, [formatDuration])

  const stopProgressTimer = useCallback(() => {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
  }, [])

  const clearPlayerRecoveryTimeout = useCallback(() => {
    if (playerRecoveryTimeoutRef.current !== null) {
      window.clearTimeout(playerRecoveryTimeoutRef.current)
      playerRecoveryTimeoutRef.current = null
    }
  }, [])

  const clearPlayerStartTimeout = useCallback(() => {
    if (playerStartTimeoutRef.current !== null) {
      window.clearTimeout(playerStartTimeoutRef.current)
      playerStartTimeoutRef.current = null
    }
  }, [])

  const startProgressTimer = useCallback(() => {
    stopProgressTimer()
    updateProgressFromPlayer()
    progressTimerRef.current = window.setInterval(updateProgressFromPlayer, 250)
  }, [stopProgressTimer, updateProgressFromPlayer])

  const ensureYouTubeApi = async () => {
    if (window.YT?.Player) return window.YT

    const existingScript = document.querySelector('script[data-youtube-api="true"]') as HTMLScriptElement | null
    if (!existingScript) {
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      script.dataset.youtubeApi = 'true'
      document.body.appendChild(script)
    }

    await new Promise<void>((resolve) => {
      const previousReady = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.()
        resolve()
      }

      const checkReady = window.setInterval(() => {
        if (window.YT?.Player) {
          window.clearInterval(checkReady)
          resolve()
        }
      }, 100)
    })

    return window.YT
  }

  const destroyPlayerSafely = useCallback(() => {
    clearPlayerRecoveryTimeout()
    clearPlayerStartTimeout()
    playerReadyRef.current = false
    hasPlaybackStartedRef.current = false
    if (!playerRef.current) return

    try {
      playerRef.current.destroy()
    } catch (error) {
      console.error('Failed to destroy YouTube player safely:', error)
    } finally {
      playerRef.current = null
    }
  }, [clearPlayerRecoveryTimeout, clearPlayerStartTimeout])

  const runPlayerCommand = useCallback((command: (player: YT.Player) => void) => {
    const player = playerRef.current
    if (!player || !playerReadyRef.current) return false

    try {
      command(player)
      return true
    } catch (error) {
      console.error('Music control command failed:', error)
      return false
    }
  }, [])

  const getPlayerCurrentTime = useCallback(() => {
    const player = playerRef.current
    if (!player || !playerReadyRef.current) return 0

    try {
      const currentTime = player.getCurrentTime()
      return Number.isFinite(currentTime) ? currentTime : 0
    } catch {
      return 0
    }
  }, [])

  useEffect(() => {
    const didRun = runPlayerCommand((player) => {
      if (isDeafened) player.mute()
      else player.unMute()
    })

    if (didRun) {
      updateProgressFromPlayer()
    }
  }, [isDeafened, runPlayerCommand, updateProgressFromPlayer])

  const broadcastMusicSync = useCallback(async (payload: MusicSyncPayload) => {
    if (!voiceChannelId || !musicSyncChannelRef.current) return

    try {
      await musicSyncChannelRef.current.send({
        type: 'broadcast',
        event: 'music-control',
        payload,
      })
    } catch (error) {
      console.error('Failed to broadcast music sync action:', error)
    }
  }, [voiceChannelId])

  const applyRestartPlayback = useCallback((startAtSeconds = 0) => {
    const didRun = runPlayerCommand((player) => {
      player.seekTo(startAtSeconds, true)
      player.playVideo()
    })

    if (!didRun) {
      if (currentSong) {
        setPlayerNonce((prev) => prev + 1)
      }
      return false
    }

    setIsPlaybackPaused(false)
    setSongProgress(0)
    startProgressTimer()
    updateProgressFromPlayer()
    return true
  }, [currentSong, runPlayerCommand, startProgressTimer, updateProgressFromPlayer])

  const applyResumePlayback = useCallback((startAtSeconds?: number) => {
    const didRun = runPlayerCommand((player) => {
      if (typeof startAtSeconds === 'number' && Number.isFinite(startAtSeconds) && startAtSeconds >= 0) {
        player.seekTo(startAtSeconds, true)
      }
      player.playVideo()
    })
    if (!didRun) {
      if (currentSong) {
        setPlayerNonce((prev) => prev + 1)
      }
      return false
    }

    setIsPlaybackPaused(false)
    startProgressTimer()
    return true
  }, [currentSong, runPlayerCommand, startProgressTimer])

  const applyPausePlayback = useCallback((seekToSeconds?: number) => {
    const didRun = runPlayerCommand((player) => {
      if (typeof seekToSeconds === 'number' && Number.isFinite(seekToSeconds) && seekToSeconds >= 0) {
        player.seekTo(seekToSeconds, true)
      }
      player.pauseVideo()
    })
    if (!didRun) return false

    setIsPlaybackPaused(true)
    stopProgressTimer()
    updateProgressFromPlayer()
    return true
  }, [runPlayerCommand, stopProgressTimer, updateProgressFromPlayer])

  const handlePreviousSong = useCallback(() => {
    if (isMusicControlBusyRef.current) return

    if (!currentSong) return
    const restarted = applyRestartPlayback()
    if (restarted) {
      void broadcastMusicSync({
        action: 'restart',
        songId: currentSong.id,
        issuedBy: user?.id,
        positionSeconds: 0,
        sentAtMs: Date.now(),
      })
    }
  }, [applyRestartPlayback, broadcastMusicSync, currentSong, user?.id])

  const handleNextSong = useCallback(async () => {
    if (isSkippingRef.current || isMusicControlBusyRef.current) return

    isMusicControlBusyRef.current = true
    isSkippingRef.current = true
    setSongProgress(0)
    setSongTimeLabel('0:00 / 0:00')
    setIsPlaybackPaused(false)
    try {
      stopProgressTimer()
      playerSessionRef.current += 1
      destroyPlayerSafely()
      await nextSong()
    } finally {
      isMusicControlBusyRef.current = false
      window.setTimeout(() => {
        isSkippingRef.current = false
      }, 150)
    }
  }, [destroyPlayerSafely, nextSong, stopProgressTimer])

  const handleStopCurrentSong = useCallback(() => {
    if (isMusicControlBusyRef.current) return

    isMusicControlBusyRef.current = true

    try {
      if (!currentSong) return

      if (isPlaybackPaused) {
        const resumed = applyResumePlayback()
        if (resumed) {
          void broadcastMusicSync({
            action: 'resume',
            songId: currentSong.id,
            issuedBy: user?.id,
            positionSeconds: getPlayerCurrentTime(),
            sentAtMs: Date.now(),
          })
        }
        return
      }

      const paused = applyPausePlayback()
      if (paused) {
        void broadcastMusicSync({
          action: 'pause',
          songId: currentSong.id,
          issuedBy: user?.id,
          positionSeconds: getPlayerCurrentTime(),
          sentAtMs: Date.now(),
        })
      }
    } finally {
      isMusicControlBusyRef.current = false
    }
  }, [applyPausePlayback, applyResumePlayback, broadcastMusicSync, currentSong, getPlayerCurrentTime, isPlaybackPaused, user?.id])

  useEffect(() => {
    const pending = pendingMusicSyncRef.current
    if (!pending || !currentSong || pending.songId !== currentSong.id) return

    const networkDelaySeconds = pending.sentAtMs ? Math.max(0, (Date.now() - pending.sentAtMs) / 1000) : 0
    let applied = false

    if (pending.action === 'pause') {
      applied = applyPausePlayback(pending.positionSeconds)
    } else if (pending.action === 'resume') {
      const resumePosition = (pending.positionSeconds ?? 0) + networkDelaySeconds
      applied = applyResumePlayback(resumePosition)
    } else if (pending.action === 'restart') {
      const restartPosition = (pending.positionSeconds ?? 0) + networkDelaySeconds
      applied = applyRestartPlayback(restartPosition)
    }

    if (applied) {
      pendingMusicSyncRef.current = null
    }
  }, [currentSong, applyPausePlayback, applyResumePlayback, applyRestartPlayback])

  useEffect(() => {
    if (!voiceChannelId) {
      pendingMusicSyncRef.current = null
      if (musicSyncChannelRef.current) {
        void musicSyncChannelRef.current.unsubscribe()
        musicSyncChannelRef.current = null
      }
      return
    }

    const syncChannel = supabase
      .channel(`music_sync:${voiceChannelId}`)
      .on('broadcast', { event: 'music-control' }, ({ payload }: { payload: MusicSyncPayload }) => {
        if (payload.issuedBy && payload.issuedBy === user?.id) return
        if (!currentSong || payload.songId !== currentSong.id) {
          pendingMusicSyncRef.current = payload
          return
        }
        const networkDelaySeconds = payload.sentAtMs ? Math.max(0, (Date.now() - payload.sentAtMs) / 1000) : 0
        let applied = false

        if (payload.action === 'pause') {
          applied = applyPausePlayback(payload.positionSeconds)
        } else if (payload.action === 'resume') {
          const resumePosition = (payload.positionSeconds ?? 0) + networkDelaySeconds
          applied = applyResumePlayback(resumePosition)
        } else if (payload.action === 'restart') {
          const restartPosition = (payload.positionSeconds ?? 0) + networkDelaySeconds
          applied = applyRestartPlayback(restartPosition)
        }

        if (!applied) {
          pendingMusicSyncRef.current = payload
        } else if (pendingMusicSyncRef.current?.songId === payload.songId) {
          pendingMusicSyncRef.current = null
        }
      })
      .subscribe()

    musicSyncChannelRef.current = syncChannel

    return () => {
      if (musicSyncChannelRef.current === syncChannel) {
        musicSyncChannelRef.current = null
      }
      void syncChannel.unsubscribe()
    }
  }, [voiceChannelId, currentSong, applyPausePlayback, applyResumePlayback, applyRestartPlayback, user?.id])

  useEffect(() => {
    const source = currentSong?.youtube_url
    if (!voiceChannelId || !source || !playerHostRef.current || !isConnected) {
      stopProgressTimer()
      clearPlayerRecoveryTimeout()
      setIsPlaybackPaused(false)
      playerSessionRef.current += 1
      destroyPlayerSafely()
      return
    }

    let cancelled = false
    playerSessionRef.current += 1
    const sessionId = playerSessionRef.current
    playerReadyRef.current = false
    clearPlayerRecoveryTimeout()
    const initialMuteParam = 1
    const playerOrigin = window.location.origin.startsWith('http')
      ? window.location.origin
      : undefined
    const effectivePlayerOrigin = disablePlayerOriginRef.current ? undefined : playerOrigin

    void ensureYouTubeApi()
      .then(async (yt) => {
        if (cancelled || !playerHostRef.current || !yt?.Player || sessionId !== playerSessionRef.current) return

        let playbackSource = source
        let searchQuery: string | null = null

        if (isSearchSource(source)) {
          searchQuery = toSearchQuery(source)

          const resolved = await resolveYouTubeSource(searchQuery)
          if (cancelled || !playerHostRef.current || sessionId !== playerSessionRef.current) return

          if (resolved?.source) {
            playbackSource = resolved.source
            searchQuery = null

            if (isSongOwner && currentSong && resolved.source !== source) {
              void supabase
                .from('music_queue')
                .update({ youtube_url: resolved.source, title: resolved.title ?? currentSong.title } as never)
                .eq('id', currentSong.id)
                .then(({ error }) => {
                  if (error) {
                    console.error('Failed to persist resolved playback source:', error)
                  }
                })
            }
          }
        }

        const videoId = getYoutubeId(playbackSource)

        destroyPlayerSafely()
        playerHostRef.current.innerHTML = ''

        try {
          playerRef.current = new yt.Player(playerHostRef.current, {
            width: '320',
            height: '180',
            videoId: videoId ?? undefined,
              playerVars: {
                autoplay: 1,
                controls: 0,
                disablekb: 1,
                fs: 0,
                playsinline: 1,
                rel: 0,
                origin: effectivePlayerOrigin,
                mute: initialMuteParam,
                listType: searchQuery ? 'search' : undefined,
                list: searchQuery ?? undefined,
              },
              events: {
                onReady: (event) => {
                  if (sessionId !== playerSessionRef.current) return
                  playerReadyRef.current = true
                  hasPlaybackStartedRef.current = false
                  clearPlayerRecoveryTimeout()
                  clearPlayerStartTimeout()
                  event.target.mute()
                  setIsPlaybackPaused(false)
                  event.target.playVideo()
                  updateProgressFromPlayer()

                  playerStartTimeoutRef.current = window.setTimeout(() => {
                    if (sessionId !== playerSessionRef.current || hasPlaybackStartedRef.current) return

                    console.error('YouTube player stayed unstarted after onReady, remounting.')
                    if (!disablePlayerOriginRef.current && playerOrigin) {
                      disablePlayerOriginRef.current = true
                    }
                    setPlayerNonce((prev) => prev + 1)
                  }, 3000)

                const pending = pendingMusicSyncRef.current
                if (pending && currentSong && pending.songId === currentSong.id) {
                  const networkDelaySeconds = pending.sentAtMs ? Math.max(0, (Date.now() - pending.sentAtMs) / 1000) : 0
                  let applied = false
                  if (pending.action === 'pause') {
                    applied = applyPausePlayback(pending.positionSeconds)
                  } else if (pending.action === 'resume') {
                    const resumePosition = (pending.positionSeconds ?? 0) + networkDelaySeconds
                    applied = applyResumePlayback(resumePosition)
                  } else if (pending.action === 'restart') {
                    const restartPosition = (pending.positionSeconds ?? 0) + networkDelaySeconds
                    applied = applyRestartPlayback(restartPosition)
                  }
                  if (applied) {
                    pendingMusicSyncRef.current = null
                  }
                }

                if (
                  isSongOwner &&
                  currentSong &&
                  startSyncSentForSongRef.current !== currentSong.id
                ) {
                  startSyncSentForSongRef.current = currentSong.id
                  void broadcastMusicSync({
                    action: 'resume',
                    songId: currentSong.id,
                    issuedBy: user?.id,
                    positionSeconds: 0,
                    sentAtMs: Date.now(),
                  })
                }
              },
              onStateChange: (event) => {
                if (sessionId !== playerSessionRef.current) return
                if (event.data === yt.PlayerState.PLAYING) {
                  hasPlaybackStartedRef.current = true
                  clearPlayerStartTimeout()
                  setIsPlaybackPaused(false)
                  if (isDeafened) event.target.mute()
                  else event.target.unMute()
                  startProgressTimer()

                  if (
                    isSongOwner &&
                    currentSong &&
                    isSearchSource(currentSong.youtube_url) &&
                    persistedResolvedSourceForSongRef.current !== currentSong.id
                  ) {
                    const playerLike = event.target as unknown as {
                      getVideoUrl?: () => string
                      getVideoData?: () => { video_id?: string }
                    }

                    let resolvedPlaybackSource: string | null = null
                    const resolvedByUrl = playerLike.getVideoUrl?.()
                    if (typeof resolvedByUrl === 'string' && resolvedByUrl.includes('watch?v=')) {
                      resolvedPlaybackSource = resolvedByUrl
                    }

                    if (!resolvedPlaybackSource) {
                      const resolvedVideoId = playerLike.getVideoData?.()?.video_id
                      if (typeof resolvedVideoId === 'string' && resolvedVideoId.length === 11) {
                        resolvedPlaybackSource = `https://www.youtube.com/watch?v=${resolvedVideoId}`
                      }
                    }

                    if (resolvedPlaybackSource) {
                      persistedResolvedSourceForSongRef.current = currentSong.id
                      void supabase
                        .from('music_queue')
                        .update({ youtube_url: resolvedPlaybackSource } as never)
                        .eq('id', currentSong.id)
                        .then(({ error }) => {
                          if (error) {
                            console.error('Failed to persist active YouTube source from player:', error)
                          }
                        })
                    }
                  }
                } else if (event.data === yt.PlayerState.PAUSED) {
                  setIsPlaybackPaused(true)
                  stopProgressTimer()
                  updateProgressFromPlayer()
                } else if (event.data === yt.PlayerState.BUFFERING) {
                  stopProgressTimer()
                  updateProgressFromPlayer()
                } else if (event.data === yt.PlayerState.ENDED) {
                  clearPlayerStartTimeout()
                  setIsPlaybackPaused(false)
                  stopProgressTimer()
                  setSongProgress(100)
                  if (isSongOwner) {
                    void handleNextSong()
                  }
                }
              },
              onError: (event) => {
                playerReadyRef.current = false
                hasPlaybackStartedRef.current = false
                clearPlayerRecoveryTimeout()
                clearPlayerStartTimeout()
                if (!disablePlayerOriginRef.current && playerOrigin) {
                  disablePlayerOriginRef.current = true
                  setPlayerNonce((prev) => prev + 1)
                  return
                }
                console.error('YouTube player error:', event.data)
              },
            },
          })

          clearPlayerRecoveryTimeout()
          playerRecoveryTimeoutRef.current = window.setTimeout(() => {
            if (sessionId !== playerSessionRef.current || playerReadyRef.current || !currentSong) return
            console.error('YouTube player did not become ready in time, retrying mount once.')
            destroyPlayerSafely()
            setPlayerNonce((prev) => prev + 1)
          }, 4000)
        } catch (error) {
          console.error('Failed to initialize YouTube player:', error)
          destroyPlayerSafely()
        }
      })
      .catch((error) => {
        console.error('Failed to load YouTube API:', error)
      })

    return () => {
      cancelled = true
      stopProgressTimer()
      clearPlayerRecoveryTimeout()
      setIsPlaybackPaused(false)
      playerSessionRef.current += 1
      destroyPlayerSafely()
    }
  }, [currentSong, currentSong?.id, currentSong?.youtube_url, voiceChannelId, isConnected, playerNonce, isSongOwner, user?.id, isDeafened, applyPausePlayback, applyRestartPlayback, applyResumePlayback, broadcastMusicSync, clearPlayerRecoveryTimeout, clearPlayerStartTimeout, destroyPlayerSafely, handleNextSong, startProgressTimer, stopProgressTimer, updateProgressFromPlayer])

  const renderMusicPlayer = () => {
    if (!currentSong || !voiceChannelId) return null

    return (
      <div 
        ref={playerHostRef} 
        style={{ 
          position: 'fixed', 
          width: '320px', 
          height: '180px', 
          right: '12px', 
          bottom: '12px', 
          opacity: 0.015,
          overflow: 'hidden',
          borderRadius: '12px',
          zIndex: 0,
          pointerEvents: 'none' 
        }} 
      />
    )

  }


  const renderSongBar = () => {
    if (!currentSong) return null

    const controls = [
      { label: '\u00d6nceki', icon: '<<', onClick: handlePreviousSong },
      { label: isPlaybackPaused ? UI.resume : 'Durdur', icon: isPlaybackPaused ? '>' : '[]', onClick: handleStopCurrentSong },
      { label: 'Sonraki', icon: '>>', onClick: handleNextSong },
    ]

    return (
      <div
        className="song-status-bar"
        style={{
          margin: '0 16px 12px 16px',
          padding: '12px 14px 10px 14px',
          borderRadius: '14px',
          border: '1px solid rgba(88, 101, 242, 0.32)',
          background: 'linear-gradient(135deg, rgba(88, 101, 242, 0.18), rgba(18, 21, 36, 0.88))',
          boxShadow: '0 14px 32px rgba(0, 0, 0, 0.22)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '18px' }}>
            {[10, 16, 12, 18].map((height, index) => (
              <span
                key={height}
                style={{
                  width: '4px',
                  height: `${isPlaying ? height : 8}px`,
                  borderRadius: '999px',
                  background: index % 2 === 0 ? '#8ea1ff' : '#cfd6ff',
                  opacity: isPlaying ? 1 : 0.45,
                  transition: `height 0.45s ease ${index * 0.06}s, opacity 0.25s ease`,
                }}
              />
            ))}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#aab4ff', marginBottom: '2px' }}>
              {UI.songBar}
            </div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#f5f7ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentSong.title}
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.66)' }}>
            <div>{isPlaybackPaused ? UI.paused : UI.playing}</div>
            <div style={{ marginTop: '2px', fontSize: '11px', opacity: 0.85 }}>{songTimeLabel}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {controls.map((control) => (
              <button
                key={control.label}
                onClick={() => void control.onClick()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '999px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: control.label === 'Durdur'
                    ? 'linear-gradient(135deg, rgba(255, 107, 129, 0.24), rgba(255, 107, 129, 0.08))'
                    : 'linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06))',
                  color: '#f7f8ff',
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 10px 22px rgba(0,0,0,0.18)',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.14)',
                    fontSize: control.label === 'Durdur' ? '8px' : '11px',
                    lineHeight: 1,
                  }}
                >
                  {control.icon}
                </span>
                {control.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ height: '4px', borderRadius: '999px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden', cursor: 'pointer' }} onClick={(event) => {
          const player = playerRef.current
          if (!player || !playerReadyRef.current) return
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
          let duration = 0
          try {
            duration = player.getDuration()
          } catch (error) {
            console.error('Failed to read player duration:', error)
            return
          }
          if (!Number.isFinite(duration) || duration <= 0) return
          const didSeek = runPlayerCommand((activePlayer) => {
            activePlayer.seekTo(duration * ratio, true)
          })
          if (!didSeek) return
          updateProgressFromPlayer()
        }}>
          <div
            style={{
              width: `${songProgress}%`,
              height: '100%',
              borderRadius: '999px',
              background: 'linear-gradient(90deg, #8ea1ff, #d7ddff)',
              boxShadow: '0 0 18px rgba(142, 161, 255, 0.45)',
              transition: isPlaying ? 'width 0.18s linear' : 'width 0.24s ease',
            }}
          />
        </div>
        {!isPlaying && (
          <button className="btn btn-primary" onClick={() => {
            if (!currentSong) return
            playerSessionRef.current += 1
            destroyPlayerSafely()
            setPlayerNonce((prev) => prev + 1)
          }} style={{ alignSelf: 'flex-end' }}>
            {UI.musicStart}
          </button>
        )}
      </div>
    )
  }

  const renderCommandHelp = () => {
    if (filteredCommands.length === 0) return null

    return (
      <div className="command-suggestions" style={{ position: 'absolute', bottom: '100%', left: '20px', width: '300px', background: '#2f3136', border: '1px solid #202225', borderRadius: '8px 8px 0 0', marginBottom: '8px', boxShadow: '0 -4px 12px rgba(0,0,0,0.2)', overflow: 'hidden', zIndex: 1000 }}>
        <div style={{ padding: '8px 12px', fontSize: '12px', fontWeight: 'bold', color: '#b9bbbe', background: '#202225' }}>KOMUTLAR</div>
        {filteredCommands.map((command, index) => (
          <div
            key={command.cmd}
            className="command-item"
            onClick={() => applyCommandSelection(command)}
            onMouseEnter={() => setSelectedCommandIndex(index)}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              borderBottom: '1px solid #292b2f',
              color: '#dcddde',
              background: index === selectedCommandIndex ? 'rgba(88, 101, 242, 0.16)' : 'transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 'bold', color: index === selectedCommandIndex ? '#8ea1ff' : 'var(--accent)' }}>{command.cmd}</span>
              <span style={{ fontSize: '12px', opacity: 0.7 }}>{command.example}</span>
            </div>
            <div style={{ fontSize: '11px', color: '#b9bbbe', marginTop: '2px' }}>{command.desc}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="app-layout" style={{ flexDirection: 'column' }}>
      <TitleBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="sidebar-brand-dot" />
            <div className="sidebar-brand-text">
              <h1>CsHub</h1>
              <span>{UI.brandSubline}</span>
            </div>
          </div>
          <button onClick={() => setShowCreateChannel(true)} title={UI.createChannel}>{Icons.add}</button>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-glance-card">
            <div className="glance-title">{UI.quickAccess}</div>
            <div className="glance-metrics">
              <span><strong>{textChannels.length}</strong> metin</span>
              <span><strong>{voiceChannels.length}</strong> ses</span>
            </div>
            <p className="glance-tip">{UI.quickTip}</p>
          </div>

          <div className="channel-section">
            <div className="channel-section-header">
              <span>{UI.textChannels}</span>
              <button onClick={() => { setNewChannelType('text'); setShowCreateChannel(true) }}>{Icons.add}</button>
            </div>
            {textChannels.map((channel) => (
              <ChannelItem key={channel.id} channel={channel} isActive={activeChannel?.id === channel.id} onClick={() => setActiveChannel(channel)} onDelete={() => deleteChannel(channel.id)} />
            ))}
            {textChannels.length === 0 && !channelsLoading && (
              <div className="channel-item" style={{ opacity: 0.5, cursor: 'default' }}>
                <span className="icon">{Icons.hash}</span>
                <span>{UI.noChannel}</span>
              </div>
            )}
          </div>

          <div className="channel-section">
            <div className="channel-section-header">
              <span>{UI.voiceChannels}</span>
              <button onClick={() => { setNewChannelType('voice'); setShowCreateChannel(true) }}>{Icons.add}</button>
            </div>
            {voiceChannels.map((channel) => (
              <ChannelItem
                key={channel.id}
                channel={channel}
                isActive={activeChannel?.id === channel.id}
                onClick={() => {
                  setActiveChannel(channel)
                  setVoiceChannelId(channel.id)
                }}
                onDelete={() => deleteChannel(channel.id)}
                isVoice
              />
            ))}
            {voiceChannels.length === 0 && !channelsLoading && (
              <div className="channel-item voice" style={{ opacity: 0.5, cursor: 'default' }}>
                <span className="icon">{Icons.voice}</span>
                <span>{UI.noChannel}</span>
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          {voiceChannelId && (
            <div className="voice-status-bar" style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#43b581' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="pulse-dot" style={{ width: '8px', height: '8px', background: isConnected ? '#43b581' : '#f0b232', borderRadius: '50%' }} />
                  {isConnected ? UI.connected : UI.connectingInline}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {voiceChannels.find((channel) => channel.id === voiceChannelId)?.name || UI.voiceFallback}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={toggleMute} style={{ background: 'transparent', border: 'none', color: isMuted ? '#f04747' : 'inherit', cursor: 'pointer' }}>{isMuted ? Icons.micOff : Icons.mic}</button>
                <button onClick={handleDisconnectVoice} style={{ background: 'transparent', border: 'none', color: '#f04747', cursor: 'pointer', fontSize: '16px' }}>{Icons.leave}</button>
              </div>
            </div>
          )}

          <div className="user-panel">
            <img src={user?.avatar_url || getDefaultAvatar(user?.nickname || 'U')} alt={user?.nickname} className={`user-avatar ${speakingUsers.has(user?.id || '') ? 'speaking' : ''}`} onClick={() => fileInputRef.current?.click()} style={{ cursor: 'pointer' }} title={UI.changeAvatar} />
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
            <div className="user-info">
              <div className="user-name">{user?.nickname}</div>
              <div className="user-status">{UI.online}</div>
            </div>
            <div className="user-controls">
              <button title={UI.settings} onClick={() => setShowSettings(true)}>{Icons.settings}</button>
              <button onClick={logout} title={UI.logout}>{Icons.logout}</button>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {renderMusicPlayer()}

        {renderSongBar()}

        {activeChannel ? (
          <>
            <div className="main-header">
              <span className="channel-type">{activeChannel.type === 'text' ? Icons.hash : Icons.voice}</span>
              <span className="channel-name">{activeChannel.name}</span>
            </div>

            <div className="chat-container">
              {activeChannel.type === 'voice' && (
                <div className="voice-container animate-fade-in" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', zIndex: 10 }}>
                  <div className="voice-participants" style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    {participants.map((participant) => (
                      <div key={participant.id} className={`voice-participant ${speakingUsers.has(participant.user_id) ? 'speaking' : ''} ${participant.is_muted ? 'muted' : ''}`} style={{ minWidth: '80px' }}>
                        <img src={participant.user?.avatar_url || getDefaultAvatar(participant.user?.nickname || 'U')} alt={participant.user?.nickname} className="avatar" />
                        <span className="name" style={{ fontSize: '12px' }}>{participant.user?.nickname || UI.unknownUser}</span>
                        <div className="status-icons">
                          {participant.is_muted && <span>{Icons.micOff}</span>}
                          {participant.is_deafened && <span>{Icons.deafen}</span>}
                        </div>
                      </div>
                    ))}
                    {(!isConnected || participants.length === 0) && <div className="voice-participant" style={{ opacity: 0.5, border: '1px dashed var(--border)' }}><span className="name">{isConnected ? UI.noPeople : UI.connecting}</span></div>}
                  </div>

                  {isConnected && (
                    <div className="voice-controls" style={{ padding: '8px 16px', background: 'rgba(0,0,0,0.2)', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <button className={`voice-control-btn ${isMuted ? 'active' : ''}`} onClick={toggleMute} title="Mikrofon">{isMuted ? Icons.micOff : Icons.mic}</button>
                      <button className={`voice-control-btn ${isDeafened ? 'active' : ''}`} onClick={toggleDeafen} title="Sağırlaştır">{Icons.deafen}</button>
                      <button className={`voice-control-btn ${isScreenSharing ? 'active' : ''}`} onClick={isScreenSharing ? stopScreenShare : startScreenShare} title="Ekran Paylaş">{Icons.share}</button>
                      <button className="voice-control-btn disconnect" onClick={handleDisconnectVoice} title="Ayrıl">{Icons.leave}</button>
                    </div>
                  )}

                  {(participants.some((participant) => participant.is_screen_sharing) || isScreenSharing) && (
                    <div style={{ padding: '8px 16px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {isScreenSharing && (
                        <button className="btn btn-primary" style={{ fontSize: '13px', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setWatchingScreen({ userId: user?.id || '', nickname: user?.nickname || '' })}>
                          {Icons.share} {UI.yourStream}
                        </button>
                      )}
                      {participants.filter((p) => p.is_screen_sharing && hasVideoTrack(remoteStreams.get(p.user_id))).map((participant) => (
                        <button key={participant.id} className="btn btn-primary" style={{ fontSize: '13px', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setWatchingScreen({ userId: participant.user_id, nickname: participant.user?.nickname || UI.unknownUser })}>
                          {Icons.share} {`${participant.user?.nickname || UI.unknownUser} ekranini gor`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="messages-container">
                {messagesLoading ? (
                  <div className="loading"><div className="spinner" /></div>
                ) : messages.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">{activeChannel.type === 'text' ? Icons.hash : Icons.voice}</div>
                    <h3 className="empty-state-title">{`#${activeChannel.name} kanalına hoş geldin!`}</h3>
                    <p className="empty-state-text">{UI.channelStart}</p>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div key={message.id ?? `${message.created_at}-${index}`} className="message">
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

              <div className="message-input-container" style={{ position: 'relative' }}>
                {renderCommandHelp()}
                {isSearchingMusic && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      right: '20px',
                      marginBottom: '8px',
                      padding: '6px 10px',
                      borderRadius: '999px',
                      background: 'rgba(88, 101, 242, 0.14)',
                      border: '1px solid rgba(88, 101, 242, 0.35)',
                      color: '#cfd6ff',
                      fontSize: '12px',
                      fontWeight: 600,
                      letterSpacing: '0.03em',
                      zIndex: 1001,
                    }}
                  >
                    {UI.searching}
                  </div>
                )}
                <div className="message-input-wrapper">
                  <input
                    type="text"
                    className="message-input"
                    placeholder={activeChannel ? UI.sendPlaceholder(activeChannel.name) : 'Mesaj yaz'}
                    value={messageInput}
                    onChange={(event) => setMessageInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (filteredCommands.length > 0) {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          setSelectedCommandIndex((current) => (current + 1) % filteredCommands.length)
                          return
                        }

                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          setSelectedCommandIndex((current) => (current - 1 + filteredCommands.length) % filteredCommands.length)
                          return
                        }

                        if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
                          event.preventDefault()
                          applyCommandSelection(filteredCommands[selectedCommandIndex])
                          return
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setMessageInput((current) => (current.startsWith('!') && !current.includes(' ') ? `${current} ` : current))
                          setSelectedCommandIndex(0)
                          return
                        }
                      }

                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void handleSendMessage()
                      }
                    }}
                  />
                  <button className="send-button" onClick={handleSendMessage} disabled={!messageInput.trim() || isProcessing}>{Icons.send}</button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">...</div>
            <h3 className="empty-state-title">{UI.welcome}</h3>
            <p className="empty-state-text">{UI.welcomeBody}</p>
          </div>
        )}
      </main>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {showCreateChannel && (
        <div className="modal-overlay" onClick={() => setShowCreateChannel(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{UI.createChannel}</h2>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{UI.channelType}</label>
                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                  <button className={`btn ${newChannelType === 'text' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setNewChannelType('text')} type="button">{`${Icons.hash} Metin`}</button>
                  <button className={`btn ${newChannelType === 'voice' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setNewChannelType('voice')} type="button">{`${Icons.voice} Ses`}</button>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label className="form-label" htmlFor="channelName">{UI.channelName}</label>
                <input id="channelName" type="text" className="form-input" placeholder="yeni-kanal" value={newChannelName} onChange={(event) => setNewChannelName(event.target.value.toLowerCase().replace(/\s+/g, '-'))} autoFocus />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreateChannel(false)}>{UI.cancel}</button>
              <button className="btn btn-primary" onClick={handleCreateChannel} disabled={!newChannelName.trim()}>{UI.create}</button>
            </div>
          </div>
        </div>
      )}

      {watchingScreen && (() => {
        const isSelf = watchingScreen.userId === user?.id
        const stream = isSelf ? screenShareStream : (remoteStreams.get(watchingScreen.userId) ?? null)
        if (!hasVideoTrack(stream)) return null
        return (
          <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.92)', zIndex: 9999, cursor: 'default' }} onClick={() => setWatchingScreen(null)}>
            <div style={{ width: '90vw', maxWidth: '1400px', display: 'flex', flexDirection: 'column', gap: '12px' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <span style={{ fontWeight: 700, fontSize: '15px', color: 'white' }}>{isSelf ? UI.yourStream : `${watchingScreen.nickname} ekrani`}</span>
                <button className="btn" style={{ padding: '6px 16px', fontSize: '13px', background: 'var(--danger)', color: 'white' }} onClick={() => setWatchingScreen(null)}>Kapat</button>
              </div>
              <video autoPlay playsInline muted={isSelf} ref={(el) => { if (el) el.srcObject = stream }} style={{ width: '100%', borderRadius: '8px', background: '#000' }} />
            </div>
          </div>
        )
      })()}
      </div>
    </div>
  )
}

function ChannelItem({ channel, isActive, onClick, onDelete, isVoice }: { channel: Channel; isActive: boolean; onClick: () => void; onDelete: () => void; isVoice?: boolean }) {
  const [showDelete, setShowDelete] = useState(false)

  return (
    <div className={`channel-item ${isActive ? 'active' : ''} ${isVoice ? 'voice' : ''}`} onClick={onClick} onMouseEnter={() => setShowDelete(true)} onMouseLeave={() => setShowDelete(false)}>
      <span className="icon">{isVoice ? Icons.voice : Icons.hash}</span>
      <span style={{ flex: 1 }}>{channel.name}</span>
      {showDelete && (
        <button
          onClick={(event) => {
            event.stopPropagation()
            if (confirm(UI.deleteConfirm(channel.name))) {
              onDelete()
            }
          }}
          style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '2px' }}
        >
          {Icons.delete}
        </button>
      )}
    </div>
  )
}
