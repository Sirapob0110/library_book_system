import { useState } from "react";

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

const emptyForm = {
  username: "",
  password: "",
  name: "",
  email: "",
  phone: "",
};

// หน้าเข้าสู่ระบบ / สมัครสมาชิก (สมัครได้บทบาท user เท่านั้น บัญชี admin สร้างจากฐานข้อมูล)
function Login({ apiUrl, onLogin, notice }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isRegister = mode === "register";

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function switchMode(next) {
    setMode(next);
    setForm(emptyForm);
    setError("");
    setSuccess("");
  }

  async function post(path, body) {
    let response;

    try {
      response = await fetch(`${apiUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(
        "ไม่สามารถเชื่อมต่อ API ได้ กรุณาตรวจสอบว่า Backend ทำงานอยู่และ URL ถูกต้อง",
      );
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      throw new Error(
        result.message ||
          result.error ||
          `API ตอบกลับด้วย HTTP ${response.status}`,
      );
    }

    return result.data;
  }

  async function login(username, password) {
    const data = await post("/api/auth/login", { username, password });
    onLogin({ token: data.token, user: data.user });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const username = form.username.trim();

    if (!username || !form.password) {
      setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
      return;
    }

    if (isRegister) {
      if (!USERNAME_RE.test(username)) {
        setError(
          "ชื่อผู้ใช้ต้องยาว 3-30 ตัวอักษร ใช้ได้เฉพาะ A-Z a-z 0-9 และ _",
        );
        return;
      }
      if (form.password.length < 8) {
        setError("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
        return;
      }
      if (form.name.trim().length < 2) {
        setError("ชื่อ-นามสกุลต้องมีอย่างน้อย 2 ตัวอักษร");
        return;
      }
    }

    setBusy(true);

    try {
      if (isRegister) {
        await post("/api/auth/register", {
          username,
          password: form.password,
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
        });

        // สมัครสำเร็จ: กลับหน้าเข้าสู่ระบบ ใส่ชื่อผู้ใช้ให้ ผู้ใช้กรอกรหัสผ่านเข้าสู่ระบบเอง
        setMode("login");
        setForm({ ...emptyForm, username });
        setSuccess("สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านที่ตั้งไว้");
        setBusy(false);
        return;
      }

      await login(username, form.password);
    } catch (err) {
      setError(err.message || "ดำเนินการไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="panel login-panel">
        <p className="eyebrow">LIBRARY MANAGEMENT SYSTEM</p>
        <h1>
          Library<span>Hub</span>
        </h1>
        <p className="subtitle">
          {isRegister
            ? "สมัครสมาชิกเพื่อยืมและดูประวัติการยืมของคุณ"
            : "เข้าสู่ระบบเพื่อใช้งาน"}
        </p>

        {success && (
          <div className="alert success" role="status">
            ✓ {success}
          </div>
        )}

        {notice && !error && !success && (
          <div className="alert error" role="alert">
            ⚠ {notice}
          </div>
        )}

        {error && (
          <div className="alert error" role="alert">
            ⚠ {error}
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          {isRegister && (
            <>
              <label>
                ชื่อ-นามสกุล *
                <input
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  required
                  minLength={2}
                  placeholder="ชื่อ-นามสกุล"
                  autoComplete="name"
                />
              </label>

              <label>
                อีเมล *
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  required
                  placeholder="name@example.com"
                  autoComplete="email"
                />
              </label>

              <label>
                เบอร์โทรศัพท์
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="08xxxxxxxx"
                  autoComplete="tel"
                />
              </label>
            </>
          )}

          <label>
            ชื่อผู้ใช้ *
            <input
              value={form.username}
              onChange={(e) => setField("username", e.target.value)}
              required
              autoComplete="username"
              placeholder="username"
            />
          </label>

          <label>
            รหัสผ่าน *
            <input
              type="password"
              value={form.password}
              onChange={(e) => setField("password", e.target.value)}
              required
              minLength={isRegister ? 8 : undefined}
              autoComplete={isRegister ? "new-password" : "current-password"}
              placeholder={isRegister ? "อย่างน้อย 8 ตัวอักษร" : "รหัสผ่าน"}
            />
          </label>

          <button className="primary-button" type="submit" disabled={busy}>
            {busy
              ? "กำลังดำเนินการ..."
              : isRegister
                ? "สมัครสมาชิก"
                : "เข้าสู่ระบบ"}
          </button>
        </form>

        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => switchMode(isRegister ? "login" : "register")}
        >
          {isRegister
            ? "มีบัญชีอยู่แล้ว? เข้าสู่ระบบ"
            : "ยังไม่มีบัญชี? สมัครสมาชิก"}
        </button>
      </section>
    </main>
  );
}

export default Login;
