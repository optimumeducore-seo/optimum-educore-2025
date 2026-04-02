// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { registerSW } from "./registerServiceWorker";

if (import.meta.env.PROD) {
  registerSW();
}
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
import StudyPlanDashboardPage from "./pages/StudyPlanDashboardPage";
import BookManagePage from "./pages/BookManagePage.tsx";
import AutoBookAssignPage from "./pages/AutoBookAssignPage.tsx";
import ParentLaunchPage from "./pages/ParentLaunchPage";
import ParentInstallPage from "./pages/ParentInstallPage";
import TeacherLoginPage from "./pages/TeacherLoginPage";
import PrivateRoute from "./components/PrivateRoute";
import DevWatermark from "./components/DevWatermark";;
import ExamChecklistPrintPage from "./pages/ExamChecklistPrintPage";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
  <Routes>
  <Route path="/student" element={<StudentPage />} />
  <Route path="/parent-report/:id" element={<ParentMonthlyReport />} />
  <Route path="/parent-launch" element={<ParentLaunchPage />} />
  <Route path="/parent-install" element={<ParentInstallPage />} />
  <Route
  path="/exam/:id"
  element={
    <PrivateRoute>
      <ExamInputPage />
    </PrivateRoute>
  }
/>
  <Route path="/study-plan/:id" element={<StudyPlanPage />} />
<Route path="/exam-checklist-print" element={<ExamChecklistPrintPage />} />
<Route path="/study-plan/term-print/:studentId/:examId" element={<TermPrintPage />} />
<Route path="/study-plan/portfolio-print/:id" element={<PortfolioPrintPage />} />
<Route
  path="/exam-manage"
  element={
    <PrivateRoute>
      <ExamManagePage />
    </PrivateRoute>
  }
/>
<Route path="/qr-checkin" element={<QrCheckInPage />} />
<Route path="/qr-cards" element={<QRCardsPage />} />

<Route path="/teacher-login" element={<TeacherLoginPage />} />

  <Route
  path="/books"
  element={
    <PrivateRoute>
      <BookManagePage />
    </PrivateRoute>
  }
/>
  <Route
  path="/study-plan/dashboard"
  element={
    <PrivateRoute>
      <StudyPlanDashboardPage />
    </PrivateRoute>
  }
/>
  <Route
  path="/auto-assign"
  element={
    <PrivateRoute>
      <AutoBookAssignPage />
    </PrivateRoute>
  }
/>
  <Route
  path="/"
  element={
    <PrivateRoute>
      <App />
    </PrivateRoute>
  }
/>
</Routes>
</BrowserRouter>
  </React.StrictMode>
);
