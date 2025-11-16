// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import StudentPage from "./pages/StudentPage";
import "./index.css";
import ParentMonthlyReport from "./pages/ParentMonthlyReport";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
  <Routes>
    {/* 학생별 페이지 */}
    <Route path="/student" element={<StudentPage />} />

    {/* 부모 월간 보고서 */}
    <Route path="/parent-report/:id" element={<ParentMonthlyReport />} />

    {/* 관리자용 기본 화면 */}
    <Route path="/" element={<App />} />
  </Routes>
</BrowserRouter>
  </React.StrictMode>
);

// ✅ 개발(HMR)에서는 서비스워커 등록 금지, 기존 것 있으면 해제
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js");
    });
  } else {
    navigator.serviceWorker
      .getRegistrations()
      .then((rs) => rs.forEach((r) => r.unregister()));
  }
}