class StorageManager {
  constructor() {
    this.prefix = 'speaksharp_'
    this.version = '1.0'
  }

  set(key, value) {
    try {
      const data = {
        value,
        timestamp: Date.now(),
        version: this.version
      }
      localStorage.setItem(this.prefix + key, JSON.stringify(data))
    } catch (error) {
      console.error('Storage error:', error)
      return false
    }
    return true
  }

  get(key) {
    try {
      const item = localStorage.getItem(this.prefix + key)
      if (!item) return null

      const data = JSON.parse(item)
      return data.value
    } catch (error) {
      console.error('Storage retrieval error:', error)
      return null
    }
  }

  remove(key) {
    localStorage.removeItem(this.prefix + key)
  }

  clear() {
    const keys = Object.keys(localStorage).filter(key => key.startsWith(this.prefix))
    keys.forEach(key => localStorage.removeItem(key))
  }

  // Export all user data
  exportData() {
    const data = {}
    const keys = Object.keys(localStorage).filter(key => key.startsWith(this.prefix))

    keys.forEach(key => {
      const cleanKey = key.replace(this.prefix, '')
      data[cleanKey] = this.get(cleanKey)
    })

    return data
  }
}

export const storage = new StorageManager()
