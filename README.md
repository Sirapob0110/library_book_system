# Library Book System

ระบบจัดการห้องสมุด: ค้นหาและจัดการหนังสือ ผู้แต่ง หมวดหมู่ จัดการสมาชิก และบริการยืม-คืนหนังสือ พร้อมระบบเข้าสู่ระบบด้วย JWT และแยกสิทธิ์ผู้ดูแลระบบ (admin) กับสมาชิก (user) พัฒนาเป็นโครงงานรายวิชาพัฒนาเว็บแบ็กเอนด์ (ระยะที่ 1–3)

## สถาปัตยกรรม

```
Frontend (React + Vite)  :5173
   │            │
   ▼            ▼
Book API :3000      Circulation Service :3001
(หนังสือ ผู้แต่ง หมวดหมู่,     (สมาชิก ยืม คืน รายการเกินกำหนด)
 สมัคร/เข้าสู่ระบบ,
 ข้อมูลเพิ่มเติมจาก Open Library)
   │            │
   └─────┬──────┘
         ▼
 MySQL / MariaDB  (ฐานข้อมูล book_system ชุดเดียว)
```

| ส่วน | โฟลเดอร์ | พอร์ต |
|---|---|---|
| Book API | `src/index.js` | 3000 |
| Circulation Service | `src/circulation/index.js` | 3001 |
| ระบบยืนยันตัวตนและตรวจสิทธิ์ (JWT) ใช้ร่วมกันทั้งสองบริการ | `src/auth.js` | — |
| โมดูลเรียก Open Library (timeout, retry, fallback) | `src/services/external-api.js` | — |
| Frontend | `frontend/` | 5173 |

ทั้งสองบริการใช้ฐานข้อมูลเดียวกัน เพราะการยืมต้องปรับ `books.available_copies` และเพิ่มรายการใน `loans` ใน transaction เดียวกัน รายละเอียดการออกแบบดู `microservices-design.md`

## สิ่งที่ต้องมี

- Node.js 18 ขึ้นไป
- MySQL หรือ MariaDB (ใช้ XAMPP ได้)

## วิธีติดตั้งและรัน

### 1. ติดตั้ง

```bash
git clone https://github.com/Sirapob0110/library_book_system
cd library_book_system
npm install
cd frontend && npm install && cd ..
```

### 2. ตั้งค่า

คัดลอกไฟล์ตัวอย่างเป็นไฟล์ตั้งค่าจริง

```bash
# macOS / Linux
cp .env.example .env
cp frontend/.env.example frontend/.env.local

# Windows (cmd)
copy .env.example .env
copy frontend\.env.example frontend\.env.local
```

แก้ `DB_USER` และ `DB_PASSWORD` ใน `.env` ให้ตรงกับฐานข้อมูลของคุณ (XAMPP ปกติ user คือ `root` และรหัสผ่านว่าง) และเปลี่ยน `JWT_SECRET` เป็นข้อความสุ่มของคุณเอง ทั้งสองบริการอ่านจากไฟล์ `.env` ไฟล์เดียวกัน จึงใช้ความลับเดียวกันโดยอัตโนมัติ

### 3. สร้างฐานข้อมูล

เปิด MySQL (ใน XAMPP กด Start ที่ MySQL) แล้วรัน

```bash
mysql -u root --default-character-set=utf8mb4 < schema.sql
mysql -u root --default-character-set=utf8mb4 < seed.sql
```

บน Windows ที่ใช้ XAMPP แทน `mysql` ด้วย `C:\xampp\mysql\bin\mysql.exe`

> **คำเตือน:** `schema.sql` ลบฐานข้อมูล `book_system` เดิมทิ้งแล้วสร้างใหม่ ข้อมูลที่มีอยู่จะหายหมด

ข้อมูลตัวอย่างประกอบด้วยหนังสือ 6 เล่ม ผู้แต่ง 4 คน หมวดหมู่ 4 หมวด สมาชิก 2 คน และบัญชีผู้ใช้ 3 บัญชี (ดูหัวข้อ "บัญชีสำหรับทดลองใช้")

### 4. เริ่มระบบ (เปิด 3 หน้าต่าง terminal)

```bash
npm start                      # Book API        http://localhost:3000
npm run start:circulation      # Circulation     http://localhost:3001
cd frontend && npm run dev     # Frontend        http://localhost:5173
```

เปิดเว็บที่ http://localhost:5173 แล้วเข้าสู่ระบบ

## บัญชีสำหรับทดลองใช้ และสิทธิ์ของแต่ละบทบาท

| ชื่อผู้ใช้ | รหัสผ่าน | บทบาท |
|---|---|---|
| `admin` | `Admin@1234` | admin (ผู้ดูแลระบบ) |
| `somchai` | `User@1234` | user (สมาชิก #1) |
| `somying` | `User@1234` | user (สมาชิก #2) |

บัญชีเหล่านี้สร้างจาก `seed.sql` สำหรับสาธิตเท่านั้น ควรเปลี่ยนรหัสผ่านก่อนใช้งานจริง ผู้ที่สมัครเองผ่านหน้าเว็บจะได้บทบาท user เสมอ (สร้างสมาชิกห้องสมุดของตัวเองให้ด้วย) ส่วนบัญชี admin สร้างจากฐานข้อมูลเท่านั้น

| ความสามารถ | ไม่ได้เข้าสู่ระบบ | user | admin |
|---|---|---|---|
| ดูหนังสือ ผู้แต่ง หมวดหมู่ และข้อมูลจาก Open Library | ไม่ได้ (401) | ได้ | ได้ |
| เพิ่ม/แก้ไข/ลบหนังสือ ผู้แต่ง หมวดหมู่ | ไม่ได้ (401) | ไม่ได้ (403) | ได้ |
| จัดการสมาชิก และดูรายการยืมเกินกำหนด | ไม่ได้ (401) | ไม่ได้ (403) | ได้ |
| ยืมหนังสือ | ไม่ได้ (401) | ได้ เฉพาะในนามตัวเอง | ได้ทุกคน |
| คืนหนังสือ และดูประวัติการยืม | ไม่ได้ (401) | ได้ เฉพาะของตัวเอง | ได้ทุกคน |

ฝั่งหน้าเว็บ admin จะเห็นแท็บ "จัดการหนังสือ" (เพิ่ม/แก้ไข/ลบหนังสือ เพิ่มผู้แต่งและหมวดหมู่), แท็บ "สมาชิก" และปุ่มตรวจรายการยืมเกินกำหนดในหน้าประวัติ ส่วน user จะไม่เห็นแท็บเหล่านี้และไม่มีตัวเลือกสมาชิกในฟอร์มยืม แต่สิทธิ์ถูกบังคับที่ฝั่ง API เสมอ (ไม่เชื่อหน้าเว็บ) รายละเอียดและผลทดสอบดู `auth-test-results.md`

เรียก API ด้วย `curl` หรือ Postman: เรียก `POST /api/auth/login` เพื่อรับ token แล้วแนบ header `Authorization: Bearer <token>` (token หมดอายุใน 2 ชั่วโมง)

## เอกสาร API

| บริการ | Swagger UI |
|---|---|
| Book API | http://localhost:3000/api-docs |
| Circulation Service | http://localhost:3001/api-docs |

สเปก OpenAPI อยู่ที่ `openapi.yaml` (ครอบคลุมทั้งสองบริการ รวมเส้นทาง `/api/auth/*`) ใน Swagger UI ให้เรียก `POST /api/auth/login` ก่อน แล้วกดปุ่ม **Authorize** วาง token ที่ได้ และมีชุด request ตัวอย่างใน `postman_collection.json` (Book API, รันโฟลเดอร์ `Auth` ก่อนเพื่อรับ token)

สำเนาของ `openapi.yaml` ที่ `src/circulation/openapi.yaml` ใช้แสดง Swagger ของ Circulation Service ต้องเหมือนไฟล์ที่ราก ถ้าแก้ไฟล์ราก ให้คัดลอกทับด้วย (`copy openapi.yaml src\circulation\openapi.yaml` บน Windows)

## การทดสอบ

```bash
npm test
```

รัน Jest พร้อมรายงาน coverage (166 tests, 5 ชุดทดสอบ) ใช้ฐานข้อมูลจำลอง ไม่ต้องเปิด MySQL และไม่อ่านไฟล์ `.env` ผลจึงเท่ากันทุกเครื่อง สรุปผลดู `coverage-report.md`

## ตัวแปรสภาพแวดล้อม (`.env`)

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `DB_HOST`, `DB_PORT` | `localhost`, `3306` | ที่อยู่ฐานข้อมูล |
| `DB_USER`, `DB_PASSWORD` | `root`, (ว่าง) | บัญชีฐานข้อมูล |
| `DB_NAME` | `book_system` | ชื่อฐานข้อมูล |
| `PORT` | `3000` | พอร์ตของ Book API |
| `CIRCULATION_PORT` | `3001` | พอร์ตของ Circulation Service |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | ที่อยู่ของหน้าเว็บ ใช้กำหนด CORS ของทั้งสองบริการ |
| `JWT_SECRET` | ค่าสำหรับพัฒนา (มีคำเตือน) | ความลับสำหรับเซ็นและตรวจ JWT ต้องตั้งเป็นข้อความสุ่มของตัวเอง |
| `JWT_EXPIRES_IN` | `2h` | อายุของ token |
| `EXTERNAL_API_BASE_URL` | `https://openlibrary.org` | URL ของ API ภายนอก |
| `EXTERNAL_API_TIMEOUT_MS` | `3000` | เวลารอสูงสุดต่อครั้ง |
| `EXTERNAL_API_RETRIES` | `2` | จำนวนครั้งที่ลองซ้ำ (รวมครั้งแรกเป็น 3) |
| `EXTERNAL_API_BACKOFF_MS` | `300` | เวลารอก่อนลองซ้ำ (เพิ่มเป็นเท่าตัวทุกครั้ง) |

ตัวแปรของ Frontend (`frontend/.env.local`): `VITE_BOOK_API_URL` และ `VITE_CIRCULATION_API_URL`

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุและวิธีแก้ |
|---|---|
| `Can't connect to MySQL server ... (10061)` | MySQL ยังไม่เปิด เปิด XAMPP แล้วกด Start ที่ MySQL |
| `'mysql' is not recognized` | ไม่ได้ตั้ง PATH ใช้ path เต็ม `C:\xampp\mysql\bin\mysql.exe` |
| API ตอบ 500 `Unknown column ... total_copies` หรือ `Table ... doesn't exist` (เช่น `users`) | ฐานข้อมูลเป็นเวอร์ชันเก่า รัน `schema.sql` และ `seed.sql` ใหม่ |
| เข้าสู่ระบบไม่ได้ทั้งที่รหัสผ่านถูก | ยังไม่ได้โหลด `seed.sql` ใหม่ (ตาราง `users` ว่าง) หรือ API ตอบ 500 ให้ดู log ของ Book API |
| API ตอบ 401 ทุกคำขอจากหน้าเว็บหรือ Postman | ไม่ได้แนบ token หมดอายุ หรือสองบริการใช้ `JWT_SECRET` ไม่ตรงกัน (ถ้าแก้ `.env` ต้องเริ่มทั้งสองบริการใหม่ และเข้าสู่ระบบใหม่) |
| API ตอบ 403 | เข้าสู่ระบบแล้วแต่บทบาท user ไม่มีสิทธิ์ทำรายการนั้น ให้ใช้บัญชี admin |
| หน้าเว็บขาวโล่ง | ยังไม่มี `frontend/.env.local` ให้คัดลอกจาก `frontend/.env.example` แล้วเริ่ม `npm run dev` ใหม่ |
| หน้าเว็บขึ้นว่าเชื่อมต่อ API ไม่ได้ | ตรวจว่ารัน Book API และ Circulation Service ครบทั้งสองตัว และ Vite ใช้พอร์ต 5173 (Book API อนุญาต CORS เฉพาะ `http://localhost:5173` ถ้า Vite เปลี่ยนไปใช้พอร์ตอื่น ให้ปิดโปรแกรมที่ใช้พอร์ต 5173 อยู่แล้วเริ่มใหม่) |
| ภาษาไทยใน cmd เป็นอักษรแปลก | หน้าต่าง cmd แสดงผลผิด ข้อมูลในฐานข้อมูลถูกต้อง พิมพ์ `chcp 65001` ก่อนรันคำสั่ง หรือดูผ่านเบราว์เซอร์ |
| `external-info` ได้ `"source": "fallback"` | เรียก Open Library ไม่สำเร็จ (ไม่มีอินเทอร์เน็ตหรือบริการล่ม) ระบบตอบข้อมูลในฐานข้อมูลแทน ดูสาเหตุที่ `fallback_reason` |

## โครงสร้างโปรเจกต์

```
├── src/
│   ├── index.js                 Book API (+ /api/auth/*)
│   ├── auth.js                  JWT: ออก token, ตรวจ token, ตรวจบทบาท
│   ├── db.js                    connection pool
│   ├── circulation/             Circulation Service (+ circulation.test.js, openapi.yaml)
│   └── services/external-api.js เรียก Open Library
├── tests/                       ชุดทดสอบ Book API, auth, external-api (+ helpers/, setup.js)
├── frontend/                    React + Vite (App.jsx, Login.jsx, AdminCatalog.jsx)
├── schema.sql, seed.sql         ฐานข้อมูลและข้อมูลตัวอย่าง
├── openapi.yaml                 เอกสาร API
├── postman_collection.json      ชุด request ตัวอย่าง
├── coverage-report.md           รายงานผลทดสอบและ coverage
├── clo-requirements-checklist.md
├── failure-scenario-results.md  ผลทดสอบ retry / timeout / fallback
├── auth-test-results.md         ผลทดสอบ login และสิทธิ์ของ admin / user (ฐานข้อมูลจริง)
├── microservices-design.md      การออกแบบสถาปัตยกรรม
└── requirement.md, erd.png      ข้อกำหนดและแผนภาพ ER
```
