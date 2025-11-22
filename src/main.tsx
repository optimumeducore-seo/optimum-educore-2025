// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import StudentPage from "./pages/StudentPage";
import "./index.css";
import ParentMonthlyReport from "./pages/ParentMonthlyReport";
import ExamInputPage from "./pages/ExamInputPage";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
  <Routes>
    <Route path="/student" element={<StudentPage />} />
    <Route path="/parent-report/:id" element={<ParentMonthlyReport />} />
    <Route path="/" element={<App />} />
    <Route path="/exam/:id" element={<ExamInputPage />} />
  </Routes>
</BrowserRouter>
  </React.StrictMode>
);
