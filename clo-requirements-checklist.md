# CLO Requirements Checklist — โครงงานระยะที่ 3 (Library Book System)

## 1. วิธีอ่านเอกสาร

เอกสารนี้ตรวจว่าระบบครอบคลุมข้อกำหนดของ CLO8 (Final Integration), CLO6 (Client-Facing Frontend) และ CLO7 (Project Defense) พร้อมหลักฐานที่ตรวจสอบย้อนกลับได้ โดยระบุไฟล์ และชื่อเส้นทาง/ฟังก์ชันที่เกี่ยวข้อง (ไม่ใช้เลขบรรทัดเพราะโค้ดเปลี่ยนบ่อยหลังเพิ่มแล็บ ให้ค้นด้วยชื่อที่ระบุ)

ความหมายของสถานะ

| สัญลักษณ์ | ความหมาย |
|---|---|
| `[x]` | ตรวจแล้ว ระบุวิธีตรวจกำกับไว้ในตาราง |
| `[ ]` | ยังไม่ได้ตรวจ ต้องทดสอบด้วยตนเองก่อนติ๊ก |

วิธีตรวจที่ใช้ในเอกสารนี้

- **อ่านโค้ด** อ่านซอร์สและระบุบรรทัดที่เกี่ยวข้อง
- **รันทดสอบ** รัน `npm test` (Jest) หรือเรียก API จริงด้วย `curl` กับฐานข้อมูลที่สร้างใหม่จาก `schema.sql` และ `seed.sql`
- **ทดสอบมือ** ทดลองผ่านหน้าเว็บในเบราว์เซอร์

## 2. CLO8 — Final Integration (5 คะแนน)

### 2.1 ระบบรวมทำงานได้จริงโดยไม่มี conflict หรือ error หลงเหลือ

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| รวมโมดูลจาก Phase 1–2 และ Microservices เป็นระบบเดียว | Book API: `src/index.js` (`app.listen`, พอร์ต 3000) · Circulation Service: `src/circulation/index.js` (`app.listen`, พอร์ต 3001) · ตัวเรียก API ภายนอก: `src/services/external-api.js` · สคริปต์รัน: `package.json` (`start`, `start:circulation`) | `[x]` อ่านโค้ด |
| ไม่มี merge conflict หลงเหลือ | ค้นหา `<<<<<<<`, `=======`, `>>>>>>>` ในไฟล์ `.js .jsx .md .yaml .json .sql` ทั้ง repo (ไม่รวม `node_modules`, `coverage`) ไม่พบ | `[x]` รันค้นหา |
| ฐานข้อมูลสร้างจาก repo ได้ครบทุกตาราง | `schema.sql` (`total_copies`, `available_copies`) · `schema.sql` (`members`) · `schema.sql` (`loans`) · `seed.sql` | `[x]` สร้างฐานข้อมูลใหม่จากไฟล์ทั้งสองแล้วรันบริการทั้งสอง |
| Book API ทำงานได้ | routes: `src/index.js` (GET books) · (GET book) · (POST) · (PUT) · (DELETE) · (external-info) · (authors) · (categories) | `[x]` รันทดสอบ (`curl` + Jest) |
| Circulation Service ทำงานได้ | routes: `src/circulation/index.js` (health) · (members) · (ประวัติยืม) · (overdue) · (ยืม) · (คืน) | `[x]` รันทดสอบ (`curl` + Jest) |
| การยืมและคืนทำเป็น transaction และล็อกแถว | ยืม: `src/circulation/index.js` (begin) · (`FOR UPDATE`) · (commit) · rollback · คืน: (begin) · (`FOR UPDATE`) · (commit) | `[x]` อ่านโค้ด และรันทดสอบ: ยืมแล้วจำนวนเล่มลด, ยืมเกินจำนวนได้ 409, คืนซ้ำได้ 409 |
| จัดการวันที่ไม่ให้เลื่อนตามเขตเวลา | `src/db.js` (`dateStrings: ["DATE"]`) | `[x]` ทดสอบด้วย `TZ=Asia/Bangkok` ได้ `2026-10-10` ตรงกับที่กรอก |
| Book API และ Circulation Service ทำงานพร้อมกับ Frontend ได้ | ดูหัวข้อ 3 | `[ ]` ทดสอบมือตามขั้นตอนในหัวข้อ 5 |

### 2.2 เอกสาร API ตรงกับโค้ดจริง (Swagger/Code Match)

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| ทุก route ในโค้ดมีใน `openapi.yaml` | โค้ดมี 25 routes (Book API 16 รวม `/api/auth/*` 3 เส้นทาง, `/graphql` และ `/health` + Circulation 9 รวม `/health`) และ `openapi.yaml` v1.3.0 มี 24 operations (`/health` ของทั้งสองบริการและ Gateway ใช้ operation เดียวกัน) ตรงกันทุกรายการ path ใน spec: `openapi.yaml:43` (auth) · (`/api/books`) · (`/api/books/{id}`) · (external-info) · (authors) · (categories) · (`/health`) · (members) · (overdue) · (loans) · (return) | `[x]` เทียบ route จากโค้ดกับ path ใน spec ด้วยสคริปต์ |
| `openapi.yaml` ผ่านการตรวจรูปแบบ | ตรวจด้วย `swagger-cli validate` ผล: valid OpenAPI 3.0.3 (16 paths) และ `src/circulation/openapi.yaml` เหมือนไฟล์ที่รากทุกตัวอักษร | `[x]` รันตรวจ |
| ระบุการยืนยันตัวตนและสิทธิ์ในสเปก | `securitySchemes.bearerAuth` (JWT) ใช้เป็นค่าตั้งต้นทุกเส้นทาง ยกเว้น login / register / health · ทุกเส้นทางที่ป้องกันมีตัวอย่าง response 401 และเส้นทาง admin / เจ้าของข้อมูลมี 403 · ชื่อเส้นทางที่เฉพาะ admin ระบุ "(เฉพาะ admin)" | `[x]` อ่านสเปก และตรวจใน Swagger UI ได้ว่ามีปุ่ม Authorize |
| endpoint ของ Circulation ระบุพอร์ตที่ถูกต้อง | `openapi.yaml` กำหนด `servers: http://localhost:3001` ที่ระดับ path ของ members, loans และ health | `[x]` อ่านสเปก |
| Swagger UI เปิดได้ | Book API: `src/index.js` (`/api-docs`, พอร์ต 3000) · Circulation: `src/circulation/index.js` (`/api-docs`, พอร์ต 3001) | `[ ]` เปิด http://localhost:3000/api-docs และ http://localhost:3001/api-docs ดูในเบราว์เซอร์ |

ข้อควรระวัง: มีไฟล์ OpenAPI สองฉบับ (`openapi.yaml` ที่ root ใช้ส่งงาน และ `src/circulation/openapi.yaml` ที่ Circulation Service อ่านเอง) ปัจจุบันต่างกันเฉพาะ `operationId` และ `security` หากแก้ฉบับหนึ่งต้องแก้อีกฉบับให้ตรงกัน

### 2.3 รายงาน Test Coverage

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| มีชุดทดสอบครอบคลุมทั้งสองบริการ ระบบสิทธิ์ และโมดูลเรียก API ภายนอก | `tests/books.test.js` (40 tests) · `src/circulation/circulation.test.js` (29 tests) · `tests/external-api.test.js` (18 tests: retry, backoff, timeout, fallback) · `tests/auth.test.js` (55 tests: สมัคร, เข้าสู่ระบบ, token, สิทธิ์ Book API) · `src/circulation/circulation-auth.test.js` (24 tests: สิทธิ์ Circulation) | `[x]` รันทดสอบ |
| ผลทดสอบล่าสุด | Backend: Test Suites 14/14 ผ่าน · Tests 382/382 ผ่าน · Statements 96.79% · Branches 92.47% · Functions 95.47% · Lines 96.60% · Frontend (Vitest): 20/20 ผ่าน | `[x]` รันในสภาพแวดล้อมของผู้จัดทำเมื่อ 27 ต.ค. 2569 (ผลไม่ขึ้นกับ `.env` เพราะ `tests/setup.js`) · `[ ]` รัน `npm test` บนเครื่องของตนเองแล้วเทียบตัวเลขกับ `coverage-report.md` |
| ระบุจุดที่ยังไม่มี test | `coverage-report.md` หัวข้อ 6 (บรรทัดที่ไม่ครอบคลุม) และหัวข้อ 5.2 (ไฟล์ที่ไม่ถูกนับ: `db.js`) | `[x]` |
| รายงานสะท้อนสถานะจริง | ตัวเลข 92.87% นับเฉพาะไฟล์ที่ชุดทดสอบเรียกใช้ เมื่อนับทุกไฟล์ใน `src/` ได้ 92.07% (ต่างกันเพราะ `src/db.js` ไม่ถูกทดสอบ) | `[x]` ระบุไว้ใน `coverage-report.md` หัวข้อ 5.2 |

### 2.4 ข้อจำกัดที่ทราบ

1. ชุดทดสอบทั้งหมด mock ฐานข้อมูล จึงไม่ยืนยันพฤติกรรมกับฐานข้อมูลจริง ส่วนนี้ตรวจแยกด้วย `curl` กับฐานข้อมูลที่สร้างจาก `schema.sql`
2. `tests/external-api.test.js` จำลอง axios จึงยืนยันตรรกะ retry / timeout / fallback แต่ไม่ได้เรียก Open Library จริง การเรียกจริงและความล้มเหลวของเครือข่ายจริงทดสอบด้วยมือ บันทึกใน `failure-scenario-results.md` และผู้จัดทำตรวจแล้วว่าเทสต์ล้มเมื่อโค้ดถูกแก้ให้ผิด 5 แบบ (`coverage-report.md` หัวข้อ 4.1)
3. `microservices-design.md` เป็นการออกแบบเป้าหมาย (ฐานข้อมูลแยก 3 ชุด) ของที่ทำจริงคือ 2 บริการ + API Gateway ใช้ฐานข้อมูล `book_system` ร่วมกัน เหตุผล: การยืมต้องปรับ `books.available_copies` และเพิ่ม `loans` ใน transaction เดียวกัน (`src/services/circulation.js`)
4. `postman_collection.json` ครอบคลุม Book API, GraphQL, Gateway, เซสชัน (refresh/logout/ลืมรหัสผ่าน) และกติกาของ Circulation (ค่าปรับ, soft delete) ผ่าน Gateway ส่วนการยืมพร้อมกันตรวจด้วย `npm run test:concurrency`
5. Frontend มีเทสต์อัตโนมัติ 20 รายการ (Vitest) แต่ไม่ครอบคลุมทุกหน้าจอ และ `src/db.js` ไม่มี unit test · Dockerfile / docker-compose / GitHub Actions เขียนแล้วแต่**ยังไม่เคยรันจริง**
6. ระบบยืนยันตัวตน: access token 15 นาที + refresh token ใน cookie httpOnly (หมุนเวียน, ตรวจใช้ซ้ำ, เพิกถอนได้) แต่ access token ที่ออกไปแล้วยังใช้ได้จนหมดอายุแม้เพิกถอนเซสชัน · ลืมรหัสผ่านยังไม่มีการส่งอีเมล (ลิงก์ถูกพิมพ์ใน log ของเซิร์ฟเวอร์) · บัญชีตัวอย่างใน `seed.sql` ใช้รหัสสาธิต ต้องเปลี่ยนด้วย `npm run set-password`

### 2.5 ระบบยืนยันตัวตนและสิทธิ์ (JWT, admin / user)

เพิ่มตามคำแนะนำของอาจารย์ผู้สอน: ผู้ใช้ทุกคนต้องเข้าสู่ระบบ และแยกสิทธิ์ผู้ดูแลระบบ (admin) กับสมาชิก (user)

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| ตาราง `users` และบัญชีตัวอย่าง | `schema.sql` (ตาราง `users`: `username` ไม่ซ้ำ, `role` ENUM admin/user, `member_id` เชื่อมกับ `members`) · `seed.sql` (admin 1 บัญชี, user 2 บัญชี) | `[x]` สร้างฐานข้อมูลใหม่จากไฟล์ทั้งสองแล้วเข้าสู่ระบบได้ |
| เก็บรหัสผ่านเป็น hash | `src/index.js` (`bcrypt.hash` cost 10) · เปรียบเทียบด้วย `bcrypt.compare` ที่ · ไม่มีรหัสผ่านหรือ hash ในผลลัพธ์ API และใน token | `[x]` อ่านโค้ด และรันทดสอบ (`tests/auth.test.js`) |
| สมัครสมาชิก `POST /api/auth/register` | `src/auth-routes.js` · ตรวจ username / password / ชื่อ / อีเมล · สร้างสมาชิกและผู้ใช้ในธุรกรรมเดียว · ได้บทบาท user เสมอ (ไม่รับ `role` จากผู้สมัคร) | `[x]` รันทดสอบ: ส่ง `role: admin` มาแล้วได้ user |
| เข้าสู่ระบบ `POST /api/auth/login` | `src/index.js` · ข้อความ 401 เหมือนกันทั้งกรณีไม่พบผู้ใช้และรหัสผ่านผิด (`DUMMY_HASH` ทำให้เวลาใกล้เคียงกัน) | `[x]` รันทดสอบ |
| ออกและตรวจ JWT | `src/auth.js` (`signToken`, อายุ 15 นาที) · (`authenticate` ตรวจลายเซ็นและวันหมดอายุด้วย `jwt.verify`) · (`requireRole`) · ใช้ร่วมกันทั้งสองบริการ | `[x]` รันทดสอบ: token ปลอม, ไม่ใช่ JWT, หมดอายุ ได้ 401 |
| Book API: ต้องเข้าสู่ระบบ และเขียนข้อมูลได้เฉพาะ admin | อ่าน (`authenticate`): `src/index.js · เขียน (`adminOnly`): | `[x]` รันทดสอบ (Jest) และเรียกกับฐานข้อมูลจริง |
| Circulation: admin จัดการสมาชิกและรายการเกินกำหนด | `adminOnly` ที่ `src/circulation/index.js | `[x]` รันทดสอบ (Jest) และเรียกกับฐานข้อมูลจริง |
| Circulation: user ใช้ได้เฉพาะข้อมูลของตัวเอง | ดูประวัติ (ของคนอื่น 403) · ยืม (ใช้ `member_id` ของตัวเองเสมอ ส่งของคนอื่น 403) · คืน (รายการของคนอื่น 403) | `[x]` รันทดสอบ (Jest) และเรียกกับฐานข้อมูลจริง |
| ผลการทดสอบสิทธิ์กับฐานข้อมูลจริง | `auth-test-results.md` (42 กรณี ผ่านทั้งหมด) | `[x]` |
| ชุดทดสอบด้านสิทธิ์จับข้อผิดพลาดได้จริง | `coverage-report.md` หัวข้อ 4.2 (แก้โค้ดให้ผิด 6 แบบ ทุกแบบถูกจับได้) | `[x]` |
| CORS จำกัดเฉพาะหน้าเว็บ | `src/index.js` และ `src/circulation/index.js` (`FRONTEND_ORIGIN`) · `helmet` ทั้งสองบริการ (`src/index.js`, `src/circulation/index.js`) | `[x]` อ่านโค้ด |

### 2.6 ส่วนที่เพิ่มตามแล็บ (นำมารวมใน Phase 3)

| แล็บ | สิ่งที่ทำและหลักฐาน | สถานะ |
|---|---|---|
| Lab 2 GraphQL | `src/graphql/schema.js`, `src/graphql/index.js` · loader แก้ N+1 (10 เล่ม ใช้ 4 SQL) · mutation เฉพาะ admin · ลึกสุด 5 · ปกปิด error ภายใน · เทียบกับ REST ใน `rest-vs-graphql.md` | `[x]` รันทดสอบ: `tests/graphql.test.js` 38 รายการ + เรียกจริงกับฐานข้อมูลจริง (query, mutation, FORBIDDEN, ลึกเกิน, validation) + Newman |
| Lab 4 Security | helmet, CORS, morgan, body จำกัด 10KB (413), 404/error handler มาตรฐาน (`src/middlewares/errors.js`) | `[x]` รันทดสอบ: `tests/hardening.test.js`, `tests/errors.test.js` + 413 กับข้อความ 15,000 ตัวอักษรบนระบบจริง |
| Lab 7 Performance | แบ่งหน้า/เรียง/กรอง (`src/middlewares/query-parser.js`, `src/services/catalog.js`) · cache (`src/cache.js`) · `X-Cache` | `[x]` รันทดสอบ: Jest + Redis จริง: MISS→HIT, ล้างหลังยืมผ่าน Circulation, ล้างหลังเพิ่มหนังสือ, Redis ดับแล้วยังตอบ 200 · sort ที่ไม่ถูกต้องและ `page=abc` ไม่ทำให้ error |
| Lab 12 Validation | zod (`src/schemas/*`) ตอบ 400 `VALIDATION_ERROR` + `details` · rate limit (`src/middlewares/rate-limiter.js`) | `[x]` รันทดสอบ: Jest + ระบบจริง login ผิด 5 ครั้งแล้วได้ 429 พร้อม header `RateLimit` |
| Lab 13 Gateway | `src/gateway/index.js` · ตรวจ JWT, ส่งต่อ, timeout 3 วินาที, 503 เมื่อบริการล่ม, log กลาง, health รวม | `[x]` รันทดสอบ: `tests/gateway.test.js` 22 รายการ + ปิด Circulation จริงแล้วเรียกผ่าน Gateway ได้ 503 `SERVICE_UNAVAILABLE` (Book API ยังใช้ได้) ดู `failure-scenario-results.md` ข้อ 8 |
| Lab 14 Scalability | `scalability-design.md` (คอขวด, สถาปัตยกรรม load balancer, ตารางสิ่งที่ต้องแก้, แผนย้ายระบบ) | `[x]` อ่านเอกสาร · เป็นเอกสารออกแบบ ไม่ได้ทำ load test จริงหรือ Knex migration (เกณฑ์วิชาไม่นับ) |
| Postman | โฟลเดอร์ "Hardening, Cache, GraphQL, Gateway" ใน `postman_collection.json` | `[x]` รันทดสอบ: Newman 68 requests, 103 assertions ผ่านครบบนฐานข้อมูลใหม่ (รวมเซสชัน/ลืมรหัสผ่าน และค่าปรับ/soft delete) |
| ยกเลิกโดยตั้งใจ | การทำ versioning (`/api/v1`) ตัดออกตามที่ตัดสินใจ ไม่อยู่ในโปรเจกต์ | — |
| ยังไม่ได้ทำ | OWASP ZAP scan, rate limit แยกตามบทบาท, Knex migration (Lab 14), การส่งอีเมลจริงสำหรับลืมรหัสผ่าน, ระบบชำระค่าปรับ | `[ ]` ไม่ทำ |

### 2.7 ส่วนที่เพิ่มหลังจบแล็บ (ปรับปรุงเพิ่มเติม)

| หัวข้อ | สิ่งที่ทำและหลักฐาน | สถานะ |
|---|---|---|
| ตั้งรหัส admin เอง | `scripts/set-password.js` (`npm run set-password -- admin`) · ตัวตรวจความปลอดภัย `src/security-check.js` บล็อกการเริ่มระบบใน production ถ้า `JWT_SECRET` อ่อนหรือ admin ยังใช้ `Admin@1234` | `[x]` Jest `tests/security-check.test.js` 15 รายการ · `[x]` รันจริง: เปลี่ยนรหัส admin แล้วล็อกอินด้วยรหัสใหม่ได้, production + secret อ่อนไม่ยอมเริ่ม · `[ ]` ยังไม่ได้รันสคริปต์ผ่านหน้าจอ interactive (ถามรหัส) |
| Token ไม่อยู่ใน `sessionStorage` + refresh token | `src/auth-routes.js`, `src/services/tokens.js`, `migrations/002-auth-tokens.sql` · cookie httpOnly/SameSite=Lax · หมุนเวียน + ตรวจใช้ซ้ำ + ช่วงแข่งกัน 409 · logout · ตรวจ Origin (`src/middlewares/same-origin.js`) | `[x]` Jest `tests/auth-session.test.js` 33 รายการ · `[x]` ระบบจริง: login→refresh→logout, ใช้ token เก่าซ้ำ (409 แล้ว 401 และเพิกถอนทั้งชุด), Origin แปลกปลอม 403 · `[x]` Playwright บนเบราว์เซอร์จริง |
| ลืมรหัสผ่าน | `POST /api/auth/forgot-password` (ตอบเหมือนกันเสมอ) · `POST /api/auth/reset-password` (ใช้ครั้งเดียว หมดอายุ 30 นาที เพิกถอนทุกเซสชัน) · หน้าเว็บ `Login.jsx` | `[x]` Jest + ระบบจริง + Playwright (ลิงก์ → รหัสใหม่ → เข้าสู่ระบบ) · `[ ]` **ไม่มีการส่งอีเมลจริง** ลิงก์อยู่ใน log ของเซิร์ฟเวอร์เท่านั้น |
| ยืมพร้อมกัน / จำกัดจำนวนเล่ม | `src/services/circulation.js` `createLoan` ล็อกแถวสมาชิก (`FOR UPDATE`) ก่อนนับรายการค้าง · `scripts/concurrency-test.js` | `[x]` Jest · `[x]` ฐานข้อมูลจริง: หนังสือ 1 เล่ม ยืม 20 คำขอพร้อมกันได้ 1, สมาชิกเดียว 8 คำขอได้ 5 (โควตา 5) |
| ค่าปรับ | `days_overdue`, `fine_amount` ใน `getMemberLoans`, `listOverdueLoans`, `returnLoan` (`FINE_PER_DAY`) · แสดงในหน้าเว็บ | `[x]` Jest · `[x]` ฐานข้อมูลจริง (35 บาท) · `[x]` Newman · เป็นการคำนวณแสดงผล ไม่มีระบบชำระเงิน |
| Soft delete | `deleted_at` (`migrations/001-soft-delete.sql`) · ไม่มีประวัติ = ลบจริง, มี = เก็บเข้าคลัง, ยังค้างอยู่ = 409 · สมาชิกที่เก็บเข้าคลังเข้าสู่ระบบไม่ได้ | `[x]` Jest · `[x]` ฐานข้อมูลจริง + migration 001 กับข้อมูลเดิม · `[x]` Newman · แก้บั๊กเดิม: ลบหนังสือที่มีประวัติการยืมเคยตอบ 500 |
| แยก service ชั้น Circulation | `src/services/circulation.js` (handler ใน `src/circulation/index.js` บางลง) | `[x]` Jest ทั้งชุดผ่านเหมือนเดิม |
| Frontend แยกคอมโพเนนต์ + เทสต์ | `Dashboard.jsx`, `components/*Tab.jsx`, `api.js`, `format.js`; `App.jsx` เหลือประมาณ 70 บรรทัด · Vitest 20 รายการ | `[x]` `npm test`, `npm run lint`, `npm run build` ใน `frontend/` |
| Request ID + log JSON | `src/middlewares/request-log.js` · Gateway สร้างและส่งต่อ `X-Request-Id` | `[x]` Jest `tests/request-log.test.js` · `[x]` ระบบจริง: id เดียวกันปรากฏใน log ของ Gateway และ Book API |
| Docker / CI | `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` | `[ ]` **ยังไม่ได้ทดสอบ** (ไม่มี Docker daemon ในเครื่องที่ใช้พัฒนา และยังไม่เคยรันบน GitHub Actions) ตรวจได้แค่รูปแบบไฟล์ |

## 3. CLO6 — Client-Facing Frontend (10 คะแนน)

ไฟล์หลัก: `frontend/src/App.jsx` (React + Vite)

### 3.1 เรียกใช้ API จริงอย่างน้อย 3 endpoint (รวม GET และการเปลี่ยนแปลงข้อมูล)

| การเรียก | หลักฐาน | ประเภท |
|---|---|---|
| รายการหนังสือ `GET /api/books` | `frontend/src/App.jsx` | GET |
| รายการสมาชิก `GET /api/members` | `frontend/src/App.jsx` | GET |
| ประวัติการยืม `GET /api/members/{id}/loans` | `frontend/src/App.jsx` | GET |
| เพิ่มสมาชิก `POST /api/members` | `frontend/src/App.jsx` | POST |
| แก้ไขสมาชิก `PUT /api/members/{id}` | `frontend/src/App.jsx` | PUT |
| ลบสมาชิก `DELETE /api/members/{id}` | `frontend/src/App.jsx` | DELETE |
| ยืมหนังสือ `POST /api/loans` | `frontend/src/App.jsx` | POST |
| คืนหนังสือ `PUT /api/loans/{id}/return` | `frontend/src/App.jsx` | PUT |

| Checklist | สถานะ |
|---|---|
| เรียก API จริง 8 รูปแบบ ครบทั้ง GET, POST, PUT, DELETE (ฟังก์ชันกลาง `request` ที่ `App.jsx`) | `[x]` อ่านโค้ด · ฝั่งหลังบ้านของ endpoint เหล่านี้ผ่านทั้ง Jest และการเรียกด้วย `curl` (ยกเว้นการแก้ไขและลบสมาชิกที่สำเร็จ ซึ่งผ่าน Jest เท่านั้น) |
| หน้าเว็บทำงานกับ Backend จริงครบทุกขั้น | `[ ]` ทดสอบมือ 5 รายการ: ดูหนังสือ, ดูสมาชิก, เพิ่มสมาชิก, ยืม, คืน |
| Build ผ่านและไม่มี error จาก lint | `[x]` `vite build` สำเร็จ · `oxlint` 0 errors, 0 warnings |

### 3.2 หน้าจอเหมาะกับผู้ใช้ และแสดงสถานะ loading/error

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| มีสถานะ loading ระหว่างรอ API | state: `App.jsx` · แถบแสดงผล: `App.jsx` (`role="status"`) · ปิดปุ่มระหว่างโหลด: `App.jsx · ทุกฟังก์ชัน reset ใน `finally` เช่น | `[x]` อ่านโค้ด · `[x]` ยืนยันในเบราว์เซอร์ (เปิดหน้าให้โหลดเสร็จ แล้วตั้ง Slow 3G ใน DevTools → Network แล้วกดปุ่มที่เรียก API เห็นแถบ "กำลังโหลด...") หมายเหตุ: การรีโหลดหน้าตอน Slow 3G เห็นหน้าขาวชั่วคราวเพราะไฟล์ JS ยังโหลดไม่เสร็จ ไม่ใช่สถานะ loading ของแอป |
| แสดงข้อความ error เมื่อเรียก API ไม่สำเร็จ | แปลง error ที่ `App.jsx` (เชื่อมต่อไม่ได้ / HTTP status / ข้อความจาก API) · แสดง: `App.jsx` (`role="alert"`) · ทุกฟังก์ชันเรียก `showStatus("error", …)` ใน `catch` เช่น | `[x]` อ่านโค้ด · `[ ]` ยืนยันในเบราว์เซอร์ (ปิด Backend แล้วโหลดหน้า ต้องเห็นข้อความ error สีแดง ไม่ขาวโล่ง) |
| หน้าไม่ขาวเมื่อไม่ได้ตั้งค่า URL | `src/api.js` โยน error พร้อมข้อความภาษาไทยเมื่อไม่มี `VITE_BOOK_API_URL` / `VITE_CIRCULATION_API_URL` · ตัวอย่างค่าตั้ง: `frontend/.env.example` | `[x]` อ่านโค้ด · หมายเหตุ: ถ้าไม่มี `.env.local` ข้อความนี้ขึ้นใน console ไม่ใช่บนหน้าเว็บ ต้องคัดลอก `.env.example` เป็น `.env.local` ก่อนรัน |
| แสดงผลอ่านง่าย (แท็บ, ตาราง, สถานะสรุป) | แท็บ: `App.jsx` · การ์ดสรุป: · ตารางประวัติ: | `[ ]` ตรวจสายตาในเบราว์เซอร์ |
| จัดการกรณีไม่มีข้อมูล | `App.jsx` (ไม่มีหนังสือ) | `[x]` อ่านโค้ด |

### 3.3 แบบฟอร์มและการตรวจความถูกต้องเบื้องต้นฝั่ง Frontend

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| แบบฟอร์มสมาชิก (เพิ่ม/แก้ไข) | `App.jsx` (`<form onSubmit>`) · ช่องชื่อ `required` + `minLength={2}` · ช่องอีเมล `type="email"` และ `required` · ช่องโทรศัพท์ `type="tel"` | `[x]` อ่านโค้ด |
| แบบฟอร์มยืมหนังสือ | `App.jsx` (`onSubmit={borrowBook}`) · `required` ที่ · ช่องวันที่ `type="date"` พร้อม `min` = วันนี้ · ปิดตัวเลือกหนังสือที่หมด · ปุ่มส่งปิดเมื่อไม่มีหนังสือหรือสมาชิก | `[x]` อ่านโค้ด |
| ตรวจก่อนส่งด้วยโค้ด | ข้อมูลไม่ครบ: `App.jsx` · วันกำหนดคืนย้อนหลัง: | `[x]` อ่านโค้ด |
| Backend ตรวจซ้ำ (ไม่เชื่อข้อมูลจาก Frontend อย่างเดียว) | อีเมลไม่ถูกต้อง `src/circulation/index.js` · วันที่ · อีเมลซ้ำ 409 | `[x]` รันทดสอบ: อีเมลผิดได้ 400, อีเมลซ้ำได้ 409 |
| ทดสอบด้วยข้อมูลที่ไม่ถูกต้องผ่านหน้าเว็บ | | `[x]` ทดสอบมือกับฟอร์มสมาชิก: ชื่อสั้นเกินไปและอีเมลไม่มี `@` ถูกบล็อกพร้อมข้อความเตือน · `[ ]` ยังไม่ได้ทดสอบ: ชื่อเป็นช่องว่างล้วน และฟอร์มยืมหนังสือ |

### 3.4 หน้าเข้าสู่ระบบและสิทธิ์ตามบทบาทบนหน้าเว็บ

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| หน้าเข้าสู่ระบบ / สมัครสมาชิก | `frontend/src/Login.jsx` (ตรวจ username, เรียก API, สมัครเสร็จกลับหน้าเข้าสู่ระบบ) · ผู้ที่ยังไม่เข้าสู่ระบบเห็นเฉพาะหน้านี้ (`App.jsx`) | `[x]` อ่านโค้ด · `[x]` ทดสอบในเบราว์เซอร์ (Playwright): รหัสผ่านผิดขึ้นข้อความ, สมัครสำเร็จแล้วกลับหน้าเข้าสู่ระบบพร้อมใส่ username ให้ และเข้าสู่ระบบด้วยบัญชีใหม่ได้ |
| แนบ token ทุกคำขอ และจัดการ 401 | `frontend/src/api.js` (`apiRequest`: `Authorization: Bearer` จาก token ในหน่วยความจำ · ได้ 401 แล้ว refresh หนึ่งครั้งแล้วยิงซ้ำ · refresh ไม่ได้กลับหน้า login พร้อมข้อความ) · ไม่ใช้ `sessionStorage` | `[x]` เทสต์อัตโนมัติ `frontend/src/test/api.test.js` · `[x]` ทดสอบในเบราว์เซอร์ (Playwright): login → รีโหลดแล้วยังอยู่ (กู้จาก cookie) และ `sessionStorage` ว่าง |
| แยกหน้าตาตามบทบาท | `frontend/src/Dashboard.jsx` (`isAdmin`) · user ไม่มีแท็บสมาชิก () · ฟอร์มยืมของ user ใช้สมาชิกของตัวเอง () · user เห็นเฉพาะประวัติของตัวเอง () · ป้ายบทบาทและปุ่มออกจากระบบ () | `[x]` อ่านโค้ด · `[x]` ทดสอบในเบราว์เซอร์ทั้ง admin และ user |
| ออกจากระบบ | ปุ่ม "ออกจากระบบ" เรียก `POST /api/auth/logout` (เพิกถอนเซสชัน) และล้าง token ในหน่วยความจำ (`frontend/src/App.jsx`, `api.js`) | `[x]` เทสต์อัตโนมัติ `App.test.jsx` · `[x]` ทดสอบในเบราว์เซอร์ (หลังออกจากระบบรีโหลดแล้วกลับหน้า login) |
| admin จัดการข้อมูลผ่านหน้าเว็บ (หนังสือ เพิ่ม/แก้ไข/ลบ · ผู้แต่ง · หมวดหมู่ · รายการเกินกำหนด) | แท็บใน `frontend/src/Dashboard.jsx` (แสดงเฉพาะ admin) · สมาชิก: `components/MembersTab.jsx` · ฟอร์ม/ตาราง/ลบหนังสือ: `AdminCatalog.jsx` · รายการเกินกำหนด + ค่าปรับ `AdminCatalog.jsx` (`OverdueLoans`) ใช้ที่ `components/HistoryTab.jsx` | `[x]` อ่านโค้ด · `[x]` ทดสอบในเบราว์เซอร์ (Playwright กับฐานข้อมูลจริง): เพิ่มผู้แต่ง/หมวดหมู่/หนังสือ, แก้ไข, ลบ, ISBN ซ้ำขึ้นข้อความ error, user ไม่เห็นแท็บ |
| ทดสอบด้วยมือบนเครื่องของผู้จัดทำ | ลำดับ: เข้าสู่ระบบด้วย `somchai` แล้วยืม/คืนหนังสือ → ออกจากระบบ → เข้าสู่ระบบด้วย `admin` ดูแท็บสมาชิก | `[ ]` ทดสอบมือและจับภาพหน้าจอ |

## 4. CLO7 — Project Defense (5 คะแนน)

| Checklist | หลักฐาน / สิ่งที่ต้องเตรียม | สถานะ |
|---|---|---|
| Demo สดทำงานได้ | ลำดับ demo ในหัวข้อ 4.1 และการเปิดบริการทั้ง 3 ตามหัวข้อ 5 | `[ ]` ซ้อมให้จบใน 3–4 นาที |
| อธิบายสถาปัตยกรรมและเหตุผลได้ | หัวข้อ 4.2 | `[ ]` ฝึกอธิบาย |
| ตอบคำถามเรื่องระบบที่ตนเองพัฒนาได้ | หัวข้อ 4.3 | `[ ]` ฝึกตอบ |

### 4.1 ลำดับ Demo (3–4 นาที)

1. เข้าสู่ระบบด้วย `somchai` (user): เห็นเฉพาะแท็บหนังสือ ยืมหนังสือ และประวัติของตัวเอง ไม่มีแท็บสมาชิก ลองยืมและคืนหนังสือ แล้วออกจากระบบ
2. เข้าสู่ระบบด้วย `admin`: แสดงรายการหนังสือพร้อมจำนวนคงเหลือ
3. แท็บสมาชิก (เฉพาะ admin) เพิ่มสมาชิกใหม่ผ่านแบบฟอร์ม (ลองกรอกอีเมลผิดให้เห็นการตรวจสอบก่อน)
4. แท็บยืมหนังสือ เลือกสมาชิกและหนังสือ ยืมแล้วกลับไปดูว่าจำนวนคงเหลือลดลง
5. แท็บประวัติ ดูรายการยืม แล้วคืนหนังสือ ดูจำนวนคงเหลือกลับมา
6. เปิด Swagger UI ที่ `/api-docs` ชี้ว่าเอกสารมาจากไฟล์เดียวกับที่ระบบใช้ กด Authorize ด้วย token จาก `/api/auth/login` ให้เห็นว่าไม่มี token ได้ 401 และ token ของ user ลบหนังสือได้ 403
7. (ถ้ามีเวลา) เรียก `/api/books/3/external-info` ให้เห็นข้อมูลจาก Open Library และอธิบายว่าถ้า API ภายนอกล่มระบบตอบ fallback แทน

เตรียมข้อมูลก่อนขึ้นนำเสนอ: ตรวจว่าหนังสือที่จะยืมมี `available_copies` มากกว่า 0 และต้องมีสมาชิกอย่างน้อย 1 คน

### 4.2 สถาปัตยกรรม (ตอบตามที่ทำจริง)

- **Book API** (พอร์ต 3000, `src/index.js`) จัดการหนังสือ ผู้แต่ง หมวดหมู่ และเรียก Open Library ผ่าน `src/services/external-api.js`
- **Circulation Service** (พอร์ต 3001, `src/circulation/index.js`) จัดการสมาชิก การยืม การคืน และรายการเกินกำหนด
- **API Gateway** (พอร์ต 8000, `src/gateway/index.js`) เป็นจุดเข้าเดียวของหน้าเว็บ ตรวจ JWT สร้าง `X-Request-Id` แล้วส่งต่อ
- **Frontend** (React + Vite) เรียกผ่าน Gateway แนบ access token (เก็บในหน่วยความจำ) ทุกคำขอ และใช้ refresh cookie กู้เซสชัน
- **ระบบสิทธิ์** `src/auth.js` ใช้ร่วมกันทั้งสองบริการ ตรวจ JWT แบบ stateless ด้วย `JWT_SECRET` เดียวกัน (ไม่ต้องถามอีกบริการ) บทบาทมี 2 แบบ: admin ทำได้ทุกอย่าง, user ดูแคตตาล็อก ยืม/คืน และดูประวัติของตัวเองเท่านั้น
- **ฐานข้อมูล** MySQL/MariaDB ชุดเดียว (`book_system`) ใช้ร่วมกันทั้งสองบริการ

### 4.3 คำถามที่น่าจะถูกถาม

| คำถาม | แนวตอบ (ตรงกับของจริง) |
|---|---|
| ทำไมแยก 2 บริการทั้งที่ใช้ฐานข้อมูลเดียว | แยกความรับผิดชอบ (แคตตาล็อก vs การยืมคืน) ให้พัฒนา ทดสอบ และรันแยกกันได้ ใช้ฐานข้อมูลร่วมเพราะการยืมต้องอัปเดต `books.available_copies` และเพิ่ม `loans` ในธุรกรรมเดียวกัน ถ้าแยกฐานข้อมูลต้องจัดการ distributed transaction ซึ่งเกินขอบเขตงานนี้ |
| `microservices-design.md` มี API Gateway ทำไมของจริงไม่มี | เอกสารนั้นเป็นแบบเป้าหมาย ของที่ทำจริงคือ 2 บริการ ไม่มี Gateway และฐานข้อมูลเดียว |
| ยืมหนังสือพร้อมกัน 2 คนจะเกิดอะไร | ใช้ transaction กับ `SELECT … FOR UPDATE` (`src/circulation/index.js`,) คนที่สองรอจนคนแรกเสร็จ แล้วเห็นจำนวนล่าสุด ถ้าหมดได้ 409 |
| ทำไมวันที่ถึงต้องตั้ง `dateStrings` | `mysql2` แปลง `DATE` เป็น `Date` ของ JavaScript ตามเขตเวลา ทำให้เครื่องที่เป็น UTC+7 แสดงวันที่ถอยหลัง 1 วัน (`src/db.js`) |
| ถ้า Open Library ล่มเกิดอะไร | ลอง 3 ครั้ง (รอ 300 ms แล้ว 600 ms) timeout 3 วินาทีต่อครั้ง ไม่ retry เมื่อได้ 4xx แล้วตอบ HTTP 200 พร้อม `source: "fallback"` และข้อมูลหนังสือในระบบ (`src/services/external-api.js`) |
| Coverage 90% แปลว่าไม่มีบั๊กไหม | ไม่ใช่ แปลว่าโค้ดส่วนนั้นถูกเรียกขณะทดสอบ และชุดทดสอบ mock ฐานข้อมูล จึงไม่ยืนยันพฤติกรรมกับฐานข้อมูลจริง (ส่วนสิทธิ์ตรวจกับฐานข้อมูลจริงแยกอีก 42 กรณี) เมื่อนับทุกไฟล์ใน `src/` (รวม `db.js` ที่ไม่ถูกทดสอบ) ได้ 92.07% |
| ระบบสิทธิ์ทำงานอย่างไร | login ได้ access token JWT (อายุ 15 นาที) ที่มี `role` และ `member_id` และ cookie refresh token สำหรับต่ออายุ ทุกคำขอต้องแนบ `Authorization: Bearer` middleware `authenticate` ตรวจลายเซ็นและวันหมดอายุ แล้ว `requireRole("admin")` ใช้กับเส้นทางที่ต้องเป็น admin ส่วนเส้นทางของ user ตรวจว่าเป็นข้อมูลของตัวเอง (`member_id` ใน token ตรงกับข้อมูล) ได้ 401 ถ้าไม่ได้เข้าสู่ระบบ และ 403 ถ้าไม่มีสิทธิ์ |
| ผู้ใช้แก้ role เป็น admin ใน token ได้ไหม | ไม่ได้ เพราะ token ลงลายเซ็นด้วย `JWT_SECRET` ที่มีแต่ฝั่ง server ถ้าแก้ข้อมูลใน token ลายเซ็นจะไม่ตรงและได้ 401 (มีเทสต์ที่ปลอม token ทดสอบไว้) และตอนสมัครสมาชิก server ไม่รับ `role` จากผู้สมัคร |
| ทำไมเก็บรหัสผ่านเป็น hash | ถ้าฐานข้อมูลรั่วจะไม่เห็นรหัสผ่านจริง ใช้ bcrypt (cost 10) ที่ช้าโดยตั้งใจและมี salt ในตัว เทียบด้วย `bcrypt.compare` ข้อความ error ตอน login ผิดเหมือนกันทั้งกรณีไม่พบผู้ใช้และรหัสผ่านผิด เพื่อไม่บอกว่ามี username นี้หรือไม่ |
| ทำไมซ่อนแท็บสมาชิกจาก user แล้ว ยังต้องตรวจที่ API อีกไหม | ต้อง เพราะหน้าเว็บเป็นฝั่งผู้ใช้ ถูกข้ามได้ด้วย Postman หรือ curl สิทธิ์จริงบังคับที่ API เสมอ (ทดสอบแล้ว user เรียก `/api/members` ตรง ๆ ได้ 403) การซ่อนในหน้าเว็บเป็นแค่ความสะดวกในการใช้งาน |
| จุดอ่อนของระบบยืนยันตัวตนนี้ | access token ที่ออกไปแล้วยังใช้ได้จนหมดอายุ 15 นาทีแม้เพิกถอนเซสชัน (ต้องแลกกับการไม่ต้องถามฐานข้อมูลทุกคำขอ), ลืมรหัสผ่านยังไม่ส่งอีเมล (ลิงก์อยู่ใน log), rate limit เก็บในหน่วยความจำของแต่ละโปรเซส, ถ้ามี XSS ผู้โจมตียังใช้ token ในหน่วยความจำของหน้านั้นได้ระหว่างที่เปิดอยู่ (แต่อ่าน refresh token ไม่ได้) |
| Swagger/OpenAPI ช่วยอะไร | เป็นสัญญาของ API ที่อ่านโดยคนและเครื่อง Swagger UI อ่านจากไฟล์ `openapi.yaml` เดียวกัน ทดลองเรียกได้ทันที |

## 5. ขั้นตอนตรวจก่อนส่ง

### 5.1 ทดสอบโคลนใหม่ตั้งแต่ศูนย์ (ทำให้จบก่อนติ๊ก `[ ]` ข้างบน)

```cmd
git clone https://github.com/Sirapob0110/library_book_system test-clone
cd test-clone
npm install
copy .env.example .env
C:\xampp\mysql\bin\mysql.exe -u root --default-character-set=utf8mb4 < schema.sql
C:\xampp\mysql\bin\mysql.exe -u root --default-character-set=utf8mb4 < seed.sql
npm test
```

เปิดอีก 2 หน้าต่าง (`start:all` เปิด Book API, Circulation และ Gateway พร้อมกัน)

```cmd
npm run start:all
cd frontend && npm install && copy .env.example .env.local && npm run dev
```

แล้วเข้าสู่ระบบด้วย `admin` / `Admin@1234` หรือ `somchai` / `User@1234`

### 5.2 รายการตรวจ

CLO8

- [ ] รัน `npm install` แล้ว `npm test` บนเครื่องตนเองผ่าน 382/382 และตัวเลขตรงกับ `coverage-report.md` (ติดตั้งใหม่เพราะมีแพ็กเกจเพิ่ม: `express-rate-limit`, `zod`, `redis`, `graphql`)
- [x] ไม่มี merge conflict หลงเหลือ
- [x] route ในโค้ดตรงกับ `openapi.yaml` ครบ 24 operations และ `src/circulation/openapi.yaml` เหมือนไฟล์ที่ราก
- [x] เข้าสู่ระบบ/สิทธิ์ admin และ user ทำงานถูกต้อง (`auth-test-results.md` 42 กรณี และ Jest)
- [ ] โหลด `schema.sql` และ `seed.sql` ใหม่บนเครื่องตนเอง (ตาราง `users` เพิ่มขึ้น) แล้วเข้าสู่ระบบได้ทั้ง admin และ user
- [ ] โคลนใหม่แล้วรันครบทั้ง 3 บริการได้ (หัวข้อ 5.1)
- [x] เปิด Swagger UI ทั้งพอร์ต 3000 และ 3001 ได้ และ `npm run start:all` เปิดครบ 3 บริการ (ทดสอบแล้วกับฐานข้อมูลจริง)

CLO6

- [x] ดูหนังสือ / ดูสมาชิก / เพิ่มสมาชิก / ยืม / คืน ผ่านหน้าเว็บ
- [x] ปิด Backend แล้วเปิดหน้าเว็บ เห็นข้อความ error ชัดเจน
- [x] เห็นสถานะ loading ตอนโหลด (ใช้ Slow 3G ใน DevTools)
- [x] ฟอร์มกันข้อมูลผิดก่อนส่ง (ชื่อสั้น, อีเมลผิด)
- [x] ฟอร์มกันข้อมูลผิดก่อนส่ง (ชื่อเป็นช่องว่างล้วน, ฟอร์มยืมหนังสือ)
- [x] เก็บภาพหน้าจอ: รายการหนังสือ, หลังเพิ่มสมาชิก, หลังยืมและคืน, Network ที่เห็น HTTP status, ข้อความ error/validation

CLO7

- [ ] ซ้อม demo ให้จบใน 3–4 นาที
- [ ] ฝึกตอบคำถามในหัวข้อ 4.3

ไฟล์ส่งงาน

- [x] ลบ `src/index.circulation-backup.js` และเลิกติดตาม `coverage/` ใน git แล้ว (ตรวจจาก `origin/main`)
- [x] ไม่มี `.env` หรือรหัสผ่านจริงใน repo (มีเฉพาะ `.env.example` และบัญชีสาธิตใน `seed.sql` / README ที่เป็นรหัสผ่านสำหรับสาธิต)
- [x] โครงสร้างตรงตามที่กำหนด: `src/`, `frontend/`, `openapi.yaml`, `coverage-report.md`, `clo-requirements-checklist.md`, `package.json`