// src/components/BridgeMockExamSection.tsx
import React, { useEffect, useState } from "react";
import { loadMockExams } from "../services/firestore";
import ExamDetailModal from "./ExamDetailModal";

type ExamGroup = {
  key: string;
  attempt: number;
  examYear: number;
  examMonth: number;
  subjects: Record<string, any>;
};

export default function BridgeMockExamSection({ studentId }: { studentId: string }) {
  const [groups, setGroups] = useState<ExamGroup[]>([]);
  const [activeExam, setActiveExam] = useState<ExamGroup | null>(null);

  useEffect(() => {
    if (!studentId) return;

    (async () => {
      const list: any[] = await loadMockExams(studentId);

      const map: Record<string, ExamGroup> = {};

      list.forEach((item: any) => {
        const key = `${item.examYear}-${item.examMonth}-${item.attempt}`;

        if (!map[key]) {
          map[key] = {
            key,
            attempt: item.attempt,
            examYear: item.examYear,
            examMonth: item.examMonth,
            subjects: {},
          };
        }

        map[key].subjects[item.subject] = {
          examYear: item.examYear,
          examMonth: item.examMonth,
          totalScore: item.totalScore,
          correctCount: item.correctCount,
          wrongCount: item.wrongCount,
          grade: item.grade || item.avg || null,
          perQuestionScore: item.perQuestionScore || {},
        };
      });

      const result = Object.values(map).sort((a, b) => a.attempt - b.attempt);
      setGroups(result);
    })();
  }, [studentId]);

  if (!groups.length) return null;

  return (
    <div style={{ marginTop: 40 }}>
      <h2 style={{ fontWeight: 900, marginBottom: 20 }}>브릿지 모의고사 분석</h2>

      {groups.map((exam: ExamGroup, idx: number) => (
        <div
          key={idx}
          style={{
            marginBottom: 30,
            padding: 20,
            background: "#FBFAF7",
            border: "1px solid #E7DCC9",
            borderRadius: 12,
          }}
        >
          <h3 style={{ marginBottom: 12, fontWeight: 800 }}>
            {exam.examYear}년 {exam.examMonth}월 — {exam.attempt}회
          </h3>

          <table
  style={{
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
    textAlign: "center",  // ★ 여기 추가
  }}
>
            <thead>
              <tr style={{ background: "#F0ECE6" }}>
                <th style={{ padding: 8, border: "1px solid #ddd" }}>과목</th>
                <th style={{ padding: 8, border: "1px solid #ddd" }}>맞힌개수</th>
                <th style={{ padding: 8, border: "1px solid #ddd" }}>틀린개수</th>
                <th style={{ padding: 8, border: "1px solid #ddd" }}>점수</th>
                <th style={{ padding: 8, border: "1px solid #ddd" }}>등급</th>
                <th style={{ padding: 8, border: "1px solid #ddd" }}>분석</th>
              </tr>
            </thead>

            <tbody>
              {Object.entries(exam.subjects).map(([sub, data]: any) => (
                <tr key={sub}>
                  <td style={{ padding: 8, border: "1px solid #eee" }}>{sub}</td>
                  <td style={{ padding: 8, border: "1px solid #eee" }}>
                    {data.correctCount}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #eee" }}>
                    {data.wrongCount}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #eee" }}>
                    {data.totalScore}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #eee" }}>
                    {data.grade ?? "-"}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      border: "1px solid #eee",
                      textAlign: "center",
                    }}
                  >
                    <button
  onClick={() =>
    setActiveExam({
      ...exam,
      subjects: { [sub]: data },
    })
  }
  style={{
    padding: "4px 10px",
    fontSize: 11,
    borderRadius: 6,
    background: "#F3F4F6",
    border: "1px solid #D4D4D8",
    cursor: "pointer",
    fontWeight: 600,
    color: "#4B5563",
    transition: "0.15s",
    textAlign: "center",
  }}
>
  상세
</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {activeExam && (
        <ExamDetailModal
          tab={"mock"}
          term={`${activeExam.examYear}.${activeExam.examMonth}`}
          exam={activeExam}
          onClose={() => setActiveExam(null)}
        />
      )}
    </div>
  );
}