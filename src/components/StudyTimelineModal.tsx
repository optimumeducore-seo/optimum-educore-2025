import React, { useEffect, useMemo, useState } from "react";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

type Props = {
  open: boolean;
  dateStr: string;
  studentId: string;
  onClose: () => void;
};

type DragMode = "paint" | "erase" | null;
type TimelineBlocks = Record<string, string>;

/* =========================================================
   과목 라벨
========================================================= */
const SUBJECT_LABELS: Record<string, string> = {
  kor: "국어",
  math: "수학",
  eng: "영어",
  sci: "과학",
  soc: "사회",
  hist1: "역사1 · 세계사",
  hist2: "역사2 · 한국사",
  tech: "기술가정",
  hanja: "한자",
  jp: "일본어",
  academy: "학원",
  meal: "식사",
  self: "자습",
  rest: "휴식",
};

/* =========================================================
   요약 라벨
========================================================= */
const SUBJECT_SUMMARY_LABELS: Record<string, string> = {
  kor: "국어",
  math: "수학",
  eng: "영어",
  sci: "과학",
  soc: "사회",
  hist1: "세계사",
  hist2: "한국사",
  tech: "기술가정",
  hanja: "한자",
  jp: "일본어",
  academy: "학원",
  meal: "식사",
  self: "자습",
  rest: "휴식",
};

/* =========================================================
   과목 색상
========================================================= */
const SUBJECT_COLORS: Record<string, { bg: string; text: string; light: string }> = {
  kor: { bg: "#F87171", text: "#FFFFFF", light: "#FEE2E2" },
  math: { bg: "#60A5FA", text: "#FFFFFF", light: "#DBEAFE" },
  eng: { bg: "#34D399", text: "#FFFFFF", light: "#D1FAE5" },
  sci: { bg: "#A78BFA", text: "#FFFFFF", light: "#EDE9FE" },
  soc: { bg: "#FBBF24", text: "#FFFFFF", light: "#FEF3C7" },
  hist1: { bg: "#FB923C", text: "#FFFFFF", light: "#FFEDD5" },
  hist2: { bg: "#94A3B8", text: "#FFFFFF", light: "#F1F5F9" },
  tech: { bg: "#2DD4BF", text: "#FFFFFF", light: "#CCFBF1" },
  hanja: { bg: "#E879F9", text: "#FFFFFF", light: "#FDF4FF" },
  jp: { bg: "#F472B6", text: "#FFFFFF", light: "#FCE7F3" },
  academy: { bg: "#334155", text: "#FFFFFF", light: "#E2E8F0" },
  meal: { bg: "#F59E0B", text: "#FFFFFF", light: "#FEF3C7" },
  self: { bg: "#10B981", text: "#FFFFFF", light: "#D1FAE5" },
  rest: { bg: "#CBD5E1", text: "#1F2937", light: "#F1F5F9" },
};

/* =========================================================
   버튼 순서
========================================================= */
const STUDY_SUBJECT_KEYS = [
  "kor",
  "math",
  "eng",
  "sci",
  "soc",
  "hist1",
  "hist2",
  "tech",
  "hanja",
  "jp",
];

const LIFE_SUBJECT_KEYS = ["academy", "meal", "self", "rest"];

/* =========================================================
   시간축
========================================================= */
// 07:00 ~ 23:50
const HOURS = Array.from({ length: 17 }, (_, i) => 7 + i);
const MINUTES = ["00", "10", "20", "30", "40", "50"];

/* =========================================================
   학습 패턴 분석 리포트
========================================================= */
function StudyInsight({
  blocks,
  isMobile,
}: {
  blocks: TimelineBlocks;
  isMobile: boolean;
}) {
  if (Object.keys(blocks).length === 0) return null;

  const subjectParts = Object.entries(blocks).reduce((acc: any[], [_, subKey]) => {
    const found = acc.find((item) => item.key === subKey);
    if (found) found.count += 1;
    else acc.push({ key: subKey, count: 1 });
    return acc;
  }, []);

  return (
    <div style={insightCardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
        <span style={{ fontSize: 12 }}>🔥</span>
        <span style={{ fontWeight: 600, color: "#1E3A8A" }}>과목별 몰입 에너지</span>
      </div>

      <div style={progressBarContainerStyle}>
        {subjectParts.map((item) => (
          <div
            key={item.key}
            style={{
              width: `${(item.count / Object.keys(blocks).length) * 100}%`,
              background: SUBJECT_COLORS[item.key]?.bg || "#ccc",
              height: 10,
              transition: "all 0.4s ease",
            }}
            title={`${SUBJECT_LABELS[item.key]} ${item.count * 10}분`}
          />
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   메인 컴포넌트
========================================================= */
export default function StudyTimelineModal({
  open,
  dateStr,
  studentId,
  onClose,
}: Props) {
  const [selectedSubject, setSelectedSubject] = useState<string>("kor");
  const [blocks, setBlocks] = useState<TimelineBlocks>({});
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [dragRowHour, setDragRowHour] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(
  typeof window !== "undefined" ? window.innerWidth < 600 : false
);

useEffect(() => {
  const onResize = () => setIsMobile(window.innerWidth < 600);
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}, []);

  /* ---------------------------------------------------------
     모달 열릴 때 기존 데이터 불러오기
  --------------------------------------------------------- */
  useEffect(() => {
    if (!open || !studentId || !dateStr) return;

    let cancelled = false;

   async function loadTimeline() {

  console.log("📥 불러오기 studentId:", studentId);
  console.log("📥 불러오기 dateStr:", dateStr);

  setBlocks({}); // 🔥 날짜 바뀌면 초기화

  try {
    setLoading(true);

    const ref = doc(db, "studyPlans", studentId, "days", dateStr);
    const snap = await getDoc(ref);

        if (!snap.exists()) {
          if (!cancelled) setBlocks({});
          return;
        }

        const data = snap.data() as any;
        const timeline = data?.timelineBlocks || {};

        if (!cancelled) {
          setBlocks(timeline);
        }
      } catch (err) {
        console.error("❌ 타임라인 불러오기 실패:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadTimeline();

    return () => {
      cancelled = true;
    };
  }, [open, studentId, dateStr]);

  /* ---------------------------------------------------------
     총 시간
  --------------------------------------------------------- */
  const totalMinutes = Object.keys(blocks).length * 10;

  /* ---------------------------------------------------------
     과목별 요약
  --------------------------------------------------------- */
  const subjectSummary = useMemo(() => {
    const acc: Record<string, number> = {};
    Object.values(blocks).forEach((subKey) => {
      acc[subKey] = (acc[subKey] || 0) + 10;
    });
    return acc;
  }, [blocks]);

  const orderedSummary = useMemo(() => {
    return Object.entries(subjectSummary).sort((a, b) => b[1] - a[1]);
  }, [subjectSummary]);

  /* ---------------------------------------------------------
     드래그 시작
  --------------------------------------------------------- */
  const handlePointerDown = (key: string, hour: number) => {
  setDragRowHour(hour);

  setBlocks((prev) => {
    const updated = { ...prev };
    const sameSubject = updated[key] === selectedSubject;

    if (sameSubject) {
      delete updated[key];
      setDragMode("erase");
    } else {
      updated[key] = selectedSubject;
      setDragMode("paint");
    }

    return updated;
  });

  setIsDragging(true);
};

  /* ---------------------------------------------------------
     드래그 중
  --------------------------------------------------------- */
 const handlePointerEnter = (key: string, hour: number) => {
  if (isMobile) return;  // 🔒 모바일에선 드래그 칠하기 비활성화
  if (!isDragging || !dragMode) return;
  if (dragRowHour !== hour) return;

  setBlocks((prev) => {
    const updated = { ...prev };

    if (dragMode === "paint") {
      updated[key] = selectedSubject;
    } else if (dragMode === "erase") {
      if (updated[key] === selectedSubject) delete updated[key];
    }
    return updated;
  });
};

  /* ---------------------------------------------------------
     드래그 종료
  --------------------------------------------------------- */
 const handlePointerEnd = async () => {
  if (!isDragging) return;

  setIsDragging(false);
  setDragMode(null);
  setDragRowHour(null);

  try {
    setAutoSaving(true);
    await saveTimeline(blocks);
  } finally {
    setAutoSaving(false);
  }
};

  /* ---------------------------------------------------------
     저장
  --------------------------------------------------------- */
const saveTimeline = async (nextBlocks?: TimelineBlocks) => {
  if (!studentId || !dateStr) {
    console.log("❌ studentId 또는 dateStr 없음");
    return;
  }

  const payloadBlocks = nextBlocks ?? blocks;

  console.log("🔥 저장 studentId:", studentId);
  console.log("🔥 저장 dateStr:", dateStr);
  console.log("🔥 저장 payloadBlocks:", payloadBlocks);

  try {
    setSaving(true);

    const ref = doc(db, "studyPlans", studentId, "days", dateStr);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      // ✅ timelineBlocks 맵 자체를 통째로 교체
      await updateDoc(ref, {
        date: dateStr,
        timelineBlocks: payloadBlocks,
        timelineUpdatedAt: serverTimestamp(),
      });
    } else {
      // ✅ 처음 생성일 때만 setDoc
      await setDoc(ref, {
        date: dateStr,
        timelineBlocks: payloadBlocks,
        timelineUpdatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.error("❌ 타임라인 저장 실패:", err);
  } finally {
    setSaving(false);
  }
};

  if (!open) return null;

  return (
    <div
      style={overlayStyle}
      onPointerUp={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      <div style={containerStyle}>
        {/* 헤더 */}
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 21, fontWeight: 900, marginBottom: 4 }}>
              📘 학습 타임라인
            </div>
            <div style={{ fontSize: 13, opacity: 0.95 }}>
              {dateStr} · 10분 단위 학습 기록
            </div>
          </div>

          <button onClick={onClose} style={closeBtnStyle}>
            ✕
          </button>
        </div>

        {/* 상단 요약 */}
        <div
          style={{
            ...summaryTopWrapStyle,
            gridTemplateColumns: isMobile ? "1fr" : "180px 1fr",
          }}
        >
          <div style={summaryMainCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>
              총 몰입 시간
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 22,
                fontWeight: 900,
                color: "#1E3A8A",
              }}
            >
              {totalMinutes}분
            </div>
          </div>

          <div style={summarySubCardStyle}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: "#64748B",
                marginBottom: 6,
              }}
            >
              과목별 합계
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {orderedSummary.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94A3B8" }}>
                  아직 기록 없음
                </div>
              ) : (
                orderedSummary.map(([subKey, min]) => (
                  <div
                    key={subKey}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      background: SUBJECT_COLORS[subKey]?.light || "#F3F4F6",
                      color: "#334155",
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {SUBJECT_SUMMARY_LABELS[subKey] || SUBJECT_LABELS[subKey]} {min}분
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      

{/* 인사이트 */}
      {!isMobile && <StudyInsight blocks={blocks} isMobile={isMobile} />}

       {/* 과목 선택 - 라벨 없이 버튼만 깔끔하게 통합 */}
        <div style={simpleSubjectBarStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[...STUDY_SUBJECT_KEYS, ...LIFE_SUBJECT_KEYS].map((key) => {
              const active = key === selectedSubject;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedSubject(key)}
                 style={{
  ...subjectBtnStyle,
  background: active ? SUBJECT_COLORS[key].bg : "#F1F5F9",
  color: active ? "#FFFFFF" : "#475569",
  border: "none",
  boxShadow: active
    ? `0 4px 10px ${SUBJECT_COLORS[key].bg}33`
    : "none",
}}
                >
                  {SUBJECT_LABELS[key]}
                </button>
              );
            })}
          </div>
        </div>

        {/* 안내문 */}
<div style={guideBarStyle}>
  {isMobile
    ? "시간에서 드래그하세요. 칸을 눌러 학습 시간을 기록할 수 있어요."
    : "칸을 눌러 기록하고, 드래그해서 여러 칸을 한 번에 칠할 수 있어요."}
</div>

        {/* 타임라인 */}
        <div style={timelineWrapStyle}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "#64748B" }}>
              불러오는 중...
            </div>
          ) : (
            HOURS.map((hour) => (
              <div key={hour} style={rowStyle}>
                <div style={hourCellStyle}>
                  {String(hour).padStart(2, "0")}:00
                </div>

                <div style={minuteGridStyle}>
                  {MINUTES.map((minute) => {
                    const timeKey = `${String(hour).padStart(2, "0")}:${minute}`;
                    const subjectKey = blocks[timeKey];
                    const color = subjectKey ? SUBJECT_COLORS[subjectKey] : null;
                    const label = subjectKey ? SUBJECT_LABELS[subjectKey] : "";

                    return (
                      <div
                        key={timeKey}
                        onPointerDown={() => handlePointerDown(timeKey, hour)}
onPointerEnter={() => handlePointerEnter(timeKey, hour)}
                        style={{
                          ...blockStyle,
                           height: isMobile ? 50 : 36,
                          background: color ? color.bg : "#F8FAFC",
                          color: color ? color.text : "#94A3B8",
                          border: color
                            ? `1px solid ${color.bg}`
                            : "1px solid #E2E8F0",
                          boxShadow: color ? "0 4px 10px rgba(0,0,0,0.12)" : "none",
                          transform: color
                            ? isMobile
                              ? "scale(1.02)"
                              : "scale(1.05)"
                            : "scale(1)",
                          zIndex: color ? 10 : 1,
                          position: "relative",
                          transition: "all 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                        title={`${timeKey}${label ? ` · ${label}` : ""}`}
                      >
                        {subjectKey && (
                          <div
                            style={{
                              fontSize: "7px",
                              fontWeight: 800,
                              position: "absolute",
                              top: "4px",
                              letterSpacing: "-0.5px",
                              opacity: 0.9,
                            }}
                          >
                            {label.length > 4 ? label.slice(0, 4) : label}
                          </div>
                        )}

                        <div
                          style={{
                            fontSize: subjectKey ? "12px" : "10px",
                            fontWeight: subjectKey ? 900 : 600,
                            marginTop: subjectKey ? "6px" : "0px",
                          }}
                        >
                          {minute}
                        </div>
                      </div>
                    );
                            
                  })}
                </div>
              </div>
            ))
          )}
        </div>
{isMobile && <StudyInsight blocks={blocks} isMobile={isMobile} />}
        {/* 하단 버튼 */}
        <div
          style={{
            ...footerStyle,
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "stretch" : "center",
            gap: isMobile ? 10 : 0,
          }}
        >
          <div style={{ fontSize: 12, color: "#94A3B8" }}>
  {autoSaving || saving ? "자동 저장중..." : "변경사항 자동 저장됨"}
</div>

         
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   styles
========================================================= */
const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.58)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const containerStyle: React.CSSProperties = {
  width: 760,
  maxWidth: "94vw",
  maxHeight: "90vh",
  background: "#FFFFFF",
  borderRadius: 22,
  boxShadow: "0 25px 50px rgba(0,0,0,0.22)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  padding: "22px 24px",
  background: "linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)",
  color: "#FFFFFF",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const closeBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 999,
  border: "none",
  background: "rgba(255,255,255,0.18)",
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
};

const summaryTopWrapStyle: React.CSSProperties = {
  padding: "10px 12px 8px",
  background: "#F8FAFC",
  borderBottom: "1px solid #E2E8F0",
  display: "grid",
  gap: 8,
};

const summaryMainCardStyle: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E2E8F0",
  borderRadius: 14,
  padding: "14px 16px",
};

const summarySubCardStyle: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E2E8F0",
  borderRadius: 14,
  padding: "14px 16px",
};

const subjectBarStyle: React.CSSProperties = {
  padding: "16px 20px",
  background: "#F8FAFC",
  borderBottom: "1px solid #E2E8F0",
};

const subjectBtnStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,   // 🔥 999 → 6
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  transition: "all 0.15s ease",
};

const guideBarStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#FFFFFF",
  borderBottom: "1px solid #E2E8F0",
  fontSize: 12,
  color: "#b26f22",
};

const insightCardStyle: React.CSSProperties = {
  margin: "10px 20px",
  padding: "16px",
  background: "#F0F7FF",
  borderRadius: "16px",
  border: "1px solid #D6E9FF",
};

const progressBarContainerStyle: React.CSSProperties = {
  display: "flex",
  height: 8,
  borderRadius: 4,
  overflow: "hidden",
  background: "#E2E8F0",
  marginTop: 6,
};

const timelineWrapStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "10px 12px",
  userSelect: "none",
  background: "#FFFFFF",
  WebkitOverflowScrolling: "touch",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  marginBottom: 10,
};

const hourCellStyle: React.CSSProperties = {
  width: 58,
  fontSize: 13,
  fontWeight: 900,
  color: "#475569",
  fontFamily: "monospace",
};

const minuteGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, 1fr)",
  gap: 6,
  flex: 1,
};

const blockStyle: React.CSSProperties = {
  height: 36,
  borderRadius: 10,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
  cursor: "crosshair",
  transition: "all 0.12s ease",
  touchAction: "none",
};

const footerStyle: React.CSSProperties = {
  padding: "18px 20px",
  borderTop: "1px solid #E2E8F0",
  background: "#FFFFFF",
  display: "flex",
  justifyContent: "space-between",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 12,
  border: "1px solid #E2E8F0",
  background: "#F8FAFC",
  color: "#475569",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 12,
  border: "none",
  background: "#1E3A8A",
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const simpleSubjectBarStyle: React.CSSProperties = {
  padding: "20px",
  background: "#FFFFFF",
  borderBottom: "1px solid #E2E8F0",
};

