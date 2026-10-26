// ทดสอบตัวจัดการข้อผิดพลาดกลาง (Lab 4) โดยตรง
const { notFound, errorHandler } = require("../src/middlewares/errors");

function fakeRes() {
  const res = { headersSent: false };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe("errorHandler", () => {
  beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test("notFound ตอบ 404 ROUTE_NOT_FOUND", () => {
    const res = fakeRes();

    notFound({}, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe("ROUTE_NOT_FOUND");
  });

  test("error ที่มี status < 500 ใช้ status และข้อความของ error นั้น", () => {
    const res = fakeRes();

    errorHandler(Object.assign(new Error("ไม่มีสิทธิ์"), { status: 403, code: "NO_ACCESS" }), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "ไม่มีสิทธิ์",
      error: "ไม่มีสิทธิ์",
      code: "NO_ACCESS",
    });
  });

  test("error 4xx ที่ไม่มี code ใช้ REQUEST_ERROR (อ่านจาก statusCode ได้)", () => {
    const res = fakeRes();

    errorHandler(Object.assign(new Error("bad"), { statusCode: 422 }), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].code).toBe("REQUEST_ERROR");
  });

  test("error 5xx หรือไม่ทราบสถานะ ตอบ 500 ทั่วไปและบันทึก log ไม่เปิดเผยข้อความจริง", () => {
    const res = fakeRes();

    errorHandler(new Error("db password is hunter2"), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain("hunter2");
    expect(res.json.mock.calls[0][0].code).toBe("INTERNAL_SERVER_ERROR");
    expect(console.error).toHaveBeenCalled();
  });

  test("ตอบไปแล้ว (headersSent) ส่งต่อให้ตัวจัดการเริ่มต้นของ Express", () => {
    const res = fakeRes();
    res.headersSent = true;
    const next = jest.fn();
    const err = new Error("late");

    errorHandler(err, {}, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});
