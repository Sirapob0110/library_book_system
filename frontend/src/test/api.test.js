import { describe, expect, test, vi } from 'vitest'
import { apiRequest, getAccessToken, login, logout, refreshSession, setAccessToken, setSessionLostHandler } from '../api'
import { mockFetch, session } from './helpers'

describe('api: access token อยู่ในหน่วยความจำ', () => {
  test('login เก็บ token ในตัวแปร ไม่เขียน sessionStorage/localStorage และส่งคำขอพร้อม cookie', async () => {
    const { calls } = mockFetch({ 'POST /api/auth/login': session('abc') })

    await login('somchai', 'pw')

    expect(getAccessToken()).toBe('abc')
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.getItem('library_session')).toBeNull()
    expect(calls[0].options.credentials).toBe('include')
  })

  test('แนบ Authorization: Bearer ในคำขอที่ต้องล็อกอิน', async () => {
    setAccessToken('abc')
    const { calls } = mockFetch({ 'GET /api/books': { body: { data: [] } } })

    await apiRequest('http://api.test/api/books')

    expect(calls[0].options.headers.Authorization).toBe('Bearer abc')
  })

  test('logout เรียกเซิร์ฟเวอร์และล้าง token แม้เรียกไม่สำเร็จ', async () => {
    setAccessToken('abc')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await logout()

    expect(getAccessToken()).toBeNull()
  })
})

describe('api: ต่ออายุเมื่อได้ 401', () => {
  test('401 -> refresh หนึ่งครั้ง -> ยิงคำขอเดิมซ้ำด้วย token ใหม่', async () => {
    setAccessToken('old')
    const { calls } = mockFetch({
      'GET /api/books': (n, o) =>
        o.headers.Authorization === 'Bearer new' ? { body: { data: ['ok'] } } : { status: 401, body: { error: 'หมดอายุ' } },
      'POST /api/auth/refresh': session('new'),
    })

    const result = await apiRequest('http://api.test/api/books')

    expect(result.data).toEqual(['ok'])
    expect(getAccessToken()).toBe('new')
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/books', 'POST /api/auth/refresh', 'GET /api/books'])
  })

  test('คำขอที่ 401 พร้อมกันหลายตัวใช้ refresh ครั้งเดียว (single-flight)', async () => {
    setAccessToken('old')
    const { calls } = mockFetch({
      'GET /api/a': (n, o) => (o.headers.Authorization === 'Bearer new' ? { body: { v: 'a' } } : { status: 401, body: {} }),
      'GET /api/b': (n, o) => (o.headers.Authorization === 'Bearer new' ? { body: { v: 'b' } } : { status: 401, body: {} }),
      'POST /api/auth/refresh': session('new'),
    })

    const [a, b] = await Promise.all([apiRequest('http://api.test/api/a'), apiRequest('http://api.test/api/b')])

    expect([a.v, b.v]).toEqual(['a', 'b'])
    expect(calls.filter((c) => c.path === '/api/auth/refresh')).toHaveLength(1)
  })

  test('refresh ไม่สำเร็จ (401): แจ้งเซสชันหมดอายุ ล้าง token และ throw', async () => {
    setAccessToken('old')
    const lost = vi.fn()
    setSessionLostHandler(lost)
    mockFetch({
      'GET /api/books': { status: 401, body: {} },
      'POST /api/auth/refresh': { status: 401, body: { code: 'INVALID_REFRESH_TOKEN' } },
    })

    await expect(apiRequest('http://api.test/api/books')).rejects.toThrow('กรุณาเข้าสู่ระบบใหม่')

    expect(lost).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })

  test('refresh ได้ 409 (อีกแท็บเพิ่งหมุน token) แล้วลองใหม่สำเร็จ', async () => {
    vi.useFakeTimers()
    const { calls } = mockFetch({
      'POST /api/auth/refresh': (n) => (n === 1 ? { status: 409, body: { code: 'REFRESH_CONFLICT' } } : session('after-retry')),
    })

    const pending = refreshSession()
    await vi.advanceTimersByTimeAsync(800)
    const data = await pending
    vi.useRealTimers()

    expect(data.token).toBe('after-retry')
    expect(calls).toHaveLength(2)
  })

  test('ข้อผิดพลาดอื่น (เช่น 409 ของระบบ) ไม่ถูกมองเป็นเซสชันหมดอายุ และแสดงข้อความจากเซิร์ฟเวอร์', async () => {
    setAccessToken('t')
    const lost = vi.fn()
    setSessionLostHandler(lost)
    mockFetch({ 'POST /api/loans': { status: 409, body: { error: 'ยืมครบจำนวนที่กำหนดแล้ว', code: 'LOAN_LIMIT_REACHED' } } })

    await expect(apiRequest('http://api.test/api/loans', { method: 'POST', body: '{}' })).rejects.toThrow('ยืมครบจำนวนที่กำหนดแล้ว')
    expect(lost).not.toHaveBeenCalled()
  })

  test('เชื่อมต่อ API ไม่ได้: ข้อความภาษาไทย', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fail')))

    await expect(apiRequest('http://api.test/x')).rejects.toThrow('ไม่สามารถเชื่อมต่อ API ได้')
  })
})
