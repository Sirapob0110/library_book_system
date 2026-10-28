import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import Login from '../Login'
import { getAccessToken } from '../api'
import { mockFetch, session } from './helpers'

describe('Login', () => {
  test('เข้าสู่ระบบสำเร็จ: ส่ง user ให้แอป (ไม่ส่ง token) และเก็บ token ในหน่วยความจำ', async () => {
    mockFetch({ 'POST /api/auth/login': session('tok') })
    const onLogin = vi.fn()
    render(<Login onLogin={onLogin} />)

    await userEvent.type(screen.getByPlaceholderText('username'), 'somchai')
    await userEvent.type(screen.getByPlaceholderText('รหัสผ่าน'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }))

    await waitFor(() => expect(onLogin).toHaveBeenCalled())
    expect(onLogin.mock.calls[0][0]).toEqual({ user: expect.objectContaining({ username: 'somchai' }) })
    expect(getAccessToken()).toBe('tok')
  })

  test('รหัสผ่านผิด: แสดงข้อความจากเซิร์ฟเวอร์', async () => {
    mockFetch({ 'POST /api/auth/login': { status: 401, body: { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' } } })
    render(<Login onLogin={vi.fn()} />)

    await userEvent.type(screen.getByPlaceholderText('username'), 'x')
    await userEvent.type(screen.getByPlaceholderText('รหัสผ่าน'), 'y')
    await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
  })

  test('ลืมรหัสผ่าน: ส่ง identifier และแสดงข้อความกลาง (ไม่บอกว่ามีบัญชีหรือไม่)', async () => {
    const { calls } = mockFetch({
      'POST /api/auth/forgot-password': { status: 202, body: { success: true, data: { message: 'ถ้ามีบัญชีนี้ในระบบ จะได้รับวิธีรีเซ็ตรหัสผ่าน' } } },
    })
    render(<Login onLogin={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'ลืมรหัสผ่าน?' }))
    await userEvent.type(screen.getByPlaceholderText(/username หรือ/), 'somchai@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'ขอลิงก์ตั้งรหัสผ่านใหม่' }))

    expect(await screen.findByRole('status')).toHaveTextContent('ถ้ามีบัญชีนี้ในระบบ')
    expect(JSON.parse(calls[0].options.body)).toEqual({ identifier: 'somchai@example.com' })
  })

  test('เปิดด้วยลิงก์ ?reset_token: แสดงฟอร์มตั้งรหัสใหม่, ตรวจรหัสไม่ตรงกันก่อนส่ง', async () => {
    window.history.replaceState(null, '', '/?reset_token=abc123')
    const { fn } = mockFetch({})
    render(<Login onLogin={vi.fn()} />)

    const [pw, confirm] = document.querySelectorAll('input[type=password]')
    await userEvent.type(pw, 'NewPassw0rd!')
    await userEvent.type(confirm, 'Different1!')
    await userEvent.click(screen.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่ตรงกัน')
    expect(fn).not.toHaveBeenCalled()
  })

  test('ตั้งรหัสใหม่สำเร็จ: ส่ง token+รหัส, ล้าง token ออกจาก URL และกลับหน้าเข้าสู่ระบบ', async () => {
    window.history.replaceState(null, '', '/?reset_token=abc123')
    const { calls } = mockFetch({ 'POST /api/auth/reset-password': { body: { success: true, data: { message: 'ok' } } } })
    render(<Login onLogin={vi.fn()} />)

    const [pw, confirm] = document.querySelectorAll('input[type=password]')
    await userEvent.type(pw, 'NewPassw0rd!')
    await userEvent.type(confirm, 'NewPassw0rd!')
    await userEvent.click(screen.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }))

    expect(await screen.findByRole('status')).toHaveTextContent('ตั้งรหัสผ่านใหม่สำเร็จ')
    expect(JSON.parse(calls[0].options.body)).toEqual({ token: 'abc123', password: 'NewPassw0rd!' })
    expect(window.location.search).toBe('')
    expect(screen.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeInTheDocument()
  })

  test('สมัครสมาชิก: ตรวจรหัสผ่านสั้นก่อนส่ง API', async () => {
    const { fn } = mockFetch({})
    render(<Login onLogin={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /สมัครสมาชิก/ }))
    await userEvent.type(screen.getByPlaceholderText('ชื่อ-นามสกุล'), 'สมชาย ใจดี')
    await userEvent.type(screen.getByPlaceholderText('name@example.com'), 'a@b.co')
    await userEvent.type(screen.getByPlaceholderText('username'), 'somchai')
    await userEvent.type(screen.getByPlaceholderText('อย่างน้อย 8 ตัวอักษร'), 'short')
    // ข้ามการตรวจของเบราว์เซอร์ (minLength) เพื่อทดสอบการตรวจในโค้ด
    document.querySelector('form').noValidate = true
    await userEvent.click(screen.getByRole('button', { name: 'สมัครสมาชิก' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('อย่างน้อย 8')
    expect(fn).not.toHaveBeenCalled()
  })
})
