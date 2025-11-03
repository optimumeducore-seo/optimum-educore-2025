import React from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../firebase";

export function GradeModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [scores, setScores] = React.useState({
    date: new Date().toISOString().slice(0, 10),
    korean: 0,
    english: 0,
    math: 0,
    science: 0,
  });

  const saveGrade = async () => {
    await addDoc(collection(db, "students", studentId, "grades"), scores);
    alert("성적이 저장되었습니다!");
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
    >
      <div style={{ background: "#fff", padding: 20, borderRadius: 12, width: 350 }}>
        <h3>📘 성적 입력</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {["korean", "english", "math", "science"].map((subject) => (
            <div key={subject}>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{subject}</div>
              <input
                type="number"
                min="0"
                max="100"
                style={{
                  width: "100%",
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  padding: "6px 8px",
                }}
                value={(scores as any)[subject]}
                onChange={(e) =>
                  setScores({ ...scores, [subject]: Number(e.target.value) })
                }
              />
            </div>
          ))}
        </div>
        <button onClick={saveGrade} style={{ marginTop: 16 }}>
          저장
        </button>
        <button onClick={onClose} style={{ marginLeft: 8 }}>
          닫기
        </button>
      </div>
    </div>
  );
}