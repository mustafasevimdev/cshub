import { FormEvent, useState } from 'react'
import { useAuth } from '@/hooks'
import { TitleBar } from '@/components'

interface AuthPageProps {
  onSuccess: () => void
}

const UI = {
  loginTitle: 'Tekrar Hoş Geldin!',
  registerTitle: "CsHub'a Katıl",
  loginSubtitle: 'Arkadaşlarınla sohbete devam et.',
  registerSubtitle: 'Arkadaşlarınla hızlıca iletişim kur.',
  nickname: 'Kullanıcı Adı',
  nicknamePlaceholder: 'Kullanıcı adını gir',
  password: 'Şifre',
  passwordPlaceholder: 'Şifreni gir',
  loading: 'Yükleniyor...',
  login: 'Giriş Yap',
  register: 'Kayıt Ol',
  noAccount: 'Hesabın yok mu?',
  hasAccount: 'Zaten hesabın var mı?',
}

export function AuthPage({ onSuccess }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true)
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const { login, register, loading, error, clearError } = useAuth()

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    clearError()
    if (!nickname.trim() || !password.trim()) return
    const result = isLogin ? await login(nickname.trim(), password) : await register(nickname.trim(), password)
    if (result.success) onSuccess()
  }

  const toggleMode = () => {
    setIsLogin(current => !current)
    clearError()
  }

  return (
    <>
      <TitleBar />
      <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <img src="/favicon.svg" alt="CsHub" className="auth-logo" />
          <h1 className="auth-title">{isLogin ? UI.loginTitle : UI.registerTitle}</h1>
          <p className="auth-subtitle">{isLogin ? UI.loginSubtitle : UI.registerSubtitle}</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          <div className="form-group"><label className="form-label" htmlFor="nickname">{UI.nickname}</label><input id="nickname" type="text" className="form-input" placeholder={UI.nicknamePlaceholder} value={nickname} onChange={event => setNickname(event.target.value)} autoComplete="username" required /></div>
          <div className="form-group"><label className="form-label" htmlFor="password">{UI.password}</label><input id="password" type="password" className="form-input" placeholder={UI.passwordPlaceholder} value={password} onChange={event => setPassword(event.target.value)} autoComplete={isLogin ? 'current-password' : 'new-password'} required minLength={4} /></div>
          <button type="submit" className="auth-button" disabled={loading || !nickname.trim() || !password.trim()}>{loading ? UI.loading : isLogin ? UI.login : UI.register}</button>
        </form>

        <div className="auth-switch">
          {isLogin ? <>{UI.noAccount} <a href="#" onClick={event => { event.preventDefault(); toggleMode() }}>{UI.register}</a></> : <>{UI.hasAccount} <a href="#" onClick={event => { event.preventDefault(); toggleMode() }}>{UI.login}</a></>}
        </div>
      </div>
      </div>
    </>
  )
}
