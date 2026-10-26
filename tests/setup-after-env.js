// ล้าง cache ในหน่วยความจำก่อนทุกเทสต์ ไม่ให้ผลของเทสต์หนึ่งค้างไปอีกเทสต์
const cache = require("../src/cache");

beforeEach(async () => {
  await cache.invalidate("");
});
