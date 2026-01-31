import { useAudioSettings } from '@/hooks'

interface SettingsModalProps {
    isOpen: boolean
    onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const {
        settings,
        devices,
        isTesting,
        micLevel,
        updateSetting,
        startMicTest,
        stopMicTest,
        resetSettings
    } = useAudioSettings()

    if (!isOpen) return null

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">⚙️ Ayarlar</h2>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="modal-body settings-body">
                    {/* Audio Section */}
                    <div className="settings-section">
                        <h3 className="settings-section-title">🎤 Ses Ayarları</h3>

                        {/* Input Device */}
                        <div className="settings-item">
                            <label className="settings-label">Mikrofon</label>
                            <select
                                className="settings-select"
                                value={settings.inputDeviceId}
                                onChange={e => updateSetting('inputDeviceId', e.target.value)}
                            >
                                <option value="default">Varsayılan</option>
                                {devices.inputs.map(device => (
                                    <option key={device.deviceId} value={device.deviceId}>
                                        {device.label || `Mikrofon ${device.deviceId.slice(0, 8)}`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Input Volume */}
                        <div className="settings-item">
                            <label className="settings-label">
                                Mikrofon Seviyesi
                                <span className="settings-value">{settings.inputVolume}%</span>
                            </label>
                            <input
                                type="range"
                                className="settings-slider"
                                min="0"
                                max="200"
                                value={settings.inputVolume}
                                onChange={e => updateSetting('inputVolume', parseInt(e.target.value))}
                            />
                        </div>

                        {/* Mic Test */}
                        <div className="settings-item">
                            <label className="settings-label">Mikrofon Testi</label>
                            <div className="mic-test-container">
                                <button
                                    className={`btn ${isTesting ? 'btn-danger' : 'btn-primary'}`}
                                    onClick={isTesting ? stopMicTest : startMicTest}
                                >
                                    {isTesting ? '🔴 Testi Durdur' : '🎤 Testi Başlat'}
                                </button>
                                <div className="mic-level-container">
                                    <div
                                        className="mic-level-bar"
                                        style={{ width: `${micLevel}%` }}
                                    />
                                </div>
                            </div>
                            {isTesting && (
                                <p className="settings-hint">
                                    🔊 Konuştuğunda kendi sesini duymalısın
                                </p>
                            )}
                        </div>

                        {/* Output Device */}
                        <div className="settings-item">
                            <label className="settings-label">Hoparlör</label>
                            <select
                                className="settings-select"
                                value={settings.outputDeviceId}
                                onChange={e => updateSetting('outputDeviceId', e.target.value)}
                            >
                                <option value="default">Varsayılan</option>
                                {devices.outputs.map(device => (
                                    <option key={device.deviceId} value={device.deviceId}>
                                        {device.label || `Hoparlör ${device.deviceId.slice(0, 8)}`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Output Volume */}
                        <div className="settings-item">
                            <label className="settings-label">
                                Hoparlör Seviyesi
                                <span className="settings-value">{settings.outputVolume}%</span>
                            </label>
                            <input
                                type="range"
                                className="settings-slider"
                                min="0"
                                max="200"
                                value={settings.outputVolume}
                                onChange={e => updateSetting('outputVolume', parseInt(e.target.value))}
                            />
                        </div>

                        {/* Audio Processing */}
                        <div className="settings-item">
                            <label className="settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={settings.noiseSuppression}
                                    onChange={e => updateSetting('noiseSuppression', e.target.checked)}
                                />
                                <span className="checkbox-custom"></span>
                                Gürültü Azaltma
                            </label>
                        </div>

                        <div className="settings-item">
                            <label className="settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={settings.echoCancellation}
                                    onChange={e => updateSetting('echoCancellation', e.target.checked)}
                                />
                                <span className="checkbox-custom"></span>
                                Yankı Önleme
                            </label>
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={resetSettings}>
                        Varsayılana Dön
                    </button>
                    <button className="btn btn-primary" onClick={onClose}>
                        Tamam
                    </button>
                </div>
            </div>
        </div>
    )
}
