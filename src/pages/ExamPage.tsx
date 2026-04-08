// src/pages/ExamPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";

type Role = "student" | "teacher";

export default function ExamPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const sp = new URLSearchParams(useLocation().search);

  const role: Role = (sp.get("role") === "teacher" ? "teacher" : "student");
  const isTeacher = role === "teacher";

  if (!id) return null;

  return (
    <div style={{ maxWidth: 860, margin: "24px auto", padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <b>시험페이지</b>
        <button onClick={() => nav(-1)}>돌아가기</button>
      </div>

      {/* ✅ 학생/선생 공통: 타이머/기록 자리 */}
      <div style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
          studentId: <b>{id}</b> / role: <b>{role}</b>
        </div>

        <div style={{ padding: 12, background: "#f9fafb", borderRadius: 10 }}>
          여기(공통)에 50분 타이머 + 기록 UI 넣을거임
        </div>
      </div>

      {/* ✅ 선생만: 설정 UI */}
      {isTeacher && (
        <div style={{ marginTop: 14, padding: 14, border: "1px dashed #cbd5e1", borderRadius: 12 }}>
          <b>선생님 설정 영역</b>
          <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
            여기(선생만)에 과목/시험일/D-day/스위치 같은 설정 UI 넣을거임
          </div>
        </div>
      )}
    </div>
  );
}