import { useState, FormEvent } from 'react'
import { useAuth } from '@/hooks'

interface AuthPageProps {
    onSuccess: () => void
}

export function AuthPage({ onSuccess }: AuthPageProps) {
    const [isLogin, setIsLogin] = useState(true)
    const [nickname, setNickname] = useState('')
    const [password, setPassword] = useState('')
    const { login, register, loading, error, clearError } = useAuth()

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        clearError()

        if (!nickname.trim() || !password.trim()) return

        const result = isLogin
            ? await login(nickname.trim(), password)
            : await register(nickname.trim(), password)

        if (result.success) {
            onSuccess()
        }
    }

    const toggleMode = () => {
        setIsLogin(!isLogin)
        clearError()
    }

    return (
        <div className="auth-page">
            <div className="auth-container">
                <div className="auth-header">
                    <img src="/favicon.svg" alt="CsHub" className="auth-logo" />
                    <h1 className="auth-title">
                        {isLogin ? 'Tekrar Hoş Geldin!' : 'CsHub\'a Katıl'}
                    </h1>
                    <p className="auth-subtitle">
                        {isLogin
                            ? 'Arkadaşlarınla sohbete devam et'
                            : 'Arkadaşlarınla iletişim kur'}
                    </p>
                </div>

                <form className="auth-form" onSubmit={handleSubmit}>
                    {error && <div className="auth-error">{error}</div>}

                    <div className="form-group">
                        <label className="form-label" htmlFor="nickname">Nickname</label>
                        <input
                            id="nickname"
                            type="text"
                            className="form-input"
                            placeholder="Nicknameini gir"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            autoComplete="username"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="password">Şifre</label>
                        <input
                            id="password"
                            type="password"
                            className="form-input"
                            placeholder="Şifreni gir"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete={isLogin ? 'current-password' : 'new-password'}
                            required
                            minLength={4}
                        />
                    </div>

                    <button
                        type="submit"
                        className="auth-button"
                        disabled={loading || !nickname.trim() || !password.trim()}
                    >
                        {loading ? 'Yükleniyor...' : isLogin ? 'Giriş Yap' : 'Kayıt Ol'}
                    </button>
                </form>

                <div className="auth-switch">
                    {isLogin ? (
                        <>Hesabın yok mu? <a href="#" onClick={(e) => { e.preventDefault(); toggleMode() }}>Kayıt ol</a></>
                    ) : (
                        <>Zaten hesabın var mı? <a href="#" onClick={(e) => { e.preventDefault(); toggleMode() }}>Giriş yap</a></>
                    )}
                </div>
            </div>
        </div>
    )
}
