import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { setAccessToken, setSessionLostHandler } from '../api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setAccessToken(null)
  setSessionLostHandler(null)
  window.history.replaceState(null, '', '/')
})
