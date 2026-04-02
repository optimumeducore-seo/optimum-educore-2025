import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

export default function ExamChecklistPrintPage() {
  const [params] = useSearchParams();
  const studentId = params.get("studentId");
  const examId = params.get("examId");

  const [exam, setExam] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!studentId || !examId) {
        setError("studentId 또는 examId가 없습니다.");
        setLoading(false);
        return;
      }

      try {
        const ref = doc(db, "studentExams", studentId, "exams", examId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setError("시험 데이터를 찾을 수 없습니다.");
        } else {
          setExam(snap.data());
        }
      } catch (e) {
        console.error(e);
        setError("시험 데이터를 불러오는 중 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [studentId, examId]);

  const sortedDates = useMemo(() => {
    return Object.keys(exam?.scheduleByDate || {}).sort();
  }, [exam]);

  const periods = useMemo(() => {
    const all = sortedDates.flatMap((date) =>
      (exam?.scheduleByDate?.[date] || []).map((s: any) => Number(s.period || 0))
    );
    const uniq = Array.from(new Set(all)).filter((n) => n > 0);
    return uniq.length ? uniq.sort((a, b) => a - b) : [1, 2, 3];
  }, [exam, sortedDates]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center" }}>데이터 로드 중...</div>;
  }

  if (error) {
    return <div style={{ padding: 40, textAlign: "center", color: "#b91c1c" }}>{error}</div>;
  }

  if (!exam) {
    return <div style={{ padding: 40, textAlign: "center" }}>데이터 없음</div>;
  }

  const formatDateWithDay = (dateStr: string) => {
  const d = new Date(dateStr);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const mmdd = dateStr.split("-").slice(1).join("/");
  const day = days[d.getDay()];
  return `${mmdd}(${day})`;
};

  return (
    <div style={container}>
      <style>{printStyle}</style>

      <div className="no-print" style={actionBar}>
        <div style={{ fontWeight: 800 }}>OPTIMUM EDUCORE | 통합 마스터 리포트 시스템</div>
        <button onClick={() => window.print()} style={printBtn}>
          A4 인쇄 / PDF 저장
        </button>
      </div>

      <div style={page}>
        <div style={header}>
          <div style={headerLeft}>
            <div style={brandTag}>STUDY STAMINA MANAGEMENT</div>
            <h1 style={mainTitle}>{exam.title || "시험 체크리스트"}</h1>
          </div>
          <div style={headerRight}>
            <div style={studentBadge}>
              {exam.studentName || "-"}{" "}
              <span style={{ fontSize: "12px", fontWeight: 500 }}>학생</span>
            </div>
            <div style={examPeriod}>
              {exam.examStart || "-"} ~ {exam.examEnd || "-"}
            </div>
          </div>
        </div>

        <div style={section}>
          <div style={sectionTitle}>■ EXAM SCHEDULE (시험 시간표)</div>
          <table style={scheduleTable}>
            <thead>
              <tr>
                <th style={timeHeader}>구분</th>
               {sortedDates.map(date => (
  <th key={date} style={dateHeader}>
    {formatDateWithDay(date)}
  </th>
))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period}>
                  <td style={periodLabel}>{period}교시</td>
                  {sortedDates.map((date) => {
                    const dayList = exam?.scheduleByDate?.[date] || [];
                    const sub = dayList.find((s: any) => Number(s.period) === period);

                    return (
                      <td key={`${date}-${period}`} style={sub ? activeSubject : emptySubject}>
                        {sub?.subName || "-"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={section}>
          <div style={sectionTitle}>■ SUBJECT MASTER CHECKLIST (과목별 상세 범위 및 회독)</div>
          <table style={masterTable}>
            <thead>
              <tr>
                <th style={{ width: "10%", ...tableTh }}>과목</th>
                <th style={{ width: "32%", ...tableTh }}>시험 범위</th>
                <th style={{ width: "58%", ...tableTh }}>회독 및 완성도 체크</th>
              </tr>
            </thead>
            <tbody>
              {(exam.subjects || []).length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ ...tableTh, background: "#fff" }}>
                    등록된 과목이 없습니다.
                  </td>
                </tr>
              ) : (
                (exam.subjects || []).map((sub: any) => {
                  const ranges = sub?.ranges?.length
                    ? sub.ranges
                    : [{ big: "-", small: "범위 미입력", pages: "-", tasks: [] }];

                  const rowCount = ranges.length;

                  return ranges.map((range: any, rIdx: number) => (
                    <tr key={`${sub.key || sub.name}-${rIdx}`}>
                      {rIdx === 0 && (
                        <td rowSpan={rowCount} style={tdSubjectName}>
                          {sub.name || "-"}
                        </td>
                      )}

                      <td style={tdRangeInfo}>
                        <div style={rangeBig}>{range.big || "-"}</div>
                        <div style={rangeSmall}>
                          {range.small || "-"}{" "}
                          <span style={pageLabel}>
                            ({range.pages || "-"})
                          </span>
                        </div>
                      </td>

                      <td style={tdTaskArea}>
                        <div style={taskWrapper}>
                          {(range.tasks || []).length === 0 ? (
                            <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                              회독 항목 없음
                            </div>
                          ) : (
                            (range.tasks || []).map((task: any, tIdx: number) => (
                              <div key={tIdx} style={taskItem}>
                                <span style={taskName}>{task.label || "체크"}</span>
                                <div style={checkGroup}>
                                 {Array.from({ length: Number(task.target) || 1 }).map((_, i) => {
  const isDone = i < Number(task.done || 0);

  return (
    <div
      key={i}
      style={{
        ...checkSquare,
        background: isDone ? "#1e3a8a" : "#fff",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 900,
      }}
    >
      {isDone ? "✓" : ""}
    </div>
  );
})}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ));
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={feedbackSection}>
          <div style={feedbackLabel}>SPECIAL NOTE / TEACHER'S FEEDBACK</div>
          <div style={feedbackDisplay}></div>
        </div>

        <div style={footer}>
          "학습 지구력이 실력을 만듭니다." | OPTIMUM EDUCORE
        </div>
      </div>
    </div>
  );
}

/* ================= 디자인 가이드 (중앙 정렬 및 테두리 최적화) ================= */

const printStyle = `
  @media print {
    .no-print { display: none !important; }
    body { background: white; margin: 0; padding: 0; }
    @page { size: A4; margin: 8mm; }

    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th, td { border: 1px solid black !important; }

    html, body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }

  table { border-collapse: collapse !important; }
`;

const container: React.CSSProperties = { background: "#f1f5f9", minHeight: "100vh", padding: "20px 0" };
const actionBar: React.CSSProperties = { width: "210mm", margin: "0 auto 10px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#1e293b", color: "white", padding: "10px 20px", borderRadius: "8px" };
const page: React.CSSProperties = { width: "210mm", minHeight: "297mm", margin: "0 auto", background: "white", padding: "12mm", boxSizing: "border-box", display: "flex", flexDirection: "column", border: "1px solid #cbd5e1" };

/* 헤더 스타일 */
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "3px solid #000", paddingBottom: "10px", marginBottom: "20px" };
const headerLeft: React.CSSProperties = { display: "flex", flexDirection: "column" };
const headerRight: React.CSSProperties = { textAlign: "right" };
const brandTag: React.CSSProperties = { fontSize: "10px", fontWeight: 900, color: "#2563eb", letterSpacing: "1.5px" };
const mainTitle: React.CSSProperties = { fontSize: "24px", fontWeight: 900, margin: 0 };
const studentBadge: React.CSSProperties = { background: "#000", color: "#fff", padding: "5px 15px", borderRadius: "30px", fontSize: "16px", fontWeight: 800, marginBottom: "5px" };
const examPeriod: React.CSSProperties = { fontSize: "12px", fontWeight: 600, color: "#64748b" };

const section: React.CSSProperties = { marginBottom: "25px" };
const sectionTitle: React.CSSProperties = { fontSize: "11px", fontWeight: 900, color: "#1e3a8a", marginBottom: "8px" };

/* [수정] 시간표: 중앙 정렬 및 테두리 강화 */
const scheduleTable: React.CSSProperties = { width: "100%", borderCollapse: "collapse", border: "2px solid #000", tableLayout: "fixed" };
const timeHeader: React.CSSProperties = { background: "#1e293b", color: "white", padding: "10px", border: "1px solid #000", textAlign: "center" };
const dateHeader: React.CSSProperties = { background: "#f1f5f9", padding: "10px", fontWeight: 900, border: "1px solid #000", textAlign: "center" };
const periodLabel: React.CSSProperties = { background: "#f8fafc", fontWeight: 800, border: "1px solid #000", textAlign: "center", fontSize: "12px", height: "45px" };
const activeSubject: React.CSSProperties = { border: "1px solid #000", padding: "10px", fontSize: "16px", fontWeight: 900, color: "#1e3a8a", background: "#fff", textAlign: "center", verticalAlign: "middle" };
const emptySubject: React.CSSProperties = { border: "1px solid #000", padding: "10px", color: "#cbd5e1", textAlign: "center", verticalAlign: "middle" };

/* [수정] 마스터 테이블: 중앙 정렬 유지 */
const masterTable: React.CSSProperties = { width: "100%", borderCollapse: "collapse", border: "2px solid #000" };
const tableTh: React.CSSProperties = { border: "1px solid #000", background: "#f1f5f9", padding: "10px", fontSize: "11px", fontWeight: 900, textAlign: "center" };
const tdSubjectName: React.CSSProperties = { border: "1px solid #000", textAlign: "center", fontSize: "18px", fontWeight: 900, background: "#fff", verticalAlign: "middle" };
const tdRangeInfo: React.CSSProperties = { border: "1px solid #000", padding: "10px", verticalAlign: "middle" };
const tdTaskArea: React.CSSProperties = { border: "1px solid #000", padding: "10px", verticalAlign: "middle" };

const rangeBig: React.CSSProperties = { fontSize: "12px", fontWeight: 800, color: "#000" };
const rangeSmall: React.CSSProperties = { fontSize: "11px", color: "#64748b" };
const pageLabel: React.CSSProperties = { color: "#2563eb", fontWeight: 800 };

const taskWrapper: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "8px 15px" };
const taskItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: "6px" };
const taskName: React.CSSProperties = { fontSize: "11px", fontWeight: 700, color: "#334155" };
const checkGroup: React.CSSProperties = { display: "flex", gap: "3px" };
const checkSquare: React.CSSProperties = { width: "14px", height: "14px", border: "1.5px solid #1e3a8a", background: "#fff", borderRadius: "2px" };

const feedbackSection: React.CSSProperties = { marginTop: "auto" };
const feedbackLabel: React.CSSProperties = { fontSize: "10px", fontWeight: 900, color: "#94a3b8", marginBottom: "5px" };
const feedbackDisplay: React.CSSProperties = { width: "100%", height: "60px", border: "1px solid #cbd5e1", borderRadius: "4px" };
const footer: React.CSSProperties = { textAlign: "center", fontSize: "10px", color: "#cbd5e1", paddingTop: "15px" };
const printBtn: React.CSSProperties = { padding: "8px 18px", background: "#2563eb", color: "white", border: "none", borderRadius: "6px", fontWeight: 800, cursor: "pointer" };