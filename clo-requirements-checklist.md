# CLO Requirements Checklist — โครงงานระยะที่ 3 (Library Book System)

## 1. วิธีอ่านเอกสาร

เอกสารนี้ตรวจว่าระบบครอบคลุมข้อกำหนดของ CLO8 (Final Integration), CLO6 (Client-Facing Frontend) และ CLO7 (Project Defense) พร้อมหลักฐานที่ตรวจสอบย้อนกลับได้ในรูป `ไฟล์:บรรทัด` (เลขบรรทัดอ้างอิงจาก commit `2b13cf6` ของ branch `main`)

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
| รวมโมดูลจาก Phase 1–2 และ Microservices เป็นระบบเดียว | Book API: `src/index.js:381` (`app.listen`, พอร์ต 3000) · Circulation Service: `src/circulation/index.js:578` (`app.listen`, พอร์ต 3001) · ตัวเรียก API ภายนอก: `src/services/external-api.js` · สคริปต์รัน: `package.json` (`start`, `start:circulation`) | `[x]` อ่านโค้ด |
| ไม่มี merge conflict หลงเหลือ | ค้นหา `<<<<<<<`, `=======`, `>>>>>>>` ในไฟล์ `.js .jsx .md .yaml .json .sql` ทั้ง repo (ไม่รวม `node_modules`, `coverage`) ไม่พบ | `[x]` รันค้นหา |
| ฐานข้อมูลสร้างจาก repo ได้ครบทุกตาราง | `schema.sql:28-29` (`total_copies`, `available_copies`) · `schema.sql:50` (`members`) · `schema.sql:58` (`loans`) · `seed.sql` | `[x]` สร้างฐานข้อมูลใหม่จากไฟล์ทั้งสองแล้วรันบริการทั้งสอง |
| Book API ทำงานได้ | routes: `src/index.js:110` (GET books) · `:131` (GET book) · `:144` (POST) · `:180` (PUT) · `:234` (DELETE) · `:251` (external-info) · `:267` `:280` `:317` (authors) · `:345` `:358` (categories) | `[x]` รันทดสอบ (`curl` + Jest) |
| Circulation Service ทำงานได้ | routes: `src/circulation/index.js:91` (health) · `:102` `:126` `:165` `:232` (members) · `:278` (ประวัติยืม) · `:333` (overdue) · `:368` (ยืม) · `:480` (คืน) | `[x]` รันทดสอบ (`curl` + Jest) |
| การยืมและคืนทำเป็น transaction และล็อกแถว | ยืม: `src/circulation/index.js:393` (begin) · `:412` (`FOR UPDATE`) · `:445` (commit) · rollback `:401` `:417` `:425` `:458` · คืน: `:493` (begin) · `:499` (`FOR UPDATE`) · `:534` (commit) | `[x]` อ่านโค้ด และรันทดสอบ: ยืมแล้วจำนวนเล่มลด, ยืมเกินจำนวนได้ 409, คืนซ้ำได้ 409 |
| จัดการวันที่ไม่ให้เลื่อนตามเขตเวลา | `src/db.js:15` (`dateStrings: ["DATE"]`) | `[x]` ทดสอบด้วย `TZ=Asia/Bangkok` ได้ `2026-10-10` ตรงกับที่กรอก |
| Book API และ Circulation Service ทำงานพร้อมกับ Frontend ได้ | ดูหัวข้อ 3 | `[ ]` ทดสอบมือตามขั้นตอนในหัวข้อ 5 |

### 2.2 เอกสาร API ตรงกับโค้ดจริง (Swagger/Code Match)

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| ทุก route ในโค้ดมีใน `openapi.yaml` | โค้ดมี 20 routes (Book API 11 + Circulation 9) และ `openapi.yaml` มี 20 operations ตรงกันทุกรายการ path ใน spec: `openapi.yaml:31` (`/api/books`) · `:76` (`/api/books/{id}`) · `:137` (external-info) · `:156` `:192` (authors) · `:211` (categories) · `:249` (`/health`) · `:265` `:306` `:363` (members) · `:387` (overdue) · `:405` (loans) · `:435` (return) | `[x]` เทียบ route จากโค้ดกับ path ใน spec ด้วยสคริปต์ |
| `openapi.yaml` ผ่านการตรวจรูปแบบ | ตรวจด้วย `@apidevtools/swagger-parser` ผล: valid OpenAPI 3.0.3 (13 paths) ทั้ง `openapi.yaml` และ `src/circulation/openapi.yaml` | `[x]` รันตรวจ |
| endpoint ของ Circulation ระบุพอร์ตที่ถูกต้อง | `openapi.yaml` กำหนด `servers: http://localhost:3001` ที่ระดับ path ของ members, loans และ health | `[x]` อ่านสเปก |
| Swagger UI เปิดได้ | Book API: `src/index.js:26` (`/api-docs`, พอร์ต 3000) · Circulation: `src/circulation/index.js:29` (`/api-docs`, พอร์ต 3001) | `[ ]` เปิด http://localhost:3000/api-docs และ http://localhost:3001/api-docs ดูในเบราว์เซอร์ |

ข้อควรระวัง: มีไฟล์ OpenAPI สองฉบับ (`openapi.yaml` ที่ root ใช้ส่งงาน และ `src/circulation/openapi.yaml` ที่ Circulation Service อ่านเอง) ปัจจุบันต่างกันเฉพาะ `operationId` และ `security` หากแก้ฉบับหนึ่งต้องแก้อีกฉบับให้ตรงกัน

### 2.3 รายงาน Test Coverage

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| มีชุดทดสอบครอบคลุมทั้งสองบริการและโมดูลเรียก API ภายนอก | `tests/books.test.js` (40 tests, describe ที่บรรทัด 15–552) · `src/circulation/circulation.test.js` (29 tests, describe ที่บรรทัด 11–334) · `tests/external-api.test.js` (18 tests: retry, backoff, timeout, fallback) | `[x]` รันทดสอบ |
| ผลทดสอบล่าสุด | Test Suites 3/3 ผ่าน · Tests 87/87 ผ่าน · Statements 91.28% · Branches 82.75% · Functions 90.69% · Lines 91.21% | `[x]` รัน `npm test` ซ้ำเมื่อ 26 ต.ค. 2569 ตัวเลขตรงกับผลที่รันบนเครื่องผู้จัดทำและ `coverage-report.md` |
| ระบุจุดที่ยังไม่มี test | `coverage-report.md` หัวข้อ 6 (บรรทัดที่ไม่ครอบคลุม) และหัวข้อ 5.2 (ไฟล์ที่ไม่ถูกนับ: `db.js`) | `[x]` |
| รายงานสะท้อนสถานะจริง | ตัวเลข 91.28% นับเฉพาะไฟล์ที่ชุดทดสอบเรียกใช้ เมื่อนับทุกไฟล์ใน `src/` ได้ 90.29% (ต่างกันเพราะ `src/db.js` ไม่ถูกทดสอบ) | `[x]` ระบุไว้ใน `coverage-report.md` หัวข้อ 5.2 |

### 2.4 ข้อจำกัดที่ทราบ

1. ชุดทดสอบทั้งหมด mock ฐานข้อมูล จึงไม่ยืนยันพฤติกรรมกับฐานข้อมูลจริง ส่วนนี้ตรวจแยกด้วย `curl` กับฐานข้อมูลที่สร้างจาก `schema.sql`
2. `tests/external-api.test.js` จำลอง axios จึงยืนยันตรรกะ retry / timeout / fallback แต่ไม่ได้เรียก Open Library จริง การเรียกจริงและความล้มเหลวของเครือข่ายจริงทดสอบด้วยมือ บันทึกใน `failure-scenario-results.md` และผู้จัดทำตรวจแล้วว่าเทสต์ล้มเมื่อโค้ดถูกแก้ให้ผิด 5 แบบ (`coverage-report.md` หัวข้อ 4.1)
3. `microservices-design.md` เป็นการออกแบบเป้าหมาย (มี API Gateway และฐานข้อมูลแยก 3 ชุด) ของที่ทำจริงคือ 2 บริการใช้ฐานข้อมูล `book_system` ร่วมกัน และไม่มี API Gateway เหตุผล: การยืมต้องปรับ `books.available_copies` และเพิ่ม `loans` ใน transaction เดียวกัน (`src/circulation/index.js:393-445`)
4. `postman_collection.json` ครอบคลุม endpoint ของ Book API เท่านั้น endpoint ของ Circulation Service ทดสอบด้วย Jest, `curl` และหน้าเว็บ
5. ยังไม่มีการทดสอบอัตโนมัติของ Frontend และ `src/db.js` ไม่มี unit test

## 3. CLO6 — Client-Facing Frontend (10 คะแนน)

ไฟล์หลัก: `frontend/src/App.jsx` (React + Vite)

### 3.1 เรียกใช้ API จริงอย่างน้อย 3 endpoint (รวม GET และการเปลี่ยนแปลงข้อมูล)

| การเรียก | หลักฐาน | ประเภท |
|---|---|---|
| รายการหนังสือ `GET /api/books` | `frontend/src/App.jsx:139` | GET |
| รายการสมาชิก `GET /api/members` | `frontend/src/App.jsx:154` | GET |
| ประวัติการยืม `GET /api/members/{id}/loans` | `frontend/src/App.jsx:168-169` | GET |
| เพิ่มสมาชิก `POST /api/members` | `frontend/src/App.jsx:225` | POST |
| แก้ไขสมาชิก `PUT /api/members/{id}` | `frontend/src/App.jsx:277-278` | PUT |
| ลบสมาชิก `DELETE /api/members/{id}` | `frontend/src/App.jsx:317-318` | DELETE |
| ยืมหนังสือ `POST /api/loans` | `frontend/src/App.jsx:367` | POST |
| คืนหนังสือ `PUT /api/loans/{id}/return` | `frontend/src/App.jsx:431-432` | PUT |

| Checklist | สถานะ |
|---|---|
| เรียก API จริง 8 รูปแบบ ครบทั้ง GET, POST, PUT, DELETE (ฟังก์ชันกลาง `request` ที่ `App.jsx:103`) | `[x]` อ่านโค้ด · ฝั่งหลังบ้านของ endpoint เหล่านี้ผ่านทั้ง Jest และการเรียกด้วย `curl` (ยกเว้นการแก้ไขและลบสมาชิกที่สำเร็จ ซึ่งผ่าน Jest เท่านั้น) |
| หน้าเว็บทำงานกับ Backend จริงครบทุกขั้น | `[ ]` ทดสอบมือ 5 รายการ: ดูหนังสือ, ดูสมาชิก, เพิ่มสมาชิก, ยืม, คืน |
| Build ผ่านและไม่มี error จาก lint | `[x]` `vite build` สำเร็จ · `oxlint` 0 errors, 2 warnings (`App.jsx:202` setState ใน effect, `App.jsx:772` เรียก `Date` ระหว่าง render) ไม่กระทบการทำงาน |

### 3.2 หน้าจอเหมาะกับผู้ใช้ และแสดงสถานะ loading/error

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| มีสถานะ loading ระหว่างรอ API | state: `App.jsx:44` · แถบแสดงผล: `App.jsx:507-508` (`role="status"`) · ปิดปุ่มระหว่างโหลด: `App.jsx:472` `:654` `:665` `:692` `:701` `:782` `:850` · ทุกฟังก์ชัน reset ใน `finally` เช่น `:196` `:241` `:300` `:344` `:404` `:420` `:454` | `[x]` อ่านโค้ด · `[ ]` ยืนยันในเบราว์เซอร์ (เปิด DevTools → Network → Slow 3G แล้วกดโหลดข้อมูล) |
| แสดงข้อความ error เมื่อเรียก API ไม่สำเร็จ | แปลง error ที่ `App.jsx:114-131` (เชื่อมต่อไม่ได้ / HTTP status / ข้อความจาก API) · แสดง: `App.jsx:496` (`role="alert"`) · ทุกฟังก์ชันเรียก `showStatus("error", …)` ใน `catch` เช่น `:193` `:239` `:298` `:342` `:402` `:418` `:452` | `[x]` อ่านโค้ด · `[ ]` ยืนยันในเบราว์เซอร์ (ปิด Backend แล้วโหลดหน้า ต้องเห็นข้อความ error สีแดง ไม่ขาวโล่ง) |
| หน้าไม่ขาวเมื่อไม่ได้ตั้งค่า URL | `App.jsx:5-14` โยน error พร้อมข้อความภาษาไทยเมื่อไม่มี `VITE_BOOK_API_URL` / `VITE_CIRCULATION_API_URL` · ตัวอย่างค่าตั้ง: `frontend/.env.example` | `[x]` อ่านโค้ด · หมายเหตุ: ถ้าไม่มี `.env.local` ข้อความนี้ขึ้นใน console ไม่ใช่บนหน้าเว็บ ต้องคัดลอก `.env.example` เป็น `.env.local` ก่อนรัน |
| แสดงผลอ่านง่าย (แท็บ, ตาราง, สถานะสรุป) | แท็บ: `App.jsx:27` · การ์ดสรุป: `:478-489` · ตารางประวัติ: `:837-838` | `[ ]` ตรวจสายตาในเบราว์เซอร์ |
| จัดการกรณีไม่มีข้อมูล | `App.jsx:555` (ไม่มีหนังสือ) | `[x]` อ่านโค้ด |

### 3.3 แบบฟอร์มและการตรวจความถูกต้องเบื้องต้นฝั่ง Frontend

| Checklist | หลักฐาน | สถานะ |
|---|---|---|
| แบบฟอร์มสมาชิก (เพิ่ม/แก้ไข) | `App.jsx:609-611` (`<form onSubmit>`) · ช่องชื่อ `required` + `minLength={2}` `:620-621` · ช่องอีเมล `type="email"` `:629` และ `required` `:634` · ช่องโทรศัพท์ `type="tel"` `:642` | `[x]` อ่านโค้ด |
| แบบฟอร์มยืมหนังสือ | `App.jsx:723` (`onSubmit={borrowBook}`) · `required` ที่ `:731` `:755` `:776` · ช่องวันที่ `type="date"` พร้อม `min` = วันนี้ `:770-772` · ปิดตัวเลือกหนังสือที่หมด `:739` · ปุ่มส่งปิดเมื่อไม่มีหนังสือหรือสมาชิก `:782` | `[x]` อ่านโค้ด |
| ตรวจก่อนส่งด้วยโค้ด | ข้อมูลไม่ครบ: `App.jsx:359-361` · วันกำหนดคืนย้อนหลัง: `:363-365` | `[x]` อ่านโค้ด |
| Backend ตรวจซ้ำ (ไม่เชื่อข้อมูลจาก Frontend อย่างเดียว) | อีเมลไม่ถูกต้อง `src/circulation/index.js:34-47` · วันที่ `:62` `:383` · อีเมลซ้ำ 409 `:75` `:147` `:214` | `[x]` รันทดสอบ: อีเมลผิดได้ 400, อีเมลซ้ำได้ 409 |
| ทดสอบด้วยข้อมูลที่ไม่ถูกต้องผ่านหน้าเว็บ | | `[ ]` ทดสอบมือ: ชื่อ 1 ตัวอักษร, อีเมลไม่มี `@`, ยืมโดยเว้นช่อง, วันที่ย้อนหลัง ต้องเห็นข้อความเตือนและไม่มีคำขอไปที่ API (ดูใน Network) |

## 4. CLO7 — Project Defense (5 คะแนน)

| Checklist | หลักฐาน / สิ่งที่ต้องเตรียม | สถานะ |
|---|---|---|
| Demo สดทำงานได้ | ลำดับ demo ในหัวข้อ 4.1 และการเปิดบริการทั้ง 3 ตามหัวข้อ 5 | `[ ]` ซ้อมให้จบใน 3–4 นาที |
| อธิบายสถาปัตยกรรมและเหตุผลได้ | หัวข้อ 4.2 | `[ ]` ฝึกอธิบาย |
| ตอบคำถามเรื่องระบบที่ตนเองพัฒนาได้ | หัวข้อ 4.3 | `[ ]` ฝึกตอบ |

### 4.1 ลำดับ Demo (3–4 นาที)

1. เปิดหน้าเว็บ แสดงรายการหนังสือพร้อมจำนวนคงเหลือ
2. แท็บสมาชิก เพิ่มสมาชิกใหม่ผ่านแบบฟอร์ม (ลองกรอกอีเมลผิดให้เห็นการตรวจสอบก่อน)
3. แท็บยืมหนังสือ เลือกสมาชิกและหนังสือ ยืมแล้วกลับไปดูว่าจำนวนคงเหลือลดลง
4. แท็บประวัติ ดูรายการยืม แล้วคืนหนังสือ ดูจำนวนคงเหลือกลับมา
5. เปิด Swagger UI ที่ `/api-docs` ชี้ว่าเอกสารมาจากไฟล์เดียวกับที่ระบบใช้
6. (ถ้ามีเวลา) เรียก `/api/books/3/external-info` ให้เห็นข้อมูลจาก Open Library และอธิบายว่าถ้า API ภายนอกล่มระบบตอบ fallback แทน

เตรียมข้อมูลก่อนขึ้นนำเสนอ: ตรวจว่าหนังสือที่จะยืมมี `available_copies` มากกว่า 0 และต้องมีสมาชิกอย่างน้อย 1 คน

### 4.2 สถาปัตยกรรม (ตอบตามที่ทำจริง)

- **Book API** (พอร์ต 3000, `src/index.js`) จัดการหนังสือ ผู้แต่ง หมวดหมู่ และเรียก Open Library ผ่าน `src/services/external-api.js`
- **Circulation Service** (พอร์ต 3001, `src/circulation/index.js`) จัดการสมาชิก การยืม การคืน และรายการเกินกำหนด
- **Frontend** (React + Vite) เรียกทั้งสองบริการตรง ผ่าน CORS ไม่มี API Gateway
- **ฐานข้อมูล** MySQL/MariaDB ชุดเดียว (`book_system`) ใช้ร่วมกันทั้งสองบริการ

### 4.3 คำถามที่น่าจะถูกถาม

| คำถาม | แนวตอบ (ตรงกับของจริง) |
|---|---|
| ทำไมแยก 2 บริการทั้งที่ใช้ฐานข้อมูลเดียว | แยกความรับผิดชอบ (แคตตาล็อก vs การยืมคืน) ให้พัฒนา ทดสอบ และรันแยกกันได้ ใช้ฐานข้อมูลร่วมเพราะการยืมต้องอัปเดต `books.available_copies` และเพิ่ม `loans` ในธุรกรรมเดียวกัน ถ้าแยกฐานข้อมูลต้องจัดการ distributed transaction ซึ่งเกินขอบเขตงานนี้ |
| `microservices-design.md` มี API Gateway ทำไมของจริงไม่มี | เอกสารนั้นเป็นแบบเป้าหมาย ของที่ทำจริงคือ 2 บริการ ไม่มี Gateway และฐานข้อมูลเดียว |
| ยืมหนังสือพร้อมกัน 2 คนจะเกิดอะไร | ใช้ transaction กับ `SELECT … FOR UPDATE` (`src/circulation/index.js:393`, `:412`) คนที่สองรอจนคนแรกเสร็จ แล้วเห็นจำนวนล่าสุด ถ้าหมดได้ 409 |
| ทำไมวันที่ถึงต้องตั้ง `dateStrings` | `mysql2` แปลง `DATE` เป็น `Date` ของ JavaScript ตามเขตเวลา ทำให้เครื่องที่เป็น UTC+7 แสดงวันที่ถอยหลัง 1 วัน (`src/db.js:15`) |
| ถ้า Open Library ล่มเกิดอะไร | ลอง 3 ครั้ง (รอ 300 ms แล้ว 600 ms) timeout 3 วินาทีต่อครั้ง ไม่ retry เมื่อได้ 4xx แล้วตอบ HTTP 200 พร้อม `source: "fallback"` และข้อมูลหนังสือในระบบ (`src/services/external-api.js`) |
| Coverage 90% แปลว่าไม่มีบั๊กไหม | ไม่ใช่ แปลว่าโค้ดส่วนนั้นถูกเรียกขณะทดสอบ และชุดทดสอบ mock ฐานข้อมูล จึงไม่ยืนยันพฤติกรรมกับฐานข้อมูลจริง เมื่อนับทุกไฟล์ใน `src/` (รวม `db.js` ที่ไม่ถูกทดสอบ) ได้ 90.29% |
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

เปิดอีก 3 หน้าต่าง

```cmd
npm start
npm run start:circulation
cd frontend && npm install && copy .env.example .env.local && npm run dev
```

### 5.2 รายการตรวจ

CLO8

- [x] รัน `npm test` ผ่าน 87/87 และตัวเลขตรงกับผลที่รันบนเครื่องผู้จัดทำและ `coverage-report.md`
- [x] ไม่มี merge conflict หลงเหลือ
- [x] route ในโค้ดตรงกับ `openapi.yaml` ครบ 20 รายการ
- [ ] โคลนใหม่แล้วรันครบทั้ง 3 บริการได้ (หัวข้อ 5.1)
- [x] เปิด Swagger UI ทั้งพอร์ต 3000 และ 3001 ได้

CLO6

- [x] ดูหนังสือ / ดูสมาชิก / เพิ่มสมาชิก / ยืม / คืน ผ่านหน้าเว็บ
- [x] ปิด Backend แล้วเปิดหน้าเว็บ เห็นข้อความ error ชัดเจน
- [x] เห็นสถานะ loading ตอนโหลด (ใช้ Slow 3G ใน DevTools)
- [x] ฟอร์มกันข้อมูลผิดก่อนส่ง (ชื่อสั้น, อีเมลผิด, ช่องว่าง, วันที่ย้อนหลัง)
- [x] เก็บภาพหน้าจอ: รายการหนังสือ, หลังเพิ่มสมาชิก, หลังยืมและคืน, Network ที่เห็น HTTP status, ข้อความ error/validation

CLO7

- [ ] ซ้อม demo ให้จบใน 3–4 นาที
- [ ] ฝึกตอบคำถามในหัวข้อ 4.3

ไฟล์ส่งงาน

- [x] ลบ `src/index.circulation-backup.js` และเลิกติดตาม `coverage/` ใน git แล้ว (ตรวจจาก `origin/main`)
- [x] ไม่มี `.env` หรือรหัสผ่านใน repo
- [x] โครงสร้างตรงตามที่กำหนด: `src/`, `frontend/`, `openapi.yaml`, `coverage-report.md`, `clo-requirements-checklist.md`, `package.json`