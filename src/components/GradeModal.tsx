// src/components/GradeModal.tsx
import React, { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { loadGrade, saveGrade } from "../services/firestore";

interface GradeModalProps {
  studentId: string;
  gradeLevel: string;
  onClose: () => void;
}

const subjects = [
  "국어",
  "영어",
  "수학",
  "과학",
  "역사",
  "도덕",
  "기술가정",
  "한문",
  "일본어",
];

const termOptions = {
  중1: ["2학기 중간", "2학기 기말"],
  중2: ["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말"],
  중3: ["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말"],
  브랜치: Array.from({ length: 8 }, (_, i) => `모의고사 ${i + 1}회`),
};

const pastelThemes: Record<string, string> = {
  중1: "#e6f0ff",
  중2: "#e8f7ef",
  중3: "#fff2e6",
  브랜치: "#f5e6f7",
};

const gradeColors = ["#4caf50", "#8bc34a", "#cddc39", "#ffc107", "#f44336"];

// 등급 계산
const getLevel = (my: number, avg: number) => {
  if (!avg) return 0;
  const diff = my - avg;
  if (diff >= 10) return 1;
  if (diff >= 5) return 2;
  if (diff >= -5) return 3;
  if (diff >= -10) return 4;
  return 5;
};

// AI COMMENT 생성
const generateFeedback = (scores: Record<string, any>) => {
  const comments: string[] = [];
  let total = 0;
  let count = 0;

  for (const [subject, terms] of Object.entries(scores)) {
    const values = Object.values(terms) as any[];
    if (!values.length) continue;

    const myAvg =
      values.reduce((a, t) => a + (t.my || 0), 0) / values.length;
    const schoolAvg =
      values.reduce((a, t) => a + (t.avg || 0), 0) / values.length;

    total += myAvg;
    count++;

    if (myAvg - schoolAvg >= 5)
      comments.push(`${subject}은(는) 평균보다 높으며, 우수한 성취를 보이고 있습니다.`);
    else if (myAvg - schoolAvg >= -5)
      comments.push(`${subject}은(는) 평균 수준으로 꾸준한 유지가 필요합니다.`);
    else
      comments.push(`${subject}은(는) 평균 이하로 보완이 필요합니다.`);
  }

  if (!count) return "📘 아직 입력된 성적이 없습니다.";

  const overall = total / count;
  let summary = "";
  if (overall >= 90)
    summary = "전반적으로 매우 우수하며, 자기주도적 학습 태도가 잘 형성되어 있습니다.";
  else if (overall >= 80)
    summary = "전반적으로 안정적이며, 일부 과목 보완으로 더 성장할 수 있습니다.";
  else if (overall >= 70)
    summary = "기초 개념 정리와 복습을 통해 향상 가능성이 있습니다.";
  else summary = "학습 습관 재정비와 동기 강화가 필요합니다.";

  return `📘 ${summary}\n${comments.join(" ")}`;
};

export default function GradeModal({
  studentId,
  gradeLevel,
  onClose,
}: GradeModalProps) {
  const [activeTab, setActiveTab] =
    useState<"중1" | "중2" | "중3" | "브랜치">("중1");
  const [teacherComment, setTeacherComment] = useState("");
  const [loading, setLoading] = useState(true);

  // 기본 구조
  const [grades, setGrades] = useState(() => {
    const allSubjects = {
      중1: subjects,
      중2: subjects,
      중3: subjects,
      브랜치: ["국어", "수학", "영어", "통합과학", "통합사회", "역사"],
    } as const;

    return Object.fromEntries(
      Object.keys(termOptions).map((year) => [
        year,
        Object.fromEntries(
          (allSubjects as any)[year].map((s: string) => [
            s,
            Object.fromEntries(
              (termOptions as any)[year].map((t: string) => [
                t,
                { my: 0, avg: 0 },
              ])
            ),
          ])
        ),
      ])
    );
  });
  /** 🔥 최초 1회 Firestore에서 불러오기 */
  useEffect(() => {
    (async () => {
      const saved = await loadGrade(studentId);
      if (saved && saved.scores) {
        setGrades((prev: any) => ({
          ...prev,
          ...saved.scores,
        }));
        setTeacherComment(saved.teacherComment || "");
        console.log("🔥 초기 성적 불러오기:", saved);
      } else {
        console.log("⚠️ 저장된 성적 없음:", studentId);
      }
      setLoading(false);
    })();
  }, [studentId]);

  /** 🔥 실시간 구독 */
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "grades", studentId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        if (data.scores) {
          setGrades((prev: any) => ({
            ...prev,
            ...data.scores,
          }));
        }
        setTeacherComment(data.teacherComment || "");
        console.log("⚡ 실시간 갱신:", data);
      }
    });
    return () => unsubscribe();
  }, [studentId]);

  /** 입력 변경 */
  const handleChange = (
    year: string,
    subject: string,
    term: string,
    field: "my" | "avg",
    value: string
  ) => {
    setGrades((prev: any) => ({
      ...prev,
      [year]: {
        ...prev[year],
        [subject]: {
          ...prev[year]?.[subject],
          [term]: {
            ...prev[year]?.[subject]?.[term],
            [field]: Number(value),
          },
        },
      },
    }));
  };

  /** 저장 */
  const handleSave = async () => {
    try {
      const data = {
        studentId,
        gradeLevel,
        scores: grades,
        teacherComment,
        updatedAt: new Date().toISOString(),
      };
      await saveGrade(studentId, data);
      alert("✅ 성적이 Firestore에 저장되었습니다!");
    } catch (err) {
      console.error("⚠️ 저장 오류:", err);
      alert("⚠️ 저장 중 문제가 발생했습니다.");
    }
  };

  /** 표 렌더링 (모양 그대로 유지) */
  const renderTable = (year: string) => {
    const terms = termOptions[year as keyof typeof termOptions];
    const subjList =
      year === "브랜치"
        ? ["국어", "수학", "영어", "통합과학", "통합사회", "역사"]
        : subjects;

    return (
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          textAlign: "center",
          fontSize: 12,
        }}
      >
        <thead>
          <tr style={{ background: pastelThemes[year], color: "#333" }}>
            <th style={{ padding: "7px 0", border: "1px solid #ddd" }}>과목</th>
            {terms.map((term) => (
              <th
                key={term}
                colSpan={year === "브랜치" ? 2 : 3}
                style={{ border: "1px solid #ddd" }}
              >
                {term}
              </th>
            ))}
          </tr>
          <tr style={{ background: "#fafafa" }}>
            <th></th>
            {terms.map((term) =>
              year === "브랜치" ? (
                <React.Fragment key={term}>
                  <th>내 점수</th>
                  <th>등급</th>
                </React.Fragment>
              ) : (
                <React.Fragment key={term}>
                  <th>내 점수</th>
                  <th>평균</th>
                  <th>등급</th>
                </React.Fragment>
              )
            )}
          </tr>
        </thead>

        <tbody>
          {subjList.map((subject) => (
            <tr key={subject}>
              <td
                style={{
                  fontWeight: 600,
                  background: "#fdfcfb",
                  border: "1px solid #eee",
                }}
              >
                {subject}
              </td>

              {terms.map((term) => {
                const current =
                  (grades as any)?.[year]?.[subject]?.[term] || {
                    my: 0,
                    avg: 0,
                  };
                const { my, avg } = current;
                const level =
                  year === "브랜치" ? Number(avg) : getLevel(my, avg);

                return (
                  <React.Fragment key={term + subject}>
                    <td style={{ border: "1px solid #eee" }}>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={my}
                        onChange={(e) =>
                          handleChange(
                            year,
                            subject,
                            term,
                            "my",
                            e.target.value
                          )
                        }
                        style={{
                          width: 45,
                          height: 26,
                          border: "1px solid #ddd",
                          borderRadius: 5,
                          textAlign: "center",
                          background: "#fffaf4",
                        }}
                      />
                    </td>

                    <td style={{ border: "1px solid #eee" }}>
                      <input
                        type={year === "브랜치" ? "text" : "number"}
                        value={avg}
                        onChange={(e) =>
                          handleChange(
                            year,
                            subject,
                            term,
                            "avg",
                            e.target.value
                          )
                        }
                        style={{
                          width: 65,
                          height: 26,
                          border: "1px solid #ddd",
                          borderRadius: 5,
                          textAlign: "center",
                          background:
                            year === "브랜치" ? "#fffdf5" : "#f9f9f9",
                        }}
                      />
                    </td>

                    {year !== "브랜치" && (
                      <td
                        style={{
                          border: "1px solid #eee",
                          background:
                            level > 0 && level <= 5
                              ? gradeColors[level - 1]
                              : "#e5e7eb",
                          color: "#fff",
                          fontWeight: 700,
                        }}
                      >
                        {["A", "B", "C", "D", "E"][level - 1] || "-"}
                      </td>
                    )}
                  </React.Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };
  if (loading) return <div style={{ padding: 20 }}>⏳ 불러오는 중...</div>;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 999,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 20,
          width: "95%",
          maxWidth: 1000,
          overflowX: "auto",
          boxShadow: "0 8px 20px rgba(0,0,0,0.1)",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 12,
            borderBottom: "2px solid #d9cba8",
            paddingBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "#8b6b3c",
            }}
          >
            Optimum Educore
          </div>
          <div style={{ fontSize: 12, textAlign: "right" }}>
            <div>학생: {studentId}</div>
            <div>학년: {gradeLevel}</div>
          </div>
        </div>

        {/* 탭 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["중1", "중2", "중3", "브랜치"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 6,
                border: "1px solid #ccc",
                background:
                  activeTab === tab ? pastelThemes[tab] : "#f9f9f9",
                color: "#222",
                fontWeight: 600,
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* 표 */}
        {renderTable(activeTab)}

        {/* 코멘트 */}
        <div
          style={{
            marginTop: 16,
            border: "1px solid #eee",
            borderRadius: 10,
            padding: 12,
            background: "#fffef8",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>📘 COMMENT</div>
          <textarea
            value={
              teacherComment ||
              generateFeedback((grades as any)[activeTab] || {})
            }
            onChange={(e) => setTeacherComment(e.target.value)}
            placeholder="AI가 생성한 피드백을 수정하거나 직접 입력할 수 있습니다."
            style={{
              width: "100%",
              minHeight: 80,
              padding: 10,
              borderRadius: 8,
              border: "1px solid #ddd",
              fontSize: 13,
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
        </div>

        {/* 버튼 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 20,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              background: "#f3f4f6",
            }}
          >
            닫기
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              background: "#e6f0ff",
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}