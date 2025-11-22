// src/components/ExamDetailModal.tsx
import React from "react";

export default function ExamDetailModal({
  tab,
  term,
  exam,
  onClose,
}: {
  tab: string;
  term: string;
  exam: any;
  onClose: () => void;
}) {
  if (!exam) return null;

  const subjects = Object.keys(exam.subjects || {});

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 5000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "88%",
          maxWidth: 480,
          background: "#FFFDF8",
          borderRadius: 18,
          padding: 20,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 10px 28px rgba(0,0,0,0.25)",
          fontFamily: "Pretendard, sans-serif",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            marginBottom: 14,
            borderBottom: "1px solid #E5DED4",
            paddingBottom: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: "#9CA3AF",
                letterSpacing: 1,
                fontWeight: 700,
              }}
            >
              OPTIMUM EDUCORE
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, marginTop: 2 }}>
              {tab} · {term} 상세 분석
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "#EEE",
              borderRadius: "50%",
              border: "1px solid #DDD",
              width: 28,
              height: 28,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* 시험 정보 배지 */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 18,
            fontSize: 11,
          }}
        >
          <span
            style={{
              padding: "4px 10px",
              background: "#EEF2FF",
              borderRadius: 999,
              color: "#4F46E5",
              fontWeight: 700,
            }}
          >
            {exam.examYear}년 {exam.examMonth}월
          </span>

          <span
            style={{
              padding: "4px 10px",
              background: "#F3F4F6",
              borderRadius: 999,
              color: "#374151",
              fontWeight: 700,
            }}
          >
            {exam.examRound || "1회"} 모의고사
          </span>
        </div>

        {/* 과목별 섹션 */}
        {subjects.map((sub) => {
          const data = exam.subjects[sub];

          return (
            <div
              key={sub}
              style={{
                marginBottom: 28,
                padding: 14,
                background: "#FBFAF7",
                borderRadius: 14,
                border: "1px solid #E7DCC9",
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 14,
                  marginBottom: 8,
                  color: "#3F3A37",
                }}
              >
                {sub}
              </div>

              {/* 요약 박스 */}
              <div
                style={{
                  padding: 12,
                  background: "#FFFFFF",
                  borderRadius: 10,
                  border: "1px solid #E5DED4",
                  marginBottom: 12,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <div>
                  <b>총점:</b> {data.totalScore ?? "-"}
                </div>
                <div>
                  <b>맞힌 개수:</b> {data.correctCount}
                </div>
                <div>
                  <b>틀린 개수:</b> {data.wrongCount}
                </div>
                {data.grade && (
                  <div>
                    <b>등급:</b> {data.grade}등급
                  </div>
                )}
              </div>

              {/* 문항별 표 */}
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                <thead>
                  <tr style={{ background: "#F3F4F6", height: 32 }}>
                    <th style={thStyle}>문항</th>
                    <th style={thStyle}>정답</th>
                    <th style={thStyle}>내답</th>
                    <th style={thStyle}>득점</th>
                  </tr>
                </thead>

                <tbody>
                  {Object.entries(data.perQuestionScore || {}).map(
                    ([qnum, info]: any) => (
                      <tr key={qnum} style={{ height: 30 }}>
                        <td style={tdStyle}>{qnum}</td>
                        <td style={tdStyle}>{info.correct}</td>
                        <td style={tdStyle}>{info.mine}</td>
                        <td
                          style={{
                            ...tdStyle,
                            fontWeight: 800,
                            color: info.score > 0 ? "#166534" : "#B91C1C",
                          }}
                        >
                          {info.score}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          );
        })}

        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          style={{
            padding: "10px 0",
            width: "100%",
            borderRadius: 10,
            border: "1px solid #DDD",
            background: "#F3F4F6",
            fontWeight: 700,
            cursor: "pointer",
            marginTop: 6,
          }}
        >
          닫기
        </button>
      </div>
    </div>
  );
}

/* 공통 스타일 */
const thStyle = {
  padding: 6,
  border: "1px solid #ddd",
};

const tdStyle = {
  padding: 6,
  border: "1px solid #eee",
  textAlign: "center" as const,
};