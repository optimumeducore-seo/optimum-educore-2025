// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import StudentPage from "./pages/StudentPage";
import "./index.css";
import ParentMonthlyReport from "./pages/ParentMonthlyReport";
import ExamInputPage from "./pages/ExamInputPage";

import StudyPlanPage from "./pages/StudyPlanPage.tsx";
import TermPrintPage from "./pages/TermPrintPage.tsx";
import PortfolioPrintPage from "./pages/PortfolioPrintPage.tsx";
import ExamManagePage from "./pages/ExamManagePage.tsx";
import QrCheckInPage from "./pages/QrCheckInPage.tsx";
import QRCardsPage from "./pages/QRCardsPage.tsx";


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
  <Routes>
  <Route path="/student" element={<StudentPage />} />
  <Route path="/parent-report/:id" element={<ParentMonthlyReport />} />
  <Route path="/exam/:id" element={<ExamInputPage />} />
  <Route path="/study-plan/:id" element={<StudyPlanPage />} />
  <Route path="/study-plan/term-print/:id" element={<TermPrintPage />} />
<Route path="/study-plan/portfolio-print/:id" element={<PortfolioPrintPage />} />
<Route path="/exam-manage" element={<ExamManagePage />} />
<Route path="/qr-checkin" element={<QrCheckInPage />} />
<Route path="/qr-cards" element={<QRCardsPage />} />
  <Route path="/" element={<App />} />
</Routes>
</BrowserRouter>
  </React.StrictMode>
);
