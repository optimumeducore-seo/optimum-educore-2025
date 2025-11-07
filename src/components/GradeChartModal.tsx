// src/components/GradeChartModal.tsx
import React from "react";

type GradeChartModalProps = {
  onClose: () => void;
  grades: Record<string, { score: number; level: number; avg: number }>;
};

export default function GradeChartModal({ onClose, grades }: GradeChartModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 600,
          background: "white",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          padding: 24,
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>학년별 성적표 (미리보기)</h2>
        <pre style={{ background: "#f7f7f7", padding: 12, borderRadius: 8 }}>
{JSON.stringify(grades, null, 2)}
        </pre>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={{ background: "#4caf50", color: "white", padding: "6px 10px", borderRadius: 6 }}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}