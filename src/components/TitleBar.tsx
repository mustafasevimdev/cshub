import { useState, useEffect } from 'react'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI

  useEffect(() => {
    if (!window.electronAPI) return

    void window.electronAPI.isMaximized().then(setIsMaximized)

    const cleanup = window.electronAPI.onMaximizedChange(setIsMaximized)
    return cleanup
  }, [])

  if (!isElectron) return null

  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-title">CsHub</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn minimize"
          onClick={() => void window.electronAPI?.minimizeWindow()}
          aria-label="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="titlebar-btn maximize"
          onClick={() => void window.electronAPI?.maximizeWindow()}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="3" y="1" width="8" height="8" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="1" y="3" width="8" height="8" rx="0.5" fill="var(--bg-primary)" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          className="titlebar-btn close"
          onClick={() => void window.electronAPI?.closeWindow()}
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
