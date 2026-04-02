import React, { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import DevWatermark from "../components/DevWatermark";

type Props = {
  children: React.ReactElement;
};

export default function PrivateRoute({ children }: Props) {
  const ok =
    typeof window !== "undefined" &&
    localStorage.getItem("teacher_gate_ok") === "ok";

  useEffect(() => {
    if (!ok) return;

    let timer: ReturnType<typeof setTimeout>;

    const doLogout = async () => {
      try {
        await signOut(auth);
      } catch (e) {
        console.error("자동 로그아웃 실패:", e);
      }

      localStorage.removeItem("teacher_gate_ok");
      localStorage.removeItem("teacher_email");
      sessionStorage.removeItem("teacher_fail_count");
      sessionStorage.removeItem("teacher_lock_until");

      alert("30분 동안 활동이 없어 자동 로그아웃됩니다.");
      window.location.href = "/teacher-login";
    };

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(doLogout, 30 * 60 * 1000); // 30분
    };

    resetTimer();

    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("click", resetTimer);
    window.addEventListener("scroll", resetTimer);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("click", resetTimer);
      window.removeEventListener("scroll", resetTimer);
    };
  }, [ok]);

  if (!ok) {
    return <Navigate to="/teacher-login" replace />;
  }

  return (
    <>
      <DevWatermark />
      {children}
    </>
  );
}