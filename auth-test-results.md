# ผลทดสอบระบบยืนยันตัวตนและสิทธิ์ (JWT, admin / user)

เอกสารนี้บันทึกการทดสอบ **กับฐานข้อมูลจริง** (MariaDB 10.11 สร้างจาก `schema.sql` และ `seed.sql`) โดยรัน Book API (พอร์ต 3000) และ Circulation Service (พอร์ต 3001) จริง แล้วเรียกด้วย `curl` ด้วย token ของ `admin`, `somchai` (user, สมาชิก #1), `somying` (user, สมาชิก #2) และกรณีไม่แนบ token

ส่วนชุดทดสอบอัตโนมัติ (Jest) อยู่ใน `tests/auth.test.js` (55 tests) และ `src/circulation/circulation-auth.test.js` (24 tests) ดู `coverage-report.md`

## กติกาสิทธิ์

| เส้นทาง | ไม่ได้เข้าสู่ระบบ | user | admin |
|---|---|---|---|
| `POST /api/auth/register`, `POST /api/auth/login`, `GET /health` | ได้ | ได้ | ได้ |
| `GET /api/auth/me` | 401 | ได้ | ได้ |
| `GET` หนังสือ / ผู้แต่ง / หมวดหมู่ / external-info | 401 | ได้ | ได้ |
| `POST/PUT/DELETE` หนังสือ, `POST` ผู้แต่ง / หมวดหมู่ | 401 | 403 | ได้ |
| จัดการสมาชิก (`GET/POST/PUT/DELETE /api/members`), `GET /api/loans/overdue` | 401 | 403 | ได้ |
| `GET /api/members/{id}/loans` | 401 | เฉพาะของตัวเอง (ของคนอื่น 403) | ได้ทุกคน |
| `POST /api/loans` | 401 | เฉพาะในนามตัวเอง (ไม่ส่ง `member_id` จะใช้ของตัวเอง, ส่งของคนอื่น 403) | ได้ทุกคน |
| `PUT /api/loans/{id}/return` | 401 | เฉพาะรายการยืมของตัวเอง (ของคนอื่น 403) | ได้ทุกรายการ |

## ผลการทดสอบ

### Auth (Book API)

| กรณีทดสอบ | คาดว่าได้ | ได้จริง | ผล |
|---|---:|---:|---|
| เข้าสู่ระบบด้วยรหัสผ่านผิด | 401 | 401 | ผ่าน |
| เข้าสู่ระบบด้วย username ที่ไม่มีอยู่ | 401 | 401 | ผ่าน |
| เข้าสู่ระบบโดยไม่ส่งข้อมูลครบ | 400 | 400 | ผ่าน |
| สมัครสมาชิกสำเร็จ | 201 | 201 | ผ่าน |
| สมัครด้วย username ซ้ำ | 409 | 409 | ผ่าน |
| สมัครด้วยอีเมลซ้ำ | 409 | 409 | ผ่าน |
| สมัครด้วยรหัสผ่านสั้นและ username สั้น | 400 | 400 | ผ่าน |
| สมัครโดยส่ง role: admin มาด้วย (ต้องได้ user) | 201 | 201 | ผ่าน |
| GET /api/auth/me พร้อม token | 200 | 200 | ผ่าน |
| GET /api/auth/me ไม่แนบ token | 401 | 401 | ผ่าน |
| GET /api/auth/me ด้วย token ปลอม | 401 | 401 | ผ่าน |

### Book API

| กรณีทดสอบ | คาดว่าได้ | ได้จริง | ผล |
|---|---:|---:|---|
| GET /api/books ไม่แนบ token | 401 | 401 | ผ่าน |
| GET /api/books ด้วย user | 200 | 200 | ผ่าน |
| GET /api/books ด้วย admin | 200 | 200 | ผ่าน |
| GET /api/books/1/external-info ด้วย user | 200 | 200 | ผ่าน |
| POST /api/books ด้วย user | 403 | 403 | ผ่าน |
| POST /api/books ด้วย admin | 201 | 201 | ผ่าน |
| PUT /api/books/1 ด้วย user | 403 | 403 | ผ่าน |
| DELETE /api/books/6 ด้วย user | 403 | 403 | ผ่าน |
| POST /api/authors ด้วย user | 403 | 403 | ผ่าน |
| POST /api/authors ด้วย admin | 201 | 201 | ผ่าน |
| POST /api/categories ด้วย user | 403 | 403 | ผ่าน |
| GET /api/authors ด้วย user | 200 | 200 | ผ่าน |
| GET /api/categories ด้วย user | 200 | 200 | ผ่าน |

### Circulation Service

| กรณีทดสอบ | คาดว่าได้ | ได้จริง | ผล |
|---|---:|---:|---|
| GET /api/members ไม่แนบ token | 401 | 401 | ผ่าน |
| GET /api/members ด้วย user | 403 | 403 | ผ่าน |
| GET /api/members ด้วย admin | 200 | 200 | ผ่าน |
| POST /api/members ด้วย user | 403 | 403 | ผ่าน |
| PUT /api/members/1 ด้วย user | 403 | 403 | ผ่าน |
| DELETE /api/members/2 ด้วย user | 403 | 403 | ผ่าน |
| GET /api/loans/overdue ด้วย user | 403 | 403 | ผ่าน |
| GET /api/loans/overdue ด้วย admin | 200 | 200 | ผ่าน |
| user ดูประวัติของตัวเอง (สมาชิก #1) | 200 | 200 | ผ่าน |
| user ดูประวัติของสมาชิก #2 (ของคนอื่น) | 403 | 403 | ผ่าน |
| admin ดูประวัติของสมาชิก #2 | 200 | 200 | ผ่าน |
| user ยืมโดยไม่ส่ง member_id (ใช้ของตัวเอง) | 201 | 201 | ผ่าน |
| user ยืมในนามสมาชิก #2 | 403 | 403 | ผ่าน |
| user ยืมโดยส่ง member_id ของตัวเอง | 201 | 201 | ผ่าน |
| user อีกคนคืนรายการยืมที่ไม่ใช่ของตัวเอง | 403 | 403 | ผ่าน |
| เจ้าของรายการยืมคืนหนังสือ | 200 | 200 | ผ่าน |
| คืนซ้ำรายการเดิม | 409 | 409 | ผ่าน |
| admin ยืมในนามสมาชิก #2 | 201 | 201 | ผ่าน |

**สรุป:** 42 จาก 42 กรณีผ่าน

## ข้อสังเกตจากการทดสอบ

- สมัครสมาชิกโดยส่ง `"role": "admin"` มาด้วย บัญชีที่ได้ยังเป็นบทบาท `user` (ตรวจในตาราง `users`)
- หลังผู้ใช้ยืมและคืนหนังสือ จำนวน `available_copies` ถูกปรับถูกต้อง และการยืมที่ถูกปฏิเสธ (403) ไม่เปลี่ยนจำนวนเล่ม
- รหัสผ่านเก็บเป็น bcrypt hash (cost 10) ไม่มีรหัสผ่านหรือ hash ในผลลัพธ์ของ API และใน JWT

## วิธีทดสอบซ้ำ

```bash
# เริ่มบริการทั้งสอง (ต้องตั้ง JWT_SECRET เหมือนกันทั้งสอง) แล้วโหลด schema.sql และ seed.sql
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"somchai","password":"User@1234"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")

curl -i localhost:3000/api/books                                    # 401 (ไม่แนบ token)
curl -i localhost:3000/api/books -H "Authorization: Bearer $TOKEN"  # 200
curl -i localhost:3001/api/members -H "Authorization: Bearer $TOKEN" # 403 (user ดูรายชื่อสมาชิกไม่ได้)
```
