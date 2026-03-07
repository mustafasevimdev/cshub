import { useCallback, useEffect } from 'react'
import { useAudioSettings } from '@/hooks'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const UI = {
  title: 'Ayarlar',
  audio: 'Ses Ayarları',
  input: 'Mikrofon',
  inputLevel: 'Mikrofon Seviyesi',
  micTest: 'Mikrofon Testi',
  startTest: '\uD83C\uDFA4 Testi Başlat',
  stopTest: '\uD83D\uDD34 Testi Durdur',
  micHint: '\uD83D\uDD0A Konuştuğunda kendi sesini duymalısın',
  output: 'Hoparlör',
  outputLevel: 'Hoparlör Seviyesi',
  noise: 'Gürültü Azaltma',
  echo: 'Yankı Önleme',
  reset: 'Varsayılana Dön',
  done: 'Tamam',
  default: 'Varsayılan',
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { settings, devices, isTesting, micLevel, updateSetting, startMicTest, stopMicTest, resetSettings } = useAudioSettings()

  const handleClose = useCallback(() => {
    stopMicTest()
    onClose()
  }, [onClose, stopMicTest])

  useEffect(() => {
    if (!isOpen && isTesting) stopMicTest()
  }, [isOpen, isTesting, stopMicTest])

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal settings-modal settings-modal-glow" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">⚙️ {UI.title}</h2>
          <button className="modal-close" onClick={handleClose}>X</button>
        </div>
        <div className="modal-body settings-body">
          <div className="settings-section">
            <h3 className="settings-section-title">🎧 {UI.audio}</h3>
            <div className="settings-item"><label className="settings-label">{UI.input}</label><select className="settings-select" value={settings.inputDeviceId} onChange={event => updateSetting('inputDeviceId', event.target.value)}><option value="default">{UI.default}</option>{devices.inputs.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || `${UI.input} ${device.deviceId.slice(0, 8)}`}</option>)}</select></div>
            <div className="settings-item"><label className="settings-label">{UI.inputLevel}<span className="settings-value">{settings.inputVolume}%</span></label><input type="range" className="settings-slider" min="0" max="200" value={settings.inputVolume} onChange={event => updateSetting('inputVolume', parseInt(event.target.value, 10))} /></div>
            <div className="settings-item"><label className="settings-label">{UI.micTest}</label><div className={`mic-test-container ${isTesting ? 'active' : ''}`}><button className={`btn ${isTesting ? 'btn-danger' : 'btn-primary'}`} onClick={isTesting ? stopMicTest : startMicTest}>{isTesting ? UI.stopTest : UI.startTest}</button><div className="mic-level-container"><div className={`mic-level-bar ${isTesting ? 'active' : ''}`} style={{ width: `${micLevel}%` }} /></div></div>{isTesting && <p className="settings-hint">{UI.micHint}</p>}</div>
            <div className="settings-item"><label className="settings-label">{UI.output}</label><select className="settings-select" value={settings.outputDeviceId} onChange={event => updateSetting('outputDeviceId', event.target.value)}><option value="default">{UI.default}</option>{devices.outputs.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || `${UI.output} ${device.deviceId.slice(0, 8)}`}</option>)}</select></div>
            <div className="settings-item"><label className="settings-label">{UI.outputLevel}<span className="settings-value">{settings.outputVolume}%</span></label><input type="range" className="settings-slider" min="0" max="200" value={settings.outputVolume} onChange={event => updateSetting('outputVolume', parseInt(event.target.value, 10))} /></div>
            <div className="settings-item"><label className="settings-checkbox-label"><input type="checkbox" checked={settings.noiseSuppression} onChange={event => updateSetting('noiseSuppression', event.target.checked)} /><span className="checkbox-custom" />{UI.noise}</label></div>
            <div className="settings-item"><label className="settings-checkbox-label"><input type="checkbox" checked={settings.echoCancellation} onChange={event => updateSetting('echoCancellation', event.target.checked)} /><span className="checkbox-custom" />{UI.echo}</label></div>
          </div>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={resetSettings}>{UI.reset}</button><button className="btn btn-primary" onClick={handleClose}>{UI.done}</button></div>
      </div>
    </div>
  )
}

