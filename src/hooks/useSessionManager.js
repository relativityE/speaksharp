import { useState, useEffect } from 'react';
import { storage } from '../lib/storage';

export const useSessionManager = () => {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSessions()
  }, [])

  const loadSessions = () => {
    setLoading(true)
    const savedSessions = storage.get('sessions') || []
    setSessions(savedSessions)
    setLoading(false)
  }

  const saveSession = (sessionData) => {
    const newSession = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      ...sessionData
    }

    const updatedSessions = [newSession, ...sessions].slice(0, 50) // Keep last 50
    setSessions(updatedSessions)
    storage.set('sessions', updatedSessions)

    return newSession.id
  }

  const deleteSession = (sessionId) => {
    const filtered = sessions.filter(s => s.id !== sessionId)
    setSessions(filtered)
    storage.set('sessions', filtered)
  }

  const exportSessions = () => {
    const dataStr = JSON.stringify({
      exportDate: new Date().toISOString(),
      version: '1.0',
      sessions: sessions
    }, null, 2)

    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)

    const link = document.createElement('a')
    link.href = url
    link.download = `speaksharp-sessions-${new Date().toISOString().split('T')[0]}.json`
    link.click()

    URL.revokeObjectURL(url)
  }

  return {
    sessions,
    loading,
    saveSession,
    deleteSession,
    exportSessions,
    refreshSessions: loadSessions
  }
}
