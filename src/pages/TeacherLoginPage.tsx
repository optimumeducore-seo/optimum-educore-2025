import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";

const MAX_FAIL = 5;
const LOCK_MINUTES = 10;

export default function TeacherLoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");

  const failCount = Number(sessionStorage.getItem("teacher_fail_count") || "0");
  const lockUntil = Number(sessionStorage.getItem("teacher_lock_until") || "0");

  const locked = useMemo(() => Date.now() < lockUntil, [lockUntil]);
  const remainMin = locked
    ? Math.ceil((lockUntil - Date.now()) / 1000 / 60)
    : 0;

  const handleLogin = async () => {
    if (locked) {
      setError(`잠시 잠겼습니다. ${remainMin}분 후 다시 시도하세요.`);
      return;
    }

    try {
      const res = await signInWithEmailAndPassword(auth, email.trim(), pw);

      localStorage.setItem("teacher_gate_ok", "ok");
      localStorage.setItem("teacher_email", res.user.email || "");

      sessionStorage.removeItem("teacher_fail_count");
      sessionStorage.removeItem("teacher_lock_until");

      navigate("/study-plan/dashboard", { replace: true });
    } catch (e) {
      const nextFail = failCount + 1;
      sessionStorage.setItem("teacher_fail_count", String(nextFail));

      if (nextFail >= MAX_FAIL) {
        const until = Date.now() + LOCK_MINUTES * 60 * 1000;
        sessionStorage.setItem("teacher_lock_until", String(until));
        setError(`로그인 ${MAX_FAIL}회 실패. ${LOCK_MINUTES}분 잠금됩니다.`);
        return;
      }

      setError(`이메일 또는 비밀번호가 틀렸습니다. (${nextFail}/${MAX_FAIL})`);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F8FAFC",
        padding: 24,
      }}
    >
      <div
        style={{
          width: 360,
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 900, color: "#1F2937" }}>
          선생님 로그인
        </div>

        <div style={{ marginTop: 8, fontSize: 13, color: "#6B7280" }}>
          관리자 기능은 로그인 후 이용할 수 있습니다.
        </div>

        <input
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleLogin();
          }}
          placeholder="이메일 입력"
          style={{
            width: "100%",
            marginTop: 18,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #D1D5DB",
            fontSize: 14,
            outline: "none",
          }}
        />

        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleLogin();
          }}
          placeholder="비밀번호 입력"
          style={{
            width: "100%",
            marginTop: 12,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #D1D5DB",
            fontSize: 14,
            outline: "none",
          }}
        />

        {error && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "#B91C1C",
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          style={{
            width: "100%",
            marginTop: 16,
            height: 44,
            borderRadius: 10,
            border: "none",
            background: "#1D4ED8",
            color: "#fff",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          로그인
        </button>
      </div>
    </div>
  );
}