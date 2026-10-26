// รันก่อนทุกไฟล์ทดสอบ: ไม่ให้ .env หรือตัวแปรในเครื่องของผู้รันมีผลต่อผลทดสอบและค่า coverage
// (ผลลัพธ์จึงเท่ากันทุกเครื่อง)
jest.mock("dotenv", () => ({ config: jest.fn() }));

[
  "PORT",
  "CIRCULATION_PORT",
  "FRONTEND_ORIGIN",
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "EXTERNAL_API_BASE_URL",
  "EXTERNAL_API_TIMEOUT_MS",
  "EXTERNAL_API_RETRIES",
  "EXTERNAL_API_BACKOFF_MS",
].forEach((key) => delete process.env[key]);
