import { useEffect, useState } from "react";
import "./App.css";
import Login from "./Login";
import Dashboard from "./Dashboard";
import { logout as logoutRequest, refreshSession, setSessionLostHandler } from "./api";
import { readResetToken } from "./format";

// ครอบด้วยการตรวจสถานะเข้าสู่ระบบ
// ตอนเปิดหน้า: ลองกู้เซสชันจาก refresh cookie (access token อยู่ในหน่วยความจำ จึงหายเมื่อรีโหลด)
function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(() => !readResetToken());
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSessionLostHandler((reason) => {
      setNotice(typeof reason === "string" ? reason : "");
      setSession(null);
    });
    return () => setSessionLostHandler(null);
  }, []);

  useEffect(() => {
    if (!booting) return undefined;
    let active = true;

    refreshSession()
      .then((data) => {
        if (active && data) setSession({ user: data.user });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setBooting(false);
      });

    return () => {
      active = false;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogin(next) {
    setNotice("");
    setSession(next);
  }

  async function handleLogout(reason) {
    await logoutRequest();
    setNotice(typeof reason === "string" ? reason : "");
    setSession(null);
  }

  if (booting) {
    return (
      <main className="login-shell">
        <div className="loading" role="status">กำลังตรวจสอบการเข้าสู่ระบบ...</div>
      </main>
    );
  }

  if (!session) {
    return <Login onLogin={handleLogin} notice={notice} />;
  }

  // key ทำให้สลับผู้ใช้แล้ว state ของหน้าหลักถูกล้างใหม่ทั้งหมด
  return <Dashboard key={session.user.user_id} session={session} onLogout={handleLogout} />;
}

export default App;
