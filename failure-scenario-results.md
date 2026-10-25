# ผลการทดสอบ Failure Scenario — External API Integration

**ระบบ:** ระบบข้อมูลหนังสือ (Pno 1)
**API ภายนอก:** Open Library (`GET /api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data`)
**Endpoint ที่ใช้ทดสอบ:** `GET /api/books/3/external-info` (ISBN `9780747532699`)
**โค้ด:** `src/services/external-api.js`

## สรุปหลักฐานตามเกณฑ์การให้คะแนน Week 10 Project Phase 2

### 1. OpenAPI Specification, Swagger UI และ Postman Collection (เต็ม 2.5 คะแนน)

| เกณฑ์ | คะแนนเต็ม | หลักฐานที่มี | สิ่งที่ควรตรวจ |
| --- | ---: | --- | --- |
| OpenAPI Specification ครบถ้วนและตรงกับโค้ดจริง | 1.5 | มีไฟล์ `openapi.yaml` และหน้า Swagger UI แสดง endpoint ของระบบ | ตรวจ `openapi.yaml` เทียบกับ routes, request validation, status code และ response schema ใน `src/index.js` ก่อนส่ง |
| Swagger UI เข้าถึงได้จริงและแสดงผลถูกต้อง | 0.5 | เปิด `http://localhost:3000/api-docs` ได้ และทดลอง `GET /api/books?q=Harry` ได้ HTTP 200 | มีภาพหลักฐานในหัวข้อภาพประกอบด้านล่าง |
| Postman Collection ครบทุก endpoint พร้อมตัวอย่างจริง | 0.5 | มีไฟล์ `postman_collection.json`; Collection Runner แสดง 23 requests, 47 tests passed, 0 failed และ 0 errors | ตรวจให้แน่ใจว่า Collection ครบทุก endpoint ในโค้ดจริงและมีตัวอย่าง request/response ที่จำเป็น |

### 2. External API Failure Handling (เต็ม 2.5 คะแนน)

| เกณฑ์ | คะแนนเต็ม | หลักฐานในรายงาน | ผล |
| --- | ---: | --- | --- |
| Retry logic ทำงานถูกต้องและเรียกซ้ำตามจำนวนที่กำหนด | 0.8 | S2, S3, S7–S9 และ N2 แสดงการลองสูงสุด 3 ครั้ง พร้อม backoff 300 ms และ 600 ms | มี log ยืนยันการ retry |
| Timeout กำหนดไว้เหมาะสมและทำงานจริง | 0.7 | S6 ทดสอบ timeout 3000 ms; N1 ทดสอบด้วยค่า 1 ms และเห็น timeout ครบ 3 ครั้ง | มี log ยืนยันว่า timeout ตัดการรอและเริ่ม retry |
| Fallback ตอบสนองผู้ใช้อย่างเหมาะสมเมื่อ API ภายนอกล้มเหลว | 0.7 | S3, S4, S6–S9 และ N2 แสดง `source: "fallback"`, `external: null` และข้อความแจ้งผู้ใช้ ขณะที่ข้อมูลหนังสือในระบบยังอยู่ | ระบบยังส่งข้อมูลหลักจากฐานข้อมูลและไม่ crash |
| บันทึกผล Failure Scenario ครบถ้วนและสะท้อนการทดสอบจริง | 0.3 | ตาราง S1–S10, ผลทดสอบบนเครื่องจริง N1–N5, response body และ server log | แยกผลจาก mock และผลที่เรียก API จริง |

## ภาพหลักฐานประกอบ

> ภาพเก็บไว้ในโฟลเดอร์ `wk10-project-phase2-evidence` ที่อยู่ข้างไฟล์นี้ เพื่อให้ Markdown แสดงภาพได้ต้องคงโฟลเดอร์และชื่อไฟล์ไว้ตามเดิม

### Swagger UI แสดงกลุ่ม Books, Authors, Categories, External และ Schemas

![Swagger UI แสดงกลุ่ม Books, Authors, Categories, External และ Schemas](wk10-project-phase2-evidence/01-swagger-ui.png)

### Response จาก Open Library จริง: source=open-library, found=true

![Response จาก Open Library จริง: source=open-library, found=true](wk10-project-phase2-evidence/02-open-library-success.png)

### Response fallback: source=fallback และ fallback_reason=ENOTFOUND

![Response fallback: source=fallback และ fallback_reason=ENOTFOUND](wk10-project-phase2-evidence/03-fallback-enotfound.png)

### CMD log แสดง timeout และ retry ครบ 3 ครั้ง

![CMD log แสดง timeout และ retry ครบ 3 ครั้ง](wk10-project-phase2-evidence/04-timeout-log.png)

### CMD log แสดง ENOTFOUND และ backoff 300/600 ms

![CMD log แสดง ENOTFOUND และ backoff 300/600 ms](wk10-project-phase2-evidence/05-retry-enotfound-log.png)

### Postman Collection Runner: 47 tests passed, 0 failed, 0 errors

![Postman Collection Runner: 47 tests passed, 0 failed, 0 errors](wk10-project-phase2-evidence/06-postman-runner.png)

## 1. กลไกที่ออกแบบไว้

| กลไก | ค่าที่ใช้ | พฤติกรรม |
|------|-----------|-----------|
| Timeout | 3000 ms ต่อครั้ง (`EXTERNAL_API_TIMEOUT_MS`) | ถ้า API ไม่ตอบภายในเวลา ถือว่าครั้งนั้นล้มเหลว |
| Retry | ลองใหม่ได้อีก 2 ครั้ง รวมสูงสุด 3 ครั้ง (`EXTERNAL_API_RETRIES`) | retry เมื่อ network error / timeout / HTTP 5xx เท่านั้น ไม่ retry เมื่อ 4xx |
| Backoff | exponential: 300 ms → 600 ms (`EXTERNAL_API_BACKOFF_MS`) | หน่วงเวลาก่อนลองครั้งถัดไป |
| Fallback | ตอบ HTTP 200 พร้อม `source: "fallback"`, `external: null`, `message` และ `fallback_reason` | ผู้ใช้ยังได้ข้อมูลหนังสือจากฐานข้อมูลของระบบ ไม่ crash ไม่ค้าง |

## 2. สภาพแวดล้อมการทดสอบ (ระบุตามความจริง)

- Node.js v22, MariaDB 10.11, รันบนเครื่อง sandbox ที่**จำกัดการเข้าถึงอินเทอร์เน็ต** (เข้า `openlibrary.org` จริงไม่ได้)
- กรณีที่ต้องการให้ API ภายนอก "ตอบได้" (S1, S2, S5) และกรณีที่ต้องควบคุมพฤติกรรม (S3, S4, S6) ใช้ **mock server จำลอง Open Library** ที่ `localhost:4000` ซึ่งตอบรูปแบบ JSON เดียวกับของจริง
- กรณี S7, S8, S9 เป็นความล้มเหลวจริงของเครือข่าย (ไม่ใช้ mock)
- ผลทั้งหมดด้านล่างมาจากการรันจริงและคัดลอกจาก log ของเซิร์ฟเวอร์ ไม่ได้เขียนคาดการณ์

## 3. สรุปผล

| # | สถานการณ์ | วิธีจำลอง | HTTP ที่ผู้ใช้ได้ | source | attempts | เวลารวม | ผลตามที่ออกแบบ |
|---|-----------|-----------|-----------------|--------|----------|---------|----------------|
| S1 | API ปกติ | mock ตอบ 200 | 200 | open-library | 1 | 0.05 s | ผ่าน |
| S2 | ล่มชั่วคราว | mock ตอบ 503 สองครั้ง แล้วปกติ | 200 | open-library | 3 | 0.92 s | ผ่าน (retry แล้วสำเร็จ) |
| S3 | ล่มถาวร (5xx) | mock ตอบ 500 ทุกครั้ง | 200 | fallback | 3 | 0.92 s | ผ่าน |
| S4 | ได้ 4xx | mock ตอบ 404 | 200 | fallback | 1 | 0.01 s | ผ่าน (ไม่ retry) |
| S5 | ไม่พบ ISBN | mock ตอบ 200 `{}` | 200 | open-library (`found: false`) | 1 | 0.01 s | ผ่าน |
| S6 | ช้าเกิน timeout | mock หน่วง 6 วินาที | 200 | fallback | 3 | 9.92 s | ผ่าน |
| S7 | URL ไม่มีอยู่จริง | `http://localhost:9` (port ปิด) | 200 | fallback | 3 | 0.97 s | ผ่าน |
| S8 | โดเมนไม่มีอยู่จริง | `http://does-not-exist.invalid` | 200 | fallback | 3 | 0.95 s | ผ่าน |
| S9 | Open Library จริง (ค่า default) | รันตามปกติใน sandbox ที่ไม่มีอินเทอร์เน็ต | 200 | fallback | 3 | 0.97 s | ผ่าน |
| S10 | ระบบหลัง fallback | เรียก `GET /api/books` ต่อทันที | 200 | - | - | - | ผ่าน (ระบบไม่ล่ม) |

## 4. รายละเอียดแต่ละ scenario

### S1 — API ปกติ
Response: `source: "open-library"`, `found: true`, `attempts: 1`, ได้ข้อมูลสำนักพิมพ์ (Bloomsbury) จำนวนหน้า (223) และ URL ปก
```
[external-api] attempt 1/3 สำเร็จ
```
จำนวนครั้งที่ mock ถูกเรียก: **1**

### S2 — ล่มชั่วคราว (retry สำเร็จ)
```
[external-api] attempt 1/3 ล้มเหลว: HTTP 503
[external-api] รอ 300ms ก่อนลองใหม่
[external-api] attempt 2/3 ล้มเหลว: HTTP 503
[external-api] รอ 600ms ก่อนลองใหม่
[external-api] attempt 3/3 สำเร็จ
```
ผู้ใช้ได้ข้อมูลครบตามปกติ (`attempts: 3`) โดยไม่รู้ว่ามีความล้มเหลวระหว่างทาง จำนวนครั้งที่ mock ถูกเรียก: **3** ตรงตาม backoff 300 + 600 ms (เวลารวม 0.92 s)

### S3 — 5xx ทุกครั้ง (retry ครบแล้ว fallback)
```
[external-api] attempt 1/3 ล้มเหลว: HTTP 500
[external-api] รอ 300ms ก่อนลองใหม่
[external-api] attempt 2/3 ล้มเหลว: HTTP 500
[external-api] รอ 600ms ก่อนลองใหม่
[external-api] attempt 3/3 ล้มเหลว: HTTP 500
[external-api] ล้มเหลวหลัง retry ครบ (3 ครั้ง): HTTP 500
```
Response (ย่อ):
```json
{ "source": "fallback", "found": false, "attempts": 3, "fallback_reason": "HTTP 500",
  "message": "ไม่สามารถดึงข้อมูลเพิ่มเติมจาก Open Library ได้ในขณะนี้ แสดงเฉพาะข้อมูลในระบบ กรุณาลองใหม่ภายหลัง",
  "external": null }
```
(ยังมี `book` ข้อมูลจากฐานข้อมูลแนบมาด้วย) จำนวนครั้งที่ mock ถูกเรียก: **3**

### S4 — ได้ 4xx (ไม่ควร retry)
```
[external-api] attempt 1/3 ล้มเหลว: HTTP 404
[external-api] ล้มเหลวหลัง retry ครบ (1 ครั้ง): HTTP 404
```
เรียกเพียง **1 ครั้ง** ไม่ retry เพราะ 4xx เป็นปัญหาที่ฝั่ง request ลองซ้ำก็ไม่หาย แล้วตอบ fallback ทันที (0.01 s)

### S5 — API ตอบปกติแต่ไม่พบ ISBN
ไม่ถือเป็นความล้มเหลว: `source: "open-library"`, `found: false`, `message: "ไม่พบข้อมูลเลข ISBN นี้ใน Open Library"`, เรียก 1 ครั้ง

### S6 — Timeout
ตั้ง timeout 3000 ms แต่ mock ตอบช้า 6 วินาที
```
[external-api] attempt 1/3 ล้มเหลว: timeout (>3000ms)
[external-api] รอ 300ms ก่อนลองใหม่
[external-api] attempt 2/3 ล้มเหลว: timeout (>3000ms)
[external-api] รอ 600ms ก่อนลองใหม่
[external-api] attempt 3/3 ล้มเหลว: timeout (>3000ms)
[external-api] ล้มเหลวหลัง retry ครบ (3 ครั้ง): timeout (>3000ms)
```
`fallback_reason: "timeout (>3000ms)"` เวลารวม 9.92 s ≈ 3×3 s + 0.3 s + 0.6 s ยืนยันว่า timeout ทำงานจริง (ไม่รอ 6 วินาทีของ mock) และระบบไม่ค้างตลอดไป

### S7 — URL ไม่มีอยู่จริง (connection refused)
`fallback_reason: "ECONNREFUSED"` retry ครบ 3 ครั้ง (backoff 300/600 ms) แล้ว fallback

### S8 — โดเมนไม่มีอยู่จริง (DNS ล้มเหลว)
`fallback_reason: "ENOTFOUND"` retry ครบ 3 ครั้ง แล้ว fallback

### S9 — Open Library จริงด้วยค่า default
sandbox ที่ใช้ทดสอบไม่มีอินเทอร์เน็ต จึงเกิด `ENOTFOUND` retry 3 ครั้ง แล้ว fallback เหมือน S8 (เป็นกรณี "ปิดอินเทอร์เน็ต" ตามที่โจทย์ยกตัวอย่าง)

### S10 — ระบบยังทำงานต่อ
หลังเกิด fallback ทุกครั้ง เซิร์ฟเวอร์ยังตอบ endpoint อื่นได้ (`GET /api/books` → 200) ไม่มี crash

## 5. ข้อสังเกตจากการทดสอบ

1. Fallback ตอบ **HTTP 200** (degraded response) แทน 5xx เพราะข้อมูลหลักของหนังสือยังพร้อมใช้งาน ผู้ใช้แยกแยะได้จากฟิลด์ `source`
2. กรณีเลวร้ายที่สุด (timeout ทุกครั้ง) ผู้ใช้รอประมาณ 10 วินาที ถ้าต้องการลดเวลาสามารถลด `EXTERNAL_API_TIMEOUT_MS` หรือ `EXTERNAL_API_RETRIES` ผ่าน `.env`
3. ยังไม่ได้ทดสอบกับ Open Library จริงที่เข้าถึงได้ ควรรันซ้ำบนเครื่องที่มีอินเทอร์เน็ตเพื่อยืนยันรูปแบบข้อมูลจริง (ฟิลด์ที่อ่านมาจากเอกสารสาธารณะของ API)

## 6. วิธีทดสอบซ้ำ

```bash
# กรณีปกติ (ต้องมีอินเทอร์เน็ต)
npm start
curl http://localhost:3000/api/books/3/external-info

# จำลองการล่ม: ชี้ไปยัง URL ที่ไม่มีอยู่จริง
EXTERNAL_API_BASE_URL=http://does-not-exist.invalid npm start
curl http://localhost:3000/api/books/3/external-info

# จำลอง timeout: ตั้ง timeout สั้นมาก
EXTERNAL_API_TIMEOUT_MS=1 npm start
```
ดู log ที่ terminal ของเซิร์ฟเวอร์ (บรรทัดที่ขึ้นต้นด้วย `[external-api]`)
