# CLO Requirements Checklist — Phase 3

## 1. Purpose

เอกสารนี้ใช้ตรวจสอบความครบถ้วนของโครงงาน Library Book System ระยะที่ 3 โดยจัดหมวดหมู่ตามเกณฑ์ประเมิน Final Integration, Client-Facing Frontend และ Project Defense พร้อมระบุไฟล์หรือหลักฐานที่ใช้ตรวจสอบ

**หมายเหตุ:** สถานะต้องอ้างอิงจากผลทดสอบและโค้ดจริงก่อนส่งงาน ไม่ควรถือว่าการมีไฟล์หรือการเปิดระบบได้เพียงอย่างเดียวเป็นหลักฐานว่าผ่านทุกข้อ

## 2. CLO8 — Final Integration (5 คะแนน)

| Checklist | Evidence | Status |
|---|---|---|
| รวมโค้ดจาก Phase 1, Phase 2 และ Microservices เป็นระบบเดียว | `src/`, `src/circulation/`, `package.json` | [ ] ตรวจยืนยันการทำงานร่วมกัน |
| ระบบทำงานโดยไม่มี merge conflict หลงเหลือ | ไฟล์ใน `src/` และผลการรันบริการ | [ ] ตรวจสอบ |
| Book API ทำงานได้จริง | `src/index.js` และผลการเรียก API | [ ] ตรวจสอบ |
| Circulation Service ทำงานได้จริง | `src/circulation/index.js` และผลการเรียก API | [ ] ตรวจสอบ |
| OpenAPI Specification ตรงกับ endpoint จริง รวม endpoint ของ Microservices ที่กำหนดให้จัดทำเอกสาร | `openapi.yaml` และ Swagger UI | [ ] ตรวจสอบ endpoint ให้ครบ |
| มีชุดทดสอบและบันทึกผลการรัน | `tests/books.test.js` และผล `npm test` | [x] มีผลทดสอบที่บันทึกไว้ |
| มีรายงาน Test Coverage พร้อมระบุส่วนที่ยังไม่มี test ครอบคลุม | `coverage-report.md` และ `coverage/index.html` | [x] มีรายงานที่บันทึกไว้ |
| มี Checklist CLO พร้อมหลักฐานที่ตรวจสอบย้อนกลับได้ | `clo-requirements-checklist.md` | [ ] ตรวจเลขบรรทัดและหลักฐานก่อนส่ง |

### 2.1 Test Coverage Baseline

ผลการทดสอบล่าสุดที่บันทึกไว้ในโครงการ:

| รายการ | ผล |
|---|---:|
| Test Suites | 1 passed |
| Tests | 40 passed |
| Statements | 96.05% |
| Branches | 86.00% |
| Functions | 94.73% |
| Lines | 96.52% |

ส่วนที่ยังไม่ครอบคลุมตามรายงานเดิม: `src/index.js` บรรทัด 356 และ 397–401 ควรตรวจรายละเอียดจาก `coverage/index.html` อีกครั้งก่อนส่งรายงานฉบับสุดท้าย

**ข้อจำกัด:** ตัวเลขข้างต้นเป็นผลที่บันทึกไว้ก่อนหน้า ต้องรัน `npm test` อีกครั้งและยืนยันว่า `coverage-report.md` ตรงกับผลล่าสุด รวมถึงตรวจว่าชุดทดสอบที่รันครอบคลุมบริการที่กำหนดในสัปดาห์ที่ 9 และ 13 ตามโจทย์แล้ว

## 3. CLO6 — Client-Facing Frontend (10 คะแนน)

| Checklist | Evidence | Status |
|---|---|---|
| มีหน้าเว็บสำหรับใช้งานระบบ | `frontend/` | [x] มีโฟลเดอร์ |
| Frontend เรียก API ของระบบจริงอย่างน้อย 3 endpoints | โค้ดใน `frontend/` และผลทดสอบจริง | [ ] ตรวจนับ endpoint |
| มีการเรียก API แบบ GET เพื่ออ่านข้อมูล | โค้ดใน `frontend/` | [ ] ตรวจสอบ |
| มีการเรียก API แบบ POST, PUT หรือ DELETE อย่างน้อยหนึ่งรายการ | โค้ดใน `frontend/` และผลทดสอบจริง | [ ] ตรวจสอบ |
| แสดงสถานะ Loading ระหว่างรอ API | Frontend components | [ ] ตรวจสอบ |
| แสดงข้อความ Error เมื่อเรียก API ไม่สำเร็จ | Frontend components และผลทดสอบกรณีผิดพลาด | [ ] ตรวจสอบ |
| มีฟอร์มรับข้อมูลสำหรับ endpoint ที่เปลี่ยนแปลงข้อมูล | Frontend components | [ ] ตรวจสอบ |
| ตรวจสอบข้อมูลเบื้องต้นก่อนส่ง API | Validation ใน Frontend | [ ] ตรวจสอบ |
| ทดลองใช้งาน Frontend กับ Backend จริง | ภาพหน้าจอหรือบันทึกผลการทดสอบ | [ ] เก็บหลักฐาน |

การเปิดหน้าเว็บได้ตามปกติเป็นหลักฐานเบื้องต้น แต่ต้องตรวจพฤติกรรม Loading/Error และ Validation เพิ่มเติมเพื่อยืนยันเกณฑ์การให้คะแนน

## 4. CLO7 — Project Defense (5 คะแนน)

| Checklist | Evidence | Status |
|---|---|---|
| เตรียม Demo สดที่ทำงานได้จริง ใช้เวลาประมาณ 3–4 นาที | Demo plan หรือสคริปต์นำเสนอ | [ ] เตรียมก่อนนำเสนอ |
| Demo ครอบคลุม Use Case หลักอย่างน้อยหนึ่งกรณี ตั้งแต่ต้นจนจบ | ลำดับการสาธิตระบบ | [ ] เตรียมก่อนนำเสนอ |
| อธิบายสถาปัตยกรรมของระบบและหน้าที่ของแต่ละ Service ได้ | แผนภาพสถาปัตยกรรมและโค้ดที่เกี่ยวข้อง | [ ] เตรียมคำอธิบาย |
| อธิบายเหตุผลการตัดสินใจทางเทคนิคได้ | ตัวอย่างการใช้ Database Transaction, API และ Microservices | [ ] เตรียมคำอธิบาย |
| ตอบคำถามเกี่ยวกับระบบที่พัฒนาจริงได้ | การทบทวนโค้ดและการออกแบบระบบ | [ ] เตรียมก่อนนำเสนอ |

### 4.1 Suggested Demo Flow

1. เปิด Frontend และแสดงรายการหนังสือ
2. เพิ่มสมาชิกผ่านแบบฟอร์ม
3. ยืมหนังสือและแสดงจำนวนหนังสือคงเหลือ
4. เปิดประวัติการยืมของสมาชิก
5. คืนหนังสือและตรวจสอบจำนวนหนังสือคงเหลืออีกครั้ง

ลำดับนี้เป็นข้อเสนอสำหรับการสาธิต ต้องทดลองตามลำดับจริงก่อนวันนำเสนอ และเตรียมข้อมูลทดสอบไว้ล่วงหน้า

## 5. Final Verification Before Submission

- [ ] รัน `npm test` และบันทึกผลล่าสุด
- [ ] ตรวจว่า Coverage Report ตรงกับผลทดสอบล่าสุด
- [ ] ตรวจสอบ endpoint ใน `openapi.yaml` เทียบกับโค้ดจริง
- [ ] ทดสอบ Book API และ Circulation Service ร่วมกัน
- [ ] ตรวจ Frontend ว่าเรียก API จริงอย่างน้อย 3 endpoints
- [ ] ทดสอบ GET และการเปลี่ยนแปลงข้อมูลผ่าน Frontend
- [ ] ตรวจ Loading, Error และ Form Validation
- [ ] ระบุไฟล์และเลขบรรทัดสำหรับหลักฐานใน Checklist
- [ ] เตรียม Demo สดและฝึกอธิบายสถาปัตยกรรม
- [ ] ตรวจโครงสร้างโฟลเดอร์ส่งงานให้ตรงกับโจทย์
- [ ] ตรวจสอบว่าไม่มีไฟล์ลับ เช่น `.env` อยู่ในชุดส่งงาน

## 6. Expected Submission Structure

```text
project-phase3-<student-id>/
├── src/
├── frontend/
├── openapi.yaml
├── coverage-report.md
├── clo-requirements-checklist.md
├── package.json
└── package-lock.json
```

สามารถแนบไฟล์ประกอบอื่น เช่น `tests/`, `schema.sql`, `seed.sql`, `requirement.md`, `postman_collection.json` และหลักฐานการทดสอบเพิ่มเติมได้ตามความเหมาะสมและข้อกำหนดของผู้สอน

## 7. Conclusion

Checklist ฉบับนี้จัดหมวดหมู่ให้ตรงกับ Rubric Phase 3 ได้แก่ CLO8 สำหรับ Final Integration, CLO6 สำหรับ Frontend และ CLO7 สำหรับ Project Defense โดยแยกสถานะที่มีหลักฐานเบื้องต้นออกจากรายการที่ต้องตรวจสอบเพิ่มเติม

การทำเครื่องหมายว่าผ่านควรเกิดขึ้นหลังตรวจสอบโค้ดหรือทดสอบระบบจริงแล้วเท่านั้น
