# Code Coverage Report

## 1. Objective

รายงานนี้จัดทำขึ้นเพื่อสรุปผลการทดสอบ Book API ด้วย Jest และ Supertest รวมถึงประเมินความครอบคลุมของโค้ดจากรายงาน Code Coverage

## 2. Test Results

- Test framework: Jest
- HTTP testing library: Supertest
- Test command: `npm test`
- Test suites passed: 1/1
- Tests passed: 40/40
- Tests failed: 0

## 3. Code Coverage Summary

| Metric | Coverage |
|---|---:|
| Statements | 96.05% |
| Branches | 86.00% |
| Functions | 94.73% |
| Lines | 96.52% |

## 4. Test Coverage Areas

ชุดทดสอบครอบคลุมการทำงานหลักของ Book API ดังนี้

- GET รายการหนังสือและค้นหาหนังสือ
- GET รายละเอียดหนังสือและหมวดหมู่
- POST เพิ่มหนังสือ พร้อมตรวจสอบข้อมูล
- PUT แก้ไขหนังสือและจัดการหมวดหมู่
- DELETE ลบหนังสือ
- GET ข้อมูลเพิ่มเติมจาก Open Library
- GET และ POST ผู้แต่ง
- GET หนังสือของผู้แต่ง
- GET และ POST หมวดหมู่
- ทดสอบกรณีไม่พบข้อมูล ข้อมูลไม่ถูกต้อง และข้อผิดพลาดจากฐานข้อมูล
- ตรวจสอบการ commit, rollback และ release ของ database transaction ในกรณีที่ทดสอบไว้

## 5. Remaining Uncovered Code

จากผล Jest ยังมีบางบรรทัดที่ไม่ได้ถูกเรียกผ่านชุดทดสอบ โดยรายงานระบุบรรทัด 356 และ 397–401 ใน `src/index.js`

ส่วนเริ่มต้นเซิร์ฟเวอร์ที่ทำงานภายใต้เงื่อนไข `require.main === module` อาจไม่ได้ถูกรันระหว่างการทดสอบที่ import Express app โดยตรง ทั้งนี้ควรตรวจสอบรายละเอียดจาก `coverage/index.html` ประกอบ

## 6. Conclusion

ผลการทดสอบล่าสุดผ่านทั้งหมด 40 tests โดยมี Statement Coverage 96.05%, Branch Coverage 86.00%, Function Coverage 94.73% และ Line Coverage 96.52%

ผลดังกล่าวแสดงว่าชุดทดสอบครอบคลุมการทำงานหลักและกรณีข้อผิดพลาดหลายส่วนของ Book API อย่างไรก็ตาม Code Coverage เป็นตัวชี้วัดว่ามีโค้ดส่วนใดถูกรันระหว่างการทดสอบ ไม่ได้ยืนยันว่าไม่มีข้อผิดพลาดทั้งหมดในระบบ
