import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type AuthCtx = { session: any; loading: boolean }
const AuthContext = createContext<AuthCtx>({ session: null, loading: true })
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({
  children,
  enableSubscription = true,
  initialSession = null,
}) {
  const [session, setSession] = useState(initialSession)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!enableSubscription) {
      setLoading(false)
      return
    }

    // important: return unsubscribe; supabase v2 returns { data: { subscription } }
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })

    // also fetch current session once, asynchronously
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null)
      setLoading(false)
    })

    return () => {
      data?.subscription?.unsubscribe?.()
    }
  }, [enableSubscription])

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  )
}
