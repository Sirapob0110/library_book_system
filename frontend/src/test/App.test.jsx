import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import App from '../App'
import { getAccessToken } from '../api'
import { mockFetch, session, user } from './helpers'

const dataRoutes = {
  'GET /api/books': { body: { data: [], pagination: { total: 0, page: 1, limit: 10, total_pages: 0 } } },
  'GET /api/members/3/loans': {
    body: {
      member: { member_id: 3, name: 'สมชาย' },
      data: [
        { loan_id: 1, title: 'หนังสือเกินกำหนด', loan_date: '2026-01-01', due_date: '2026-01-08', return_date: null, days_overdue: 4, fine_amount: 20 },
        { loan_id: 2, title: 'หนังสือตรงเวลา', loan_date: '2026-01-01', due_date: '2026-01-08', return_date: '2026-01-07', days_overdue: 0, fine_amount: 0 },
      ],
    },
  },
}

describe('App: กู้เซสชันตอนเปิดหน้า', () => {
  test('ไม่มี refresh cookie (401): แสดงหน้าเข้าสู่ระบบ', async () => {
    mockFetch({ 'POST /api/auth/refresh': { status: 401, body: { code: 'INVALID_REFRESH_TOKEN' } } })
    render(<App />)

    expect(await screen.findByText('เข้าสู่ระบบเพื่อใช้งาน')).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })

  test('มี refresh cookie: เข้าหน้าหลักโดยไม่ต้องล็อกอินใหม่ และเก็บ token ในหน่วยความจำเท่านั้น', async () => {
    mockFetch({ 'POST /api/auth/refresh': session('restored'), ...dataRoutes })
    render(<App />)

    expect(await screen.findByText('สมาชิก (user)')).toBeInTheDocument()
    expect(getAccessToken()).toBe('restored')
    expect(sessionStorage.length).toBe(0)
  })

  test('ประวัติการยืมแสดงจำนวนวันที่เกินและค่าปรับ', async () => {
    mockFetch({ 'POST /api/auth/refresh': session(), ...dataRoutes })
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'ประวัติ / คืน' }))

    expect(await screen.findByText('เกิน 4 วัน · ค่าปรับ 20 บาท')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  test('ออกจากระบบ: เรียก /api/auth/logout, ล้าง token และกลับหน้าเข้าสู่ระบบ', async () => {
    const { calls } = mockFetch({
      'POST /api/auth/refresh': session(),
      'POST /api/auth/logout': { body: { success: true, data: {} } },
      ...dataRoutes,
    })
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'ออกจากระบบ' }))

    expect(await screen.findByText('เข้าสู่ระบบเพื่อใช้งาน')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/auth/logout')).toBe(true)
    expect(getAccessToken()).toBeNull()
    expect(user.username).toBe('somchai')
  })

  test('เปิดด้วยลิงก์ตั้งรหัสใหม่: ไม่พยายามกู้เซสชัน แสดงฟอร์มตั้งรหัสผ่านใหม่', async () => {
    window.history.replaceState(null, '', '/?reset_token=zzz')
    const { calls } = mockFetch({})
    render(<App />)

    expect(await screen.findByText('ตั้งรหัสผ่านใหม่', { selector: 'p' })).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/auth/refresh')).toBe(false)
  })
})
