import { useState, useEffect } from 'react'
import { AuthPage, MainPage } from '@/pages'
import { useAuthStore } from '@/stores'

function App() {
    const { isAuthenticated } = useAuthStore()
    const [ready, setReady] = useState(false)

    // Wait for zustand to rehydrate from localStorage
    useEffect(() => {
        setReady(true)
    }, [])

    if (!ready) {
        return (
            <div className="auth-page">
                <div className="loading">
                    <div className="spinner"></div>
                </div>
            </div>
        )
    }

    if (!isAuthenticated) {
        return <AuthPage onSuccess={() => { }} />
    }

    return <MainPage />
}

export default App
