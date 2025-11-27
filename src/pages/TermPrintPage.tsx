// src/pages/TermPrintPage.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

type TaskItem = { text: string; done: boolean };
type DayPlan = {
  date: string;
  teacherTasks?: TaskItem[];
  studentPlans?: TaskItem[];
  memo?: string;
  done?: boolean;
};

export default function TermPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [plans, setPlans] = useState<Record<string, DayPlan>>({});
  const [studentName, setStudentName] = useState("");

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      // 🔥 studyPlans/{id}/days
      const daysCol = collection(db, "studyPlans", id, "days");
      const snap = await getDocs(daysCol);

      const map: Record<string, DayPlan> = {};

      snap.forEach((d) => {
        const raw = d.data() as any;
        map[d.id] = { date: d.id, ...raw };
      });

      setPlans(map);

      // 학생 이름 가져오기
      const studentSnap = await getDocs(collection(db, "students"));
      studentSnap.forEach((s) => {
        if (s.id === id) setStudentName((s.data() as any).name || "");
      });
    };

    load();
  }, [id]);

  const dates = Object.keys(plans).sort();
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

  const getColor = (date: string) => {
    const idx = new Date(date).getDay();
    return ["#fee2e2", "#fef9c3", "#dcfce7", "#dbeafe", "#ede9fe", "#fce7f3", "#ffe4e6"][idx];
  };

  return (
    <div style={pageWrap}>
      {/* 인쇄 버튼 : 실제 인쇄 시 제거됨 */}
      <button onClick={() => window.print()} style={printBtn} className="no-print">
        🖨️ 인쇄하기
      </button>

      {/* 헤더 영역 */}
      <div style={headerBox}>
        <div style={logo}>OPTIMUM EDUCORE</div>
        <div style={mainTitle}>텀 학습 스케줄러</div>
        <div style={subTitle}>학생: {studentName || "○○"} / 기간별 학습 관리표</div>
      </div>

      {/* 출력 테이블 */}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={leftHeader}>구분</th>
            {dates.map((d) => {
              const dayIdx = new Date(d).getDay();
              return (
                <th key={d} style={{ ...topHeader, background: getColor(d) }}>
                  {d.slice(5).replace("-", "/")}
                  <div style={{ fontSize: 11, color: "#444" }}>
                    ({weekdays[dayIdx]})
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {/* 내 공부 계획 */}
          <tr>
            <td style={leftCol}>내 공부 계획</td>
            {dates.map((d) => {
              const items = (plans[d]?.studentPlans || []).map((t) => "• " + t.text);
              return (
                <td key={d} style={cell}>
                  {items.join("\n") || "-"}
                </td>
              );
            })}
          </tr>

          {/* 선생님 과제 */}
          <tr>
            <td style={leftCol}>선생님 과제</td>
            {dates.map((d) => {
              const items = (plans[d]?.teacherTasks || []).map((t) => "• " + t.text);
              return (
                <td key={d} style={cell}>
                  {items.join("\n") || "-"}
                </td>
              );
            })}
          </tr>

          {/* 메모 */}
          <tr>
            <td style={leftCol}>메모</td>
            {dates.map((d) => (
              <td key={d} style={cellMemo}>
                {plans[d]?.memo?.slice(0, 50) || ""}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* 인쇄 전용 스타일 */}
      <style>{`
        @media print {
          .no-print { display: none; }
          body { -webkit-print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

/* ---------------------- STYLE ---------------------- */

const pageWrap: React.CSSProperties = {
  padding: "40px",
  maxWidth: "1200px",
  margin: "0 auto",
  fontFamily: "Pretendard, sans-serif",
  color: "#111827",
};

const printBtn: React.CSSProperties = {
  padding: "10px 14px",
  background: "#4f46e5",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  marginBottom: 25,
  fontSize: 14,
};

const headerBox: React.CSSProperties = {
  textAlign: "center",
  marginBottom: 30,
};

const logo: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: "#4f46e5",
  marginBottom: 6,
  letterSpacing: "1px",
};

const mainTitle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 900,
  marginBottom: 6,
};

const subTitle: React.CSSProperties = {
  fontSize: 14,
  color: "#6b7280",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed",
  fontSize: 13,
  whiteSpace: "pre-line",
};

const topHeader: React.CSSProperties = {
  padding: "8px 4px",
  border: "1px solid #d1d5db",
  fontWeight: 700,
  fontSize: 12,
};

const leftHeader: React.CSSProperties = {
  padding: "8px 4px",
  border: "1px solid #d1d5db",
  background: "#e0e7ff",
  width: 110,
  fontWeight: 700,
};

const leftCol: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  padding: "8px 4px",
  background: "#fef3c7",
  fontWeight: 700,
  verticalAlign: "top",
};

const cell: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  padding: "6px 4px",
  verticalAlign: "top",
  minHeight: 60,
  background: "#fff",
  whiteSpace: "pre-line",
};

const cellMemo: React.CSSProperties = {
  ...cell,
  color: "#6b7280",
  fontSize: 12,
};