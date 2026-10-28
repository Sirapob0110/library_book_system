import { vi } from 'vitest'

// จำลอง fetch ตามตาราง [วิธี+พาธ] -> ฟังก์ชันคืน {status, body}
export function mockFetch(routes) {
  const calls = []
  const fn = vi.fn(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase()
    const path = String(url).replace('http://api.test', '').split('?')[0]
    calls.push({ method, path, options })
    const key = `${method} ${path}`
    const handler = routes[key]
    if (!handler) return jsonResponse(404, { error: `ไม่มี route ${key}` })
    const out = typeof handler === 'function' ? handler(calls.filter((c) => `${c.method} ${c.path}` === key).length, options) : handler
    return jsonResponse(out.status ?? 200, out.body ?? {})
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

export function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

export const user = { user_id: 7, username: 'somchai', role: 'user', member_id: 3, name: 'สมชาย' }
export const session = (token = 'tok-1') => ({ status: 200, body: { success: true, data: { token, expires_in: 900, user } } })
