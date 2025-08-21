import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// CRITICAL: Manual cleanup for Vitest
afterEach(() => {
  cleanup()
})
