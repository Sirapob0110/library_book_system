# Library Book System

ระบบจัดการห้องสมุด: ค้นหาและจัดการหนังสือ ผู้แต่ง หมวดหมู่ จัดการสมาชิก และบริการยืม-คืนหนังสือ พร้อมระบบเข้าสู่ระบบด้วย JWT และแยกสิทธิ์ผู้ดูแลระบบ (admin) กับสมาชิก (user) พัฒนาเป็นโครงงานรายวิชาพัฒนาเว็บแบ็กเอนด์ (ระยะที่ 1–3)

## สถาปัตยกรรม

```
Frontend (React + Vite)  :5173
          │
          ▼
API Gateway :8000   (ตรวจ JWT, ส่งต่อ, timeout 3 วินาที, log กลาง, 503 เมื่อบริการล่ม)
   │            │
   ▼            ▼
Book API :3000      Circulation Service :3001
(หนังสือ ผู้แต่ง หมวดหมู่,     (สมาชิก ยืม คืน รายการเกินกำหนด)
 สมัคร/เข้าสู่ระบบ, GraphQL,
 ข้อมูลเพิ่มเติมจาก Open Library)
   │            │            │
   │            └─── Redis (ไม่บังคับ: cache ที่ใช้ร่วมกัน)
   └─────┬──────┘
         ▼
 MySQL / MariaDB  (ฐานข้อมูล book_system ชุดเดียว)
```

ทุกบริการยังเรียกตรงได้ (Book API :3000, Circulation :3001) หน้าเว็บเรียกผ่าน Gateway

| ส่วน | โฟลเดอร์ | พอร์ต |
|---|---|---|
| Book API | `src/index.js` | 3000 |
| Circulation Service | `src/circulation/index.js` | 3001 |
| API Gateway | `src/gateway/index.js` | 8000 |
| GraphQL (Lab 2) | `src/graphql/` (เส้นทาง `POST /graphql` ของ Book API) | — |
| Cache (Redis หรือหน่วยความจำ) | `src/cache.js` | — |
| Rate limit, ตรวจข้อมูล (zod), error handler, pagination | `src/middlewares/`, `src/schemas/` | — |
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

**ฐานข้อมูลเดิมที่ใช้งานอยู่แล้ว (ไม่อยากลบข้อมูล):** รัน migration แทนการโหลด `schema.sql` ใหม่ ตามลำดับ

```bash
mysql -u root book_system < migrations/001-soft-delete.sql   # คอลัมน์ deleted_at (หนังสือ/สมาชิก)
mysql -u root book_system < migrations/002-auth-tokens.sql   # ตาราง refresh_tokens, password_resets
```

**ตั้งรหัสผ่าน admin เอง (แนะนำทันทีหลังโหลด `seed.sql`):** `seed.sql` สร้าง admin รหัสตัวอย่าง `Admin@1234` ให้ลองระบบได้ แต่ควรเปลี่ยนก่อนเปิดใช้งานจริง

```bash
npm run set-password -- admin                      # ถามรหัสผ่านใหม่ (ไม่แสดงบนจอ)
NEW_PASSWORD='รหัสใหม่ที่ยาวพอ' npm run set-password -- admin   # หรือส่งทางตัวแปร (ใช้ในสคริปต์)
```

รหัสผ่านต้องผ่านกฎเดียวกับตอนสมัคร (อย่างน้อย 8 ตัว) คำสั่งนี้เพิกถอนเซสชันเดิมของบัญชีนั้นด้วย

ข้อมูลตัวอย่างประกอบด้วยหนังสือ 6 เล่ม ผู้แต่ง 4 คน หมวดหมู่ 4 หมวด สมาชิก 2 คน และบัญชีผู้ใช้ 3 บัญชี (ดูหัวข้อ "บัญชีสำหรับทดลองใช้")

### 4. เริ่มระบบ

```bash
npm run start:all              # Book API :3000 + Circulation :3001 + Gateway :8000 ในคำสั่งเดียว
cd frontend && npm run dev     # Frontend        http://localhost:5173
```

หรือเปิดแยกเองทีละบริการ: `npm start` (Book API), `npm run start:circulation`, `npm run start:gateway`

ตั้ง `VITE_BOOK_API_URL` และ `VITE_CIRCULATION_API_URL` ใน `frontend/.env.local` เป็น `http://localhost:8000` เพื่อให้หน้าเว็บเรียกผ่าน Gateway (ค่าในไฟล์ตัวอย่าง)

**Redis (ไม่บังคับ):** ถ้ามี Redis ให้ตั้ง `REDIS_URL=redis://localhost:6379` ใน `.env` cache ของรายการหนังสือจะทำงานและใช้ร่วมกันทุกบริการ (ล้างอัตโนมัติเมื่อมีการยืม/คืน/แก้ข้อมูล) ถ้าไม่ตั้งหรือ Redis ล่ม ระบบยังทำงานได้ปกติโดยไม่ใช้ cache ที่ใช้ร่วมกัน

เปิดเว็บที่ http://localhost:5173 แล้วเข้าสู่ระบบ

### รันด้วย Docker (ทางเลือก ไม่ต้องติดตั้ง XAMPP)

```bash
docker compose up --build
```

เริ่ม MySQL (สร้างฐานข้อมูลจาก `schema.sql` + `seed.sql` ครั้งแรก), Redis, Book API, Circulation และ Gateway พร้อมกัน เข้าที่ http://localhost:8000 แล้วรันหน้าเว็บบนเครื่องด้วย `cd frontend && npm run dev` ตั้งรหัสผ่านฐานข้อมูลและ `JWT_SECRET` เองได้ด้วยตัวแปร `DB_PASSWORD` และ `JWT_SECRET` ก่อนรัน (ค่าเริ่มต้นใช้สำหรับพัฒนาเท่านั้น) ถ้าต้องการสร้างฐานข้อมูลใหม่ให้ `docker compose down -v` ก่อน

compose ตั้ง `NODE_ENV=development` เพื่อให้ใช้ค่าเริ่มต้นสำหรับพัฒนาได้ (image ตั้ง `production` ไว้ ซึ่งตัวตรวจความปลอดภัยจะไม่ยอมเริ่มระบบถ้า `JWT_SECRET` เป็นค่าตัวอย่างหรือ admin ยังใช้รหัส `Admin@1234`) ถ้าจะใช้จริงให้ตั้ง `NODE_ENV=production`, `JWT_SECRET` สุ่ม และเปลี่ยนรหัส admin ด้วย `npm run set-password`

> หมายเหตุ: ไฟล์ Docker เขียนและตรวจรูปแบบแล้ว แต่ผู้จัดทำยังไม่ได้ทดสอบรันจริงบนเครื่องที่มี Docker (ใน CI ก็เช่นกัน: เขียนไว้แต่ยังไม่เคยรันบน GitHub Actions)

**CI:** `.github/workflows/ci.yml` รัน `npm test`, ตรวจว่า `openapi.yaml` เหมือนสำเนาใน `src/circulation/`, และ lint + เทสต์ (`vitest`) + build ของ frontend ทุกครั้งที่ push

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

เรียก API ด้วย `curl` หรือ Postman: เรียก `POST /api/auth/login` เพื่อรับ token แล้วแนบ header `Authorization: Bearer <token>` (access token หมดอายุใน 15 นาที ต่ออายุด้วย `POST /api/auth/refresh` ซึ่งใช้ cookie `refresh_token` ที่เซิร์ฟเวอร์ตั้งให้ตอนล็อกอิน — ดูหัวข้อ "เซสชันและการลืมรหัสผ่าน")

## เซสชันและการลืมรหัสผ่าน

| เรื่อง | การทำงาน |
|---|---|
| Access token | JWT อายุ 15 นาที หน้าเว็บเก็บไว้ในตัวแปรหน่วยความจำเท่านั้น (ไม่ใช้ `sessionStorage`/`localStorage`) |
| Refresh token | ข้อความสุ่ม 256 บิต ส่งเป็น cookie `httpOnly`, `SameSite=Lax`, path `/api/auth`, อายุ 7 วัน (`Secure` เมื่อ `NODE_ENV=production` หรือ `COOKIE_SECURE=true`) ฐานข้อมูลเก็บเฉพาะค่า sha256 |
| หมุนเวียน | ใช้ refresh ครั้งหนึ่งได้ token ใหม่ ตัวเก่าใช้ไม่ได้อีก ถ้ามีการนำตัวเก่ามาใช้ซ้ำ (สัญญาณว่าถูกขโมย) ระบบเพิกถอนทั้งชุดเซสชัน ยกเว้นซ้ำภายใน 10 วินาที (หลายแท็บ) จะตอบ 409 `REFRESH_CONFLICT` ให้ลองใหม่ |
| ออกจากระบบ | `POST /api/auth/logout` เพิกถอนทั้งชุดและล้าง cookie |
| ป้องกัน CSRF | refresh/logout ตรวจ header `Origin` ต้องตรงกับ `FRONTEND_ORIGIN` และ cookie เป็น `SameSite=Lax` |
| ลืมรหัสผ่าน | `POST /api/auth/forgot-password` ตอบ 202 ข้อความเดียวกันเสมอ ลิงก์ใช้ได้ครั้งเดียว อายุ 30 นาที ตั้งรหัสใหม่ที่ `POST /api/auth/reset-password` แล้วทุกเซสชันของผู้ใช้ถูกเพิกถอน |

**ข้อจำกัดที่ควรรู้:** (1) โปรเจกต์นี้**ยังไม่ได้เชื่อมระบบอีเมล** ลิงก์รีเซ็ตรหัสผ่านจะถูกพิมพ์ใน log ของ Book API เป็น JSON (`"event":"password_reset_link"`) ผู้ดูแลเอาลิงก์ไปให้ผู้ใช้เอง ถ้าจะใช้จริงให้แก้ `src/services/mailer.js` (2) หลังเพิกถอนเซสชัน access token ที่ออกไปแล้วยังใช้ได้จนครบ 15 นาที (3) อีเมลของสมาชิกที่ถูกเก็บเข้าคลัง (soft delete) ยังถูกจองไว้ สมัครซ้ำด้วยอีเมลเดิมไม่ได้

**ตรวจความปลอดภัยตอนเริ่มระบบ:** ถ้า `NODE_ENV=production` แล้ว `JWT_SECRET` สั้น/เป็นค่าตัวอย่าง หรือ admin ยังใช้รหัส `Admin@1234` Book API จะไม่ยอมเริ่ม (ข้ามได้ด้วย `ALLOW_INSECURE_DEFAULTS=true` โดยรับความเสี่ยงเอง) โหมดอื่นแสดงเป็นคำเตือน

## กติกาการยืม ค่าปรับ และการลบข้อมูล

- ยืมค้างได้สูงสุด 5 เล่มต่อสมาชิก (`MAX_ACTIVE_LOANS`) เกินตอบ 409 `LOAN_LIMIT_REACHED` การตรวจล็อกแถวสมาชิกไว้ จึงไม่เกินโควตาแม้ยืมพร้อมกัน ทดสอบด้วย `npm run test:concurrency` (ต้องเปิดบริการและมี token; เสร็จแล้วอาจโดน rate limit 100 คำขอ/นาทีชั่วคราว)
- คืนช้าคิดค่าปรับวันละ 5 บาท (`FINE_PER_DAY`) แสดงที่ `days_overdue` และ `fine_amount` ในประวัติ รายการเกินกำหนด และตอนคืน (ยังไม่มีระบบชำระเงิน เป็นการคำนวณแสดงผลเท่านั้น)
- ลบหนังสือ/สมาชิก: ไม่เคยมีประวัติการยืมลบจริง, มีประวัติจะเก็บเข้าคลัง (`deleted_at`, ตอบ `archived: true`, ประวัติยังอยู่; สมาชิกที่เก็บเข้าคลังจะเข้าสู่ระบบไม่ได้), ยังมีรายการยืมค้างลบไม่ได้ (409)

## Request ID และ log

Gateway สร้าง `X-Request-Id` ให้ทุกคำขอ (ใช้ค่าที่ลูกค้าส่งมาได้ถ้ารูปแบบปลอดภัย) ส่งต่อให้ทั้งสองบริการ และคืนใน response log ของทุกบริการเป็น JSON บรรทัดละรายการ มีฟิลด์ `time`, `level`, `service`, `requestId`, `method`, `path`, `status`, `durationMs`, `userId` (ไม่บันทึก query string, header หรือ body) ใช้ค้นตามรอยคำขอเดียวข้ามบริการได้

## เอกสาร API

| บริการ | Swagger UI |
|---|---|
| Book API | http://localhost:3000/api-docs |
| Circulation Service | http://localhost:3001/api-docs |

### ความสามารถที่เพิ่มจากแล็บ

| แล็บ | สิ่งที่ทำในโปรเจกต์ | ดูได้ที่ |
|---|---|---|
| Lab 2 GraphQL | `POST /graphql` (query: books, book, authors, author, categories; mutation เฉพาะ admin) แก้ N+1 ด้วย loader, จำกัดความลึก 5 | `src/graphql/`, `rest-vs-graphql.md` |
| Lab 4 Security | helmet, CORS, morgan, จำกัดขนาด body 10KB (413), 404 และ error handler มาตรฐาน | `src/middlewares/errors.js` |
| Lab 7 Performance | แบ่งหน้า/เรียง/กรองรายการหนังสือ, cache (Redis หรือหน่วยความจำ) พร้อม `X-Cache` | `src/cache.js`, `src/middlewares/query-parser.js` |
| Lab 12 Validation | ตรวจ body ด้วย zod (`VALIDATION_ERROR` + `details`), rate limit | `src/schemas/`, `src/middlewares/rate-limiter.js` |
| Lab 13 Gateway | Gateway :8000 ตรวจ JWT ส่งต่อ timeout 3 วินาที 503 เมื่อบริการล่ม health รวม | `src/gateway/index.js` |
| Lab 14 Scalability | วิเคราะห์คอขวดและแผนขยายระบบ (เอกสาร) | `scalability-design.md` |

**Rate limit:** ทั้งระบบ 100 คำขอ/นาที/IP, login ที่ผิดได้ 5 ครั้ง/15 นาที/IP, สมัครสมาชิก 10 ครั้ง/15 นาที/IP เกินแล้วตอบ 429 (รีสตาร์ตบริการเพื่อล้างตัวนับตอนทดสอบด้วย Newman ซ้ำ)

**รายการหนังสือ:** `GET /api/books?q=&author_id=&category_id=&available=true&sort=title&order=desc&page=1&limit=10` (sort ได้: id, title, published_year, price, available_copies)

**ตัวอย่าง GraphQL:**

```bash
curl -s localhost:3000/graphql -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ books(limit: 3) { items { title author { name } categories { name } } pagination { total } } }"}'
```

สเปก OpenAPI อยู่ที่ `openapi.yaml` (ครอบคลุมทั้งสองบริการ รวมเส้นทาง `/api/auth/*`) ใน Swagger UI ให้เรียก `POST /api/auth/login` ก่อน แล้วกดปุ่ม **Authorize** วาง token ที่ได้ และมีชุด request ตัวอย่างใน `postman_collection.json` (Book API, รันโฟลเดอร์ `Auth` ก่อนเพื่อรับ token)

สำเนาของ `openapi.yaml` ที่ `src/circulation/openapi.yaml` ใช้แสดง Swagger ของ Circulation Service ต้องเหมือนไฟล์ที่ราก ถ้าแก้ไฟล์ราก ให้คัดลอกทับด้วย (`copy openapi.yaml src\circulation\openapi.yaml` บน Windows)

## การทดสอบ

```bash
npm test
```

รัน Jest พร้อมรายงาน coverage (382 tests, 14 ชุดทดสอบ) ใช้ฐานข้อมูลจำลอง ไม่ต้องเปิด MySQL และไม่อ่านไฟล์ `.env` ผลจึงเท่ากันทุกเครื่อง สรุปผลดู `coverage-report.md`

ทดสอบหน้าเว็บ (Vitest + Testing Library, 20 tests): `cd frontend && npm test`

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
| `JWT_EXPIRES_IN` | `15m` | อายุของ access token |
| `REFRESH_TOKEN_DAYS` | `7` | อายุของ refresh token (วัน) |
| `REFRESH_GRACE_SECONDS` | `10` | ช่วงที่ใช้ refresh token ซ้ำแล้วตอบ 409 แทนการเพิกถอนทั้งชุด |
| `RESET_TOKEN_MINUTES` | `30` | อายุของลิงก์ตั้งรหัสผ่านใหม่ |
| `RESET_DELIVERY` | (ว่าง) | `console` = พิมพ์ลิงก์รีเซ็ตลง log แม้ใน production (ยังไม่มีช่องทางอีเมล) |
| `COOKIE_SECURE` | (ว่าง) | `true` = ใส่ `Secure` ให้ cookie (เปิดอัตโนมัติเมื่อ `NODE_ENV=production`) |
| `ALLOW_INSECURE_DEFAULTS` | (ว่าง) | `true` = ข้ามการบล็อกของตัวตรวจความปลอดภัยใน production |
| `MAX_ACTIVE_LOANS`, `FINE_PER_DAY` | `5`, `5` | จำนวนเล่มที่ยืมค้างได้ และค่าปรับต่อวัน (บาท) |
| `RESET_RATE_LIMIT_MAX` | `5` | โควตาลืม/ตั้งรหัสผ่านใหม่ ต่อ 15 นาที ต่อ IP |
| `GATEWAY_PORT` | `8000` | พอร์ตของ API Gateway |
| `BOOK_SERVICE_URL`, `CIRCULATION_SERVICE_URL` | `http://localhost:3000`, `http://localhost:3001` | ปลายทางที่ Gateway ส่งต่อ |
| `GATEWAY_TIMEOUT_MS` | `3000` | เวลารอบริการปลายทางก่อนตอบ 503 |
| `REDIS_URL` | (ไม่ตั้ง) | ถ้าตั้ง จะใช้ Redis เป็น cache ที่ใช้ร่วมกัน |
| `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, `REGISTER_RATE_LIMIT_MAX` | `100`, `5`, `10` | โควตา rate limit (ทั่วไป/นาที, login ผิด/15 นาที, สมัคร/15 นาที) |
| `EXTERNAL_API_BASE_URL` | `https://openlibrary.org` | URL ของ API ภายนอก |
| `EXTERNAL_API_TIMEOUT_MS` | `3000` | เวลารอสูงสุดต่อครั้ง |
| `EXTERNAL_API_RETRIES` | `2` | จำนวนครั้งที่ลองซ้ำ (รวมครั้งแรกเป็น 3) |
| `EXTERNAL_API_BACKOFF_MS` | `300` | เวลารอก่อนลองซ้ำ (เพิ่มเป็นเท่าตัวทุกครั้ง) |

ตัวแปรของ Frontend (`frontend/.env.local`): `VITE_BOOK_API_URL` และ `VITE_CIRCULATION_API_URL` (ตั้งเป็นที่อยู่ Gateway `http://localhost:8000` ทั้งคู่)

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุและวิธีแก้ |
|---|---|
| `Can't connect to MySQL server ... (10061)` | MySQL ยังไม่เปิด เปิด XAMPP แล้วกด Start ที่ MySQL |
| `'mysql' is not recognized` | ไม่ได้ตั้ง PATH ใช้ path เต็ม `C:\xampp\mysql\bin\mysql.exe` |
| API ตอบ 500 `Unknown column ... total_copies` หรือ `Table ... doesn't exist` (เช่น `users`) | ฐานข้อมูลเป็นเวอร์ชันเก่า รัน `schema.sql` และ `seed.sql` ใหม่ |
| เข้าสู่ระบบไม่ได้ทั้งที่รหัสผ่านถูก | ยังไม่ได้โหลด `seed.sql` ใหม่ (ตาราง `users` ว่าง) หรือ API ตอบ 500 ให้ดู log ของ Book API |
| API ตอบ 401 ทุกคำขอจากหน้าเว็บหรือ Postman | ไม่ได้แนบ token หมดอายุ หรือสองบริการใช้ `JWT_SECRET` ไม่ตรงกัน (ถ้าแก้ `.env` ต้องเริ่มทั้งสองบริการใหม่ และเข้าสู่ระบบใหม่) |
| API ตอบ 429 | เกินโควตา rate limit (เช่น login ผิดเกิน 5 ครั้ง) รอ 15 นาที หรือรีสตาร์ตบริการ |
| Gateway ตอบ 503 `SERVICE_UNAVAILABLE` | บริการปลายทาง (Book API หรือ Circulation) ไม่ทำงาน ให้เปิดด้วย `npm run start:all` |
| API ตอบ 403 | เข้าสู่ระบบแล้วแต่บทบาท user ไม่มีสิทธิ์ทำรายการนั้น ให้ใช้บัญชี admin |
| หน้าเว็บขาวโล่ง | ยังไม่มี `frontend/.env.local` ให้คัดลอกจาก `frontend/.env.example` แล้วเริ่ม `npm run dev` ใหม่ |
| หน้าเว็บขึ้นว่าเชื่อมต่อ API ไม่ได้ | ตรวจว่ารัน Book API และ Circulation Service ครบทั้งสองตัว และ Vite ใช้พอร์ต 5173 (Book API อนุญาต CORS เฉพาะ `http://localhost:5173` ถ้า Vite เปลี่ยนไปใช้พอร์ตอื่น ให้ปิดโปรแกรมที่ใช้พอร์ต 5173 อยู่แล้วเริ่มใหม่) |
| ภาษาไทยใน cmd เป็นอักษรแปลก | หน้าต่าง cmd แสดงผลผิด ข้อมูลในฐานข้อมูลถูกต้อง พิมพ์ `chcp 65001` ก่อนรันคำสั่ง หรือดูผ่านเบราว์เซอร์ |
| `external-info` ได้ `"source": "fallback"` | เรียก Open Library ไม่สำเร็จ (ไม่มีอินเทอร์เน็ตหรือบริการล่ม) ระบบตอบข้อมูลในฐานข้อมูลแทน ดูสาเหตุที่ `fallback_reason` |

## โครงสร้างโปรเจกต์

```
├── src/
│   ├── index.js                 Book API (+ /api/auth/*, /graphql)
│   ├── gateway/                 API Gateway
│   ├── graphql/                 สคีมาและ resolver ของ GraphQL
│   ├── cache.js                 cache (Redis / หน่วยความจำ)
│   ├── middlewares/             rate limit, error handler, pagination
│   ├── schemas/                 สคีมา zod ตรวจข้อมูลเข้า
│   ├── services/catalog.js      ชั้นข้อมูลหนังสือ (ใช้ร่วม REST และ GraphQL)
│   ├── services/circulation.js  กติกายืม-คืน ค่าปรับ soft delete (ชั้น service ของ Circulation)
│   ├── services/tokens.js       refresh token / reset token
│   ├── auth.js                  JWT: ออก token, ตรวจ token, ตรวจบทบาท
│   ├── auth-routes.js           register/login/refresh/logout/forgot/reset/me
│   ├── security-check.js        ตรวจค่าที่ไม่ปลอดภัยตอนเริ่มระบบ
│   ├── db.js                    connection pool
│   ├── circulation/             Circulation Service (+ circulation.test.js, openapi.yaml)
│   └── services/external-api.js เรียก Open Library
├── tests/                       ชุดทดสอบ Book API, auth, external-api (+ helpers/, setup.js)
├── migrations/                  SQL ปรับฐานข้อมูลเดิม (001 soft delete, 002 ตาราง token)
├── scripts/                     set-password.js, concurrency-test.js
├── frontend/                    React + Vite (App, Login, Dashboard, components/*Tab, api.js, test/)
├── Dockerfile, docker-compose.yml  รันทั้งระบบด้วย Docker
├── .github/workflows/ci.yml     CI (ทดสอบ, lint, build)
├── schema.sql, seed.sql         ฐานข้อมูลและข้อมูลตัวอย่าง
├── openapi.yaml                 เอกสาร API
├── postman_collection.json      ชุด request ตัวอย่าง
├── coverage-report.md           รายงานผลทดสอบและ coverage
├── clo-requirements-checklist.md
├── failure-scenario-results.md  ผลทดสอบ retry / timeout / fallback
├── auth-test-results.md         ผลทดสอบ login และสิทธิ์ของ admin / user (ฐานข้อมูลจริง)
├── microservices-design.md      การออกแบบสถาปัตยกรรม
├── scalability-design.md        วิเคราะห์การขยายระบบ (Lab 14)
├── rest-vs-graphql.md           เปรียบเทียบ REST กับ GraphQL (Lab 2)
└── requirement.md, erd.png      ข้อกำหนดและแผนภาพ ER
```
