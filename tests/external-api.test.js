// tests/external-api.test.js
// ทดสอบ src/services/external-api.js: Timeout, Retry (exponential backoff) และ Fallback
// จำลอง axios ทั้งหมด จึงไม่ต้องต่ออินเทอร์เน็ตและไม่ต้องรอเวลาจริง

jest.mock("axios");

const axios = require("axios");
const { lookupBookByIsbn, config } = require("../src/services/external-api");

const ISBN = "9780747532699";

// สร้าง error เลียนแบบที่ axios โยนออกมา
const httpError = (status) => Object.assign(new Error(`status ${status}`), { response: { status } });
const codeError = (code) => Object.assign(new Error(code), { code });

const openLibraryBody = (info) => ({ data: { [`ISBN:${ISBN}`]: info } });

describe("external-api (Open Library)", () => {
  let delays;

  beforeEach(() => {
    jest.resetAllMocks();

    // ตั้งค่าให้คงที่ ไม่ขึ้นกับไฟล์ .env ของผู้รันทดสอบ
    config.baseUrl = "https://openlibrary.org";
    config.timeoutMs = 3000;
    config.retries = 2;
    config.backoffMs = 300;

    // ข้ามการรอจริง แต่เก็บค่าเวลาที่ขอรอไว้ตรวจสอบ
    delays = [];
    jest.spyOn(global, "setTimeout").mockImplementation((fn, ms) => {
      delays.push(ms);
      fn();
      return 0;
    });

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("เรียกสำเร็จ", () => {
    test("สำเร็จครั้งแรก: คืนข้อมูลจาก open-library, attempts = 1, ไม่รอ", async () => {
      axios.get.mockResolvedValueOnce(
        openLibraryBody({
          title: "Harry Potter and the Philosopher's Stone",
          publishers: [{ name: "Bloomsbury Publishing" }],
          publish_date: "1997",
          number_of_pages: 223,
          cover: { medium: "https://covers.example/m.jpg", small: "https://covers.example/s.jpg" },
          url: "https://openlibrary.org/books/OL1M",
        }),
      );

      const result = await lookupBookByIsbn(ISBN);

      expect(result).toEqual({
        source: "open-library",
        found: true,
        attempts: 1,
        external: {
          title: "Harry Potter and the Philosopher's Stone",
          publishers: ["Bloomsbury Publishing"],
          publish_date: "1997",
          number_of_pages: 223,
          cover_url: "https://covers.example/m.jpg",
          url: "https://openlibrary.org/books/OL1M",
        },
      });
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(delays).toEqual([]);
    });

    test("ส่งพารามิเตอร์และ timeout ไปยัง Open Library ถูกต้อง", async () => {
      axios.get.mockResolvedValueOnce(openLibraryBody({ title: "x" }));

      await lookupBookByIsbn(ISBN);

      expect(axios.get).toHaveBeenCalledWith("https://openlibrary.org/api/books", {
        params: { bibkeys: `ISBN:${ISBN}`, format: "json", jscmd: "data" },
        timeout: 3000,
      });
    });

    test("ใช้ปกขนาดเล็กเมื่อไม่มีขนาดกลาง", async () => {
      axios.get.mockResolvedValueOnce(openLibraryBody({ cover: { small: "https://covers.example/s.jpg" } }));

      const result = await lookupBookByIsbn(ISBN);

      expect(result.external.cover_url).toBe("https://covers.example/s.jpg");
    });

    test("ฟิลด์ที่ไม่มีในต้นทางถูกแทนด้วย null / อาร์เรย์ว่าง", async () => {
      axios.get.mockResolvedValueOnce(openLibraryBody({}));

      const result = await lookupBookByIsbn(ISBN);

      expect(result.found).toBe(true);
      expect(result.external).toEqual({
        title: null,
        publishers: [],
        publish_date: null,
        number_of_pages: null,
        cover_url: null,
        url: null,
      });
    });

    test("API ตอบปกติแต่ไม่พบ ISBN: found = false และไม่ใช่ fallback", async () => {
      axios.get.mockResolvedValueOnce({ data: {} });

      const result = await lookupBookByIsbn(ISBN);

      expect(result).toMatchObject({
        source: "open-library",
        found: false,
        attempts: 1,
        external: null,
      });
      expect(result.message).toContain("ไม่พบข้อมูล");
      expect(axios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("Retry", () => {
    test("ล้มเหลว 2 ครั้ง (HTTP 503) แล้วสำเร็จครั้งที่ 3: attempts = 3", async () => {
      axios.get
        .mockRejectedValueOnce(httpError(503))
        .mockRejectedValueOnce(httpError(503))
        .mockResolvedValueOnce(openLibraryBody({ title: "Recovered" }));

      const result = await lookupBookByIsbn(ISBN);

      expect(result.source).toBe("open-library");
      expect(result.attempts).toBe(3);
      expect(result.external.title).toBe("Recovered");
      expect(axios.get).toHaveBeenCalledTimes(3);
    });

    test("รอแบบ exponential backoff: 300 ms แล้ว 600 ms", async () => {
      axios.get.mockRejectedValue(httpError(500));

      await lookupBookByIsbn(ISBN);

      expect(delays).toEqual([300, 600]);
    });

    test("ปรับ backoff ผ่าน config ได้", async () => {
      config.backoffMs = 100;
      axios.get.mockRejectedValue(httpError(500));

      await lookupBookByIsbn(ISBN);

      expect(delays).toEqual([100, 200]);
    });

    test("retries = 0: เรียกครั้งเดียวและไม่รอ", async () => {
      config.retries = 0;
      axios.get.mockRejectedValue(httpError(500));

      const result = await lookupBookByIsbn(ISBN);

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(result.attempts).toBe(1);
      expect(delays).toEqual([]);
    });

    test("ไม่ retry เมื่อได้ HTTP 4xx (ความผิดของ request)", async () => {
      axios.get.mockRejectedValue(httpError(404));

      const result = await lookupBookByIsbn(ISBN);

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(result.source).toBe("fallback");
      expect(result.attempts).toBe(1);
      expect(result.fallback_reason).toBe("HTTP 404");
      expect(delays).toEqual([]);
    });
  });

  describe("Timeout", () => {
    test("timeout ทุกครั้ง: ลองครบ 3 ครั้ง แล้ว fallback พร้อมสาเหตุ timeout", async () => {
      axios.get.mockRejectedValue(codeError("ECONNABORTED"));

      const result = await lookupBookByIsbn(ISBN);

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(result.source).toBe("fallback");
      expect(result.attempts).toBe(3);
      expect(result.fallback_reason).toBe("timeout (>3000ms)");
    });

    test("รองรับรหัส ETIMEDOUT และใช้ค่า timeout จาก config ในข้อความ", async () => {
      config.timeoutMs = 1;
      axios.get.mockRejectedValue(codeError("ETIMEDOUT"));

      const result = await lookupBookByIsbn(ISBN);

      expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 1 }));
      expect(result.fallback_reason).toBe("timeout (>1ms)");
    });
  });

  describe("Fallback", () => {
    test("HTTP 500 ทุกครั้ง: คืน fallback ครบทุกฟิลด์", async () => {
      axios.get.mockRejectedValue(httpError(500));

      const result = await lookupBookByIsbn(ISBN);

      expect(result).toEqual({
        source: "fallback",
        found: false,
        attempts: 3,
        external: null,
        message: expect.stringContaining("ไม่สามารถดึงข้อมูลเพิ่มเติมจาก Open Library"),
        fallback_reason: "HTTP 500",
      });
      expect(axios.get).toHaveBeenCalledTimes(3);
    });

    test("DNS ล้มเหลว (ENOTFOUND): retry ครบแล้ว fallback", async () => {
      axios.get.mockRejectedValue(codeError("ENOTFOUND"));

      const result = await lookupBookByIsbn(ISBN);

      expect(result.source).toBe("fallback");
      expect(result.attempts).toBe(3);
      expect(result.fallback_reason).toBe("ENOTFOUND");
    });

    test("ปฏิเสธการเชื่อมต่อ (ECONNREFUSED): retry ครบแล้ว fallback", async () => {
      axios.get.mockRejectedValue(codeError("ECONNREFUSED"));

      const result = await lookupBookByIsbn(ISBN);

      expect(result.fallback_reason).toBe("ECONNREFUSED");
      expect(axios.get).toHaveBeenCalledTimes(3);
    });

    test("error ที่ไม่มีรหัส: ใช้ข้อความของ error เป็นสาเหตุ", async () => {
      axios.get.mockRejectedValue(new Error("socket hang up"));

      const result = await lookupBookByIsbn(ISBN);

      expect(result.source).toBe("fallback");
      expect(result.fallback_reason).toBe("socket hang up");
    });

    test("ไม่โยน error ออกไปให้ผู้เรียก ไม่ว่าล้มเหลวแบบใด", async () => {
      axios.get.mockRejectedValue(httpError(502));

      await expect(lookupBookByIsbn(ISBN)).resolves.toMatchObject({ source: "fallback" });
    });

    test("บันทึก log ของแต่ละครั้งที่ลองและเมื่อล้มเหลวครบ", async () => {
      axios.get.mockRejectedValue(httpError(500));

      await lookupBookByIsbn(ISBN);

      // warn: ล้มเหลว 3 ครั้ง + รอ 2 ครั้ง
      expect(console.warn).toHaveBeenCalledTimes(5);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("attempt 1/3 ล้มเหลว: HTTP 500"));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("ล้มเหลวหลัง retry ครบ (3 ครั้ง)"));
    });
  });
});
