// src/pages/ParentMonthlyReport.tsx
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,

} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { loadGrade } from "../services/firestore";

/* ===============================
   타입 정의
================================ */
type TimeSlot = {
  day: number; // 0~6 (일~토)
  from: string;
  to: string;
};

type SubjectEntry = {
  slots: TimeSlot[];
};

type DayCell = {
  time?: string;
  outTime?: string;
  studyMin?: number;
  commuteMin?: number;     // ⭐ 이동시간 추가
  restroomMin?: number;    // 화장실
  mealMin?: number;        // ⭐ 식사시간 추가
  memo?: string;
  academyBySubject?: Record<string, SubjectEntry>;
};

// 🔥 Student 타입 (EditStudentModal 구조 반영)
type Student = {
  id: string;
  name: string;
  school: string;
  grade: string;
  personalSchedule?: {
    current?: Record<string, any>;
    next?: { effectiveDate: string; data: Record<string, any> };
    timeBlocks?: any[];
  };
};

// ✅ Firestore: records 문서 안에 "YYYY-MM-DD": DayCell 구조
type Records = Record<string, DayCell>;

type Summary = {
  days: number;
  study: number;
  rest: number;
  short: number;
};

const sortDates = (list: string[]) =>
  list.sort((a, b) => (a < b ? -1 : 1));

async function downloadSchedulePDF(
  pdfRef: React.RefObject<HTMLDivElement>,
  studentName?: string
) {
  if (!pdfRef.current) {
    alert("시간표 영역을 찾을 수 없습니다.");
    return;
  }

  const canvas = await html2canvas(pdfRef.current, {
    scale: 3,
    backgroundColor: "#ffffff",
    useCORS: true,
  });

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const margin = 12;
  const usableWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * usableWidth) / canvas.width;
  const imgData = canvas.toDataURL("image/png");

  /* ---------------------------
     1) 워터마크 (먼저)
  --------------------------- */
  const gState = pdf.GState({ opacity: 0.06 });
  pdf.setGState(gState);

  pdf.setFontSize(80);
  pdf.setTextColor(183, 28, 28);
  pdf.text("OPTIMUM EDUCORE", pageWidth / 2, pageHeight / 2, {
    align: "center",
    angle: -35,
  });

  pdf.setFontSize(24);
  pdf.setTextColor(30, 58, 138);
  pdf.text("YOU MAKE YOUR STUDY", pageWidth / 2, pageHeight / 2 + 40, {
    align: "center",
    angle: -35,
  });

  /* ---------------------------
     2) 시간표 이미지 (한 번만!)
  --------------------------- */
  pdf.setGState(pdf.GState({ opacity: 1 }));
  const imgY = margin + 5;
  pdf.addImage(imgData, "PNG", margin, imgY, usableWidth, imgHeight, "", "FAST");

  /* ---------------------------
     3) 하단 슬로건
  --------------------------- */
  pdf.setFontSize(10);
  pdf.setTextColor(90);
  pdf.text(
    "Crafted by OPTIMUM EDUCORE · YOU MAKE YOUR STUDY",
    pageWidth / 2,
    pageHeight - 10,
    {
      align: "center",
    }
  );

  pdf.save(`시간표_${studentName || "학생"}.pdf`);
}



/* ===============================
   메인 컴포넌트
================================ */
export default function ParentMonthlyReport() {
  const { id } = useParams();
  const nav = useNavigate();

  const [student, setStudent] = useState<Student | null>(null);
  const [records, setRecords] = useState<Records>({});
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  // 🔥 성적 데이터
const [gradeData, setGradeData] = useState<any>(null);
const [comment, setComment] = useState("");
const [openTimeline, setOpenTimeline] = useState(false);

async function handleSaveComment() {
  if (!id) return;
  try {
    await setDoc(
      doc(db, "grades", id),
      { teacherComment: comment },
      { merge: true }
    );
    alert("✨ 코멘트 저장 완료!");
  } catch (err) {
    console.error(err);
    alert("⚠ 저장 중 오류 발생");
  }
}

async function handleDeleteComment() {
  if (!id) return;
  try {
    await setDoc(
      doc(db, "grades", id),
      { teacherComment: "" },
      { merge: true }
    );
    setComment("");
    alert("🗑 코멘트 삭제 완료!");
  } catch (err) {
    console.error(err);
    alert("⚠ 삭제 중 오류 발생");
  }
}
useEffect(() => {
  if (!id) return;
  (async () => {
    const saved = await loadGrade(id);
    if (saved) {
      setGradeData(saved.scores);
      setComment(saved.teacherComment || "");
    }
  })();
}, [id]);

useEffect(() => {
  if (!id) return;

  (async () => {
    const saved = await loadGrade(id);
    if (saved) setGradeData(saved.scores);
  })();
}, [id]);  // ⬅ id 의존성 추가

  /* ===============================
        데이터 로드
  ================================= */
  useEffect(() => {
    if (!id) return;

    (async () => {
      const stSnap = await getDoc(doc(db, "students", id));
      const recSnap = await getDoc(doc(db, "records", id));

      if (stSnap.exists()) {
        setStudent({ id, ...(stSnap.data() as Omit<Student, "id">) });
      }
      if (recSnap.exists()) {
        setRecords(recSnap.data() as Records);
      }
    })();
  }, [id]);

  /* ===============================
        월 날짜 목록
  ================================= */
  const monthDates = useMemo(
    () =>
      sortDates(
        Object.keys(records).filter((d) => d.startsWith(month))
      ),
    [records, month]
  );

  /* ===============================
        월 요약
  ================================= */
  const summary: Summary = useMemo(() => {
    let study = 0;
    let rest = 0;
    let short = 0;
    let days = 0;

    monthDates.forEach((date) => {
      const cell = records[date];
      if (!cell) return;

      days++;
   // 순공 계산: 등원~하원 시간 - (이동+화장실+식사)
const start = cell.time ? hmToMin(cell.time) : 0;
const end = cell.outTime ? hmToMin(cell.outTime) : start;
const gross = Math.max(0, end - start);

// 이동+화장실+식사
const outing = (cell.commuteMin ?? 0) + (cell.restroomMin ?? 0) + (cell.mealMin ?? 0);

// 월 요약 반영
study += Math.max(0, gross - outing);
short += outing;
    });

    return { days, study, rest, short };
  }, [monthDates, records]);

  /* ===============================
        로딩 처리
  ================================= */
  if (!student) {
    return (
      <div
        style={{
          padding: 40,
          fontSize: 18,
          fontFamily: "'Pretendard','Noto Sans KR',sans-serif",
        }}
      >
        불러오는 중...
      </div>
    );
  }




  /* ===============================
        UI + 프린트 스타일
  ================================= */
  return (
  <div
    style={{
      background: "#F3EFE6",
      minHeight: "100vh",
      padding: "24px 10px",
      display: "flex",
      justifyContent: "center",
      fontFamily: "'Pretendard','Noto Sans KR',sans-serif",
    }}
  >

    <style>{`
      .watermark,
      .watermark-sub {
        display: none;
      }

      @media print {
        .watermark,
        .watermark-sub {
          display: block;
          position: fixed;
          left: 50%;
          transform: translateX(-50%) rotate(-35deg);
          pointer-events: none;
          opacity: 0.06;
          z-index: -1;
          user-select: none;
          white-space: nowrap;
        }

        .watermark {
          top: 40%;
          font-size: 80px;
          font-weight: 900;
          color: #b71c1c;
        }

        .watermark-sub {
          top: 55%;
          font-size: 28px;
          font-weight: 800;
          color: #1e3a8a;
        }
      }
    `}</style>

    <style>{`
  /* 모바일 기본 설정 */
  @media (max-width: 600px) {
    .print-card {
      padding: 20px 18px !important;
      border-radius: 14px !important;
    }

    h1 {
      font-size: 20px !important;
      margin-bottom: 6px !important;
    }

    h2 {
      font-size: 16px !important;
      margin-bottom: 10px !important;
    }

    .timeline-item {
      font-size: 12px !important;
      padding: 3px 0 !important;
    }

    /* 도넛 크기 축소 */
    .doughnut-wrap {
      width: 140px !important;
      height: 140px !important;
    }

    /* 타임라인 카드 */
    .timeline-card {
      padding: 10px 12px !important;
      margin-bottom: 10px !important;
      border-radius: 10px !important;
    }

    /* 전체 페이지 패딩 */
    .page-wrap {
      padding: 20px 12px !important;
    }

    /* 시간표 영역 */
    .timetable-wrapper {
      padding: 8px !important;
    }

    .timetable-wrapper table {
      font-size: 10px !important;
    }

    .timetable-wrapper td {
      height: 24px !important;
      line-height: 24px !important;
    }
  }
`}</style>

     

      {/* 🔶 인쇄될 본문 전체 */}
      <div style={{ width: "100%", maxWidth: 820 }}>
        <div
          className="print-card"
          style={{
            width: "100%",
            background: "#ffffff",
            borderRadius: 18,
            padding: "28px 32px",
            border: "1px solid rgba(0,0,0,0.06)",
            boxShadow: "0 10px 22px rgba(0,0,0,0.08)",
          }}
        >
  

          {/* 상단 버튼 영역 (뒤로가기 + 인쇄) - 출력 시 숨김 */}
          <div
            className="no-print"
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 18,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => nav(-1)}
              style={{
                background: "#EEE8DF",
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid #D6CEC5",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              ← Back
            </button>

            <button
              onClick={() => window.print()}
              style={{
                background: "#111827",
                color: "#F9FAFB",
                padding: "6px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              🖨 월간 리포트 인쇄
            </button>
          </div>

          {/* 제목 영역 */}
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              marginBottom: 4,
              letterSpacing: "-0.2px",
            }}
          >
            {student.name} 학생 월간 리포트
          </h1>

          <div style={{ opacity: 0.65, marginBottom: 22, fontSize: 12 }}>
            {month} / {student.school} {student.grade}
          </div>

          {/* 섹션들 */}
          <DoughnutSection summary={summary} />
          <TimelineSection
  monthDates={monthDates}
  records={records}
  open={openTimeline}
  setOpen={setOpenTimeline}
/>
          <ScheduleSection student={student} />
          <GradeSection
  gradeData={gradeData}
  comment={comment}
  setComment={setComment}
  onSave={handleSaveComment}
  onDelete={handleDeleteComment}
/>

          {/* 하단 카피 */}
          <div
            style={{
              marginTop: 40,
              textAlign: "center",
              color: "rgba(0,0,0,0.45)",
              fontSize: 11,
              fontStyle: "italic",
            }}
          >
            Crafted with care by OPTIMUM EDUCORE
            <br />
            Empowering Students — Inspiring Families.
          </div>
        </div>
      </div>
    </div>
  );
}

/* =================================================================== */
/* 도넛 섹션 */
/* =================================================================== */

function DoughnutSection({ summary }: { summary: Summary }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 800,
          marginBottom: 14,
          borderLeft: "4px solid #C8A76A",
          paddingLeft: 10,
        }}
      >
        월 학습 총합
      </h2>

      <div className="doughnut-wrap">
        <DoughnutChart
          study={summary.study}
          rest={summary.rest}
          short={summary.short}
        />
      </div>

      {/* ★★★ 여기 추가 ★★★ */}
      <div
        style={{
          marginTop: 12,
          fontSize: 13,
          textAlign: "center",
          color: "#444",
        }}
      >
        <div><b>{summary.study}분</b> 순공</div>
        <div><b>{summary.short}분</b> 생활시간(이동·식사·화장실)</div>
      </div>
      {/* ★★★ 여기까지 ★★★ */}

      <div style={{ marginTop: 10, fontSize: 13 }}>
        출석일 <b>{summary.days}</b>일
      </div>
    </div>
  );
}
/* =================================================================== */
/* 타임라인 섹션 */
/* =================================================================== */

function hmToMin(hm?: string) {
  if (!hm) return 0;
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function TimelineSection({
  monthDates,
  records,
  open,
  setOpen,
}: {
  monthDates: string[];
  records: Records;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <div style={{ marginTop: 32 }}>
      {/* 타이틀 + 버튼 */}
      <button
        onClick={() => setOpen(!open)}
        className="no-print"
        style={{
          width: "100%",
          padding: "10px 16px",
          borderRadius: 12,
          cursor: "pointer",
          background: "linear-gradient(135deg, #E8EDF5 0%, #F5F7FA 100%)",
          border: "1px solid #C8D3E5",
          boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "#1E3A8A",
          fontSize: 14,
          fontWeight: 800,
        }}
      >
        DAILY TIMELINE {open ? "▲" : "▼"}
      </button>

      {/* 펼쳐지는 영역 */}
      <div
        style={{
          maxHeight: open ? "3000px" : "0px",
          overflow: "hidden",
          transition: "max-height 0.45s cubic-bezier(.4,0,.2,1)",
          marginTop: open ? 18 : 0,
        }}
      >
        {monthDates.length === 0 && (
          <div style={{ fontSize: 12, color: "#9ca3af", padding: 10 }}>
            아직 이 달의 학습 기록이 없습니다.
          </div>
        )}

        {monthDates.map((date) => {
          const cell = records[date];
          if (!cell) return null;

          return (
            <div
              key={date}
              style={{
                background: "#ffffff",
                padding: "14px 18px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                marginBottom: 12,
                boxShadow: "0 3px 8px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                {date}
              </div>

              <TimelineItem label="등원" time={cell.time} />
              <TimelineItem label="하원" time={cell.outTime} />
              <TimelineItem
                label="순공"
                time={
                  typeof cell.studyMin === "number"
                    ? `${cell.studyMin}분`
                    : undefined
                }
              />
              {typeof cell.restroomMin === "number" && (
                <TimelineItem label="화장실" time={`${cell.restroomMin}분`} />
              )}
              {typeof cell.commuteMin === "number" && (
                <TimelineItem label="이동" time={`${cell.commuteMin}분`} />
              )}
              {typeof cell.mealMin === "number" && (
                <TimelineItem label="식사" time={`${cell.mealMin}분`} />
              )}
              {cell.memo && <TimelineItem label="메모" time={cell.memo} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
/* =================================================================== */
/* 🟨 EDUCORE PREMIUM — TIME SCHEDULE (BUTTON + TABLE + PDF) */
/* =================================================================== */

function ScheduleSection({ student }: { student: Student }) {
  const [open, setOpen] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null!);

  return (
    <div style={{ marginTop: 32 }}>
      {/* 섹션 타이틀 */}
      <h2
        style={{
          fontSize: 18,
          fontWeight: 900,
          marginBottom: 10,
          letterSpacing: "-0.2px",
          borderLeft: "4px solid #0F766E",
          paddingLeft: 10,
          color: "#1F2937",
        }}
      >
        개인 시간표
      </h2>

      {/* 🟨 프리미엄 버튼 (화면에서만) */}
      <button
        onClick={() => setOpen(!open)}
        className="no-print"
        style={{
          width: "100%",
          padding: "10px 16px",
          borderRadius: 12,
          cursor: "pointer",
          background: "linear-gradient(135deg, #EFE8DB 0%, #FAF7F1 100%)",
          border: "1px solid #D2C4AF",
          boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "#3A2E2A",
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: 1.1,
          textTransform: "uppercase",
        }}
      >
        SCHED By Educore {open ? "▲" : "▼"}
      </button>

      {/* ▼▼▼ 펼쳐지는 내용 ▼▼▼ */}
      <div
        style={{
          maxHeight: open ? "2000px" : "0px",
          overflow: "hidden",
          transition: "max-height 0.45s cubic-bezier(.4,0,.2,1)",
          marginTop: open ? 18 : 0,
        }}
      >
        {/* PDF로 캡처되는 영역 전체 */}
     <div
  ref={pdfRef}
  style={{
    paddingTop: 30,
    paddingBottom: 20,
    background: "#fff",
  }}
>
  {/* ===== PDF 상단 로고 ===== */}
  <div
    style={{
      textAlign: "center",
      fontSize: 22,
      fontWeight: 900,
      marginBottom: 6,
    }}
  >
    <span style={{ color: "#b71c1c" }}>O</span>
    <span>PTIMUM </span>
    <span style={{ color: "#1e3a8a" }}>E</span>
    <span>DUCORE</span>
  </div>

  {/* ===== PDF 전문 제목 ===== */}
  <div
    style={{
      textAlign: "center",
      fontSize: 13,
      fontWeight: 700,
      color: "#666",
      marginBottom: 18,
    }}
  >
    WEEKLY PERSONAL SCHEDULE
  </div>

  <TimeTable student={student} />

  {/* ===== PDF 하단 슬로건 ===== */}
  <div
    style={{
      textAlign: "center",
      marginTop: 16,
      fontSize: 11,
      color: "#999",
      fontStyle: "italic",
    }}
  >
    YOU MAKE YOUR STUDY
  </div>
</div>

        {/* PDF 다운로드 버튼 (화면 전용) */}
        <button
          onClick={() => downloadSchedulePDF(pdfRef, student.name)}
          className="no-print"
          style={{
            marginTop: 16,
            width: "100%",
            background: "#1F2937",
            color: "#F9FAFB",
            padding: "8px 0",
            borderRadius: 10,
            border: "none",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          📄 시간표 PDF 저장
        </button>
      </div>
    </div>
  );
}

/* =================================================================== */
/* 🟨 EDUCORE PREMIUM TIME-TABLE (표 + 색상 자동 매핑) */
/* =================================================================== */

function TimeTable({ student }: { student: Student }) {
  const sched = student.personalSchedule;
  if (!sched) return null;

  const isMobile = window.innerWidth < 600;
  if (isMobile) {
  return <MobileTimeTable student={student} />;
}
  // current + next 통합
  const merged = {
    ...(sched.current || {}),
    ...(sched.next?.data || {}),
  };

  const days = ["월", "화", "수", "목", "금", "토", "일"];

  // 시간 (09:00 ~ 22:00 / 30분 단위)
  const timeLabels = Array.from({ length: 27 }).map((_, i) => {
    const h = 9 + Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    return `${String(h).padStart(2, "0")}:${m}`;
  });

  const colorMap: Record<string, string> = {
    영어: "#7da2ff",
    수학: "#6dd47e",
    국어: "#ffb347",
    과학: "#a56eff",
    기타: "#fdd54f",
    학교: "#b0bec5",
  };

  const inRange = (t: string, from?: string, to?: string) =>
    !!from && !!to && from <= t && t < to;

  return (
    <div
      className="timetable-wrapper"
      style={{
        overflowX: "auto",
        padding: 14,
        background: "#FFFFFF",
        borderRadius: 16,
        border: "1px solid #E8E2D8",
        boxShadow: "0 6px 16px rgba(0,0,0,0.05)",
        marginTop: 8,
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11,
          textAlign: "center",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                background: "#F3EFE6",
                padding: "8px 0",
                minWidth: 60,
                color: "#3B2F2A",
                fontWeight: 700,
                letterSpacing: 0.4,
              }}
            >
              시간
            </th>
            {days.map((d) => (
              <th
                key={d}
                style={{
                  background: "#F3EFE6",
                  padding: "8px 0",
                  minWidth: 70,
                  color: "#3B2F2A",
                  fontWeight: 700,
                  letterSpacing: 0.4,
                }}
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {timeLabels.map((label, rowIdx) => (
            <tr key={rowIdx}>
              {/* 왼쪽 시간축 */}
              <td
                style={{
                  padding: "4px 0",
                  borderBottom: "1px solid #EEE",
                  background: "#FAF7F0",
                  fontWeight: 700,
                  color: "#544C42",
                }}
              >
                {label}
              </td>

              {days.map((_, colIdx) => {
                const realDayIndex = (colIdx + 1) % 7;

                const match = Object.entries(merged).find(
                  ([, data]) =>
                    (data as SubjectEntry | undefined)?.slots?.some(
                      (s: TimeSlot) =>
                        s.day === realDayIndex &&
                        inRange(label, s.from, s.to)
                    )
                );

                const custom = sched.timeBlocks?.find((b: any) => {
                  const matchDay =
                    (b.days?.includes(String(realDayIndex)) ?? false) ||
                    b.day === String(realDayIndex);
                  return matchDay && inRange(label, b.start, b.end);
                });

                const subject: string | undefined =
                  custom?.customSubject ||
                  custom?.subject ||
                  (match?.[0] as string | undefined);

                const bg = subject
                  ? colorMap[subject] ?? "#d5d5d5"
                  : "#ffffff";

                return (
       <td
  key={colIdx}
  style={{
    padding: "0px",
    height: "28px",              // 고정 높이
    lineHeight: "28px",          // 텍스트 중앙
    whiteSpace: "nowrap",        // 줄바꿈 방지
    overflow: "hidden",          // 넘치면 감춤
    textOverflow: "ellipsis",    // ... 표시
    borderBottom: "1px solid #EEE",
    background: bg,
    color: subject ? "#fff" : "#555",
    fontWeight: subject ? 700 : 400,
    letterSpacing: subject ? 0.3 : 0,
  }}
>
  {subject ?? ""}
</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function MobileTimeTable({ student }: { student: Student }) {
  const sched = student.personalSchedule;
  if (!sched) return null;

  const merged = {
    ...(sched.current || {}),
    ...(sched.next?.data || {})
  };

  const days = ["월", "화", "수", "목", "금", "토", "일"];

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 12,
      padding: 4
    }}>
      {days.map((day, idx) => {
        const realDayIndex = (idx + 1) % 7;

        // 그 요일의 모든 수업 가져오기
        const subjects = Object.entries(merged).flatMap(([subject, data]) => {
          if (!data?.slots) return [];
          return data.slots
            .filter((s: any) => s.day === realDayIndex)
            .map((slot: any) => ({
              subject,
              from: slot.from,
              to: slot.to
            }));
        });

        return (
          <div
            key={day}
            style={{
              background: "#fff",
              borderRadius: 10,
              padding: "10px 12px",
              boxShadow: "0 3px 6px rgba(0,0,0,0.05)",
              border: "1px solid #eee"
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 8 }}>{day}</div>

            {subjects.length === 0 && (
              <div style={{ fontSize: 12, color: "#aaa" }}>
                수업 없음
              </div>
            )}

            {subjects.map((s, i) => (
              <div
                key={i}
                style={{
                  background: "#f1f5f9",
                  padding: "6px 10px",
                  borderRadius: 8,
                  marginBottom: 6,
                  fontSize: 12,
                  display: "flex",
                  justifyContent: "space-between"
                }}
              >
                <span>{s.subject}</span>
                <span>{s.from} ~ {s.to}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}


/* =================================================================== */
/* 🔥 Optimum Educore — 성적표 통합 컴포넌트 */
/* =================================================================== */

export function GradeSection({
  gradeData,
  comment,
  setComment,
  onSave,
  onDelete,
}: {
  gradeData: any;
  comment: string;
  setComment: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [activeTab, setActiveTab] = useState<
    "중1" | "중2" | "중3" | "브랜치"
  >("중1");

  if (!gradeData) {
    return (
      <div
        style={{
          marginTop: 32,
          padding: "20px 22px",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #E5DED4",
          color: "#777",
          fontSize: 13,
        }}
      >
        성적 데이터가 없습니다.
      </div>
    );
  }

  const termOptions = {
    중1: ["2학기 중간", "2학기 기말"],
    중2: ["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말"],
    중3: ["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말"],
    브랜치: Array.from({ length: 8 }, (_, i) => `모의고사 ${i + 1}회`),
  };

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

  const branchSubjects = ["국어", "수학", "영어", "통합과학", "통합사회", "역사"];

  const getLevel = (my: number, avg: number) => {
    if (!avg) return 0;
    const diff = my - avg;
    if (diff >= 10) return 1;
    if (diff >= 5) return 2;
    if (diff >= -5) return 3;
    if (diff >= -10) return 4;
    return 5;
  };

  const terms = termOptions[activeTab];
  const subjList = activeTab === "브랜치" ? branchSubjects : subjects;

  return (
    <div
      style={{
        marginTop: 32,
        background: "#ffffff",
        padding: "24px 28px",
        borderRadius: 18,
        border: "1px solid #E7DCC9",
        boxShadow: "0 6px 14px rgba(0,0,0,0.06)",
      }}
    >
      {/* 타이틀 */}
      <h2
        style={{
          fontSize: 18,
          fontWeight: 900,
          marginBottom: 18,
          borderLeft: "4px solid #A21CAF",
          paddingLeft: 10,
          color: "#1F2937",
        }}
      >
        성적 요약 & 성취 상태
      </h2>

      {/* 탭 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["중1", "중2", "중3", "브랜치"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 8,
              border: "1px solid #D7CCBF",
              background: activeTab === tab ? "#F5EFE6" : "#FBFAF7",
              fontWeight: 700,
              color: "#4A3F35",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ==========================
           성적 표
      ============================ */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
          textAlign: "center",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <thead>
          <tr style={{ background: "#F5EFE6" }}>
            <th style={{ padding: 10, border: "1px solid #E5DED4" }}>과목</th>

            {terms.map((t) => (
              <th
                key={t}
                colSpan={activeTab === "브랜치" ? 2 : 3}
                style={{ border: "1px solid #E5DED4" }}
              >
                {t}
              </th>
            ))}
          </tr>

          <tr style={{ background: "#FBFAF7" }}>
            <th></th>

            {terms.map((t) =>
              activeTab === "브랜치" ? (
                <>
                  <th>점수</th>
                  <th>등급</th>
                </>
              ) : (
                <>
                  <th>내 점수</th>
                  <th>평균</th>
                  <th>등급</th>
                </>
              )
            )}
          </tr>
        </thead>

        <tbody>
          {subjList.map((subject) => (
            <tr key={subject}>
              <td
                style={{
                  fontWeight: 700,
                  color: "#3F3A37",
                  background: "#FBFAF7",
                  border: "1px solid #EEE",
                  padding: "6px 0",
                }}
              >
                {subject}
              </td>

              {terms.map((term) => {
                const curr =
                  gradeData?.[activeTab]?.[subject]?.[term] || {
                    my: 0,
                    avg: "",
                  };

                if (activeTab === "브랜치") {
                  return (
                    <React.Fragment key={term}>
                      <td style={{ border: "1px solid #EEE" }}>{curr.my}</td>
                      <td style={{ border: "1px solid #EEE" }}>
                        {curr.avg || "-"}
                      </td>
                    </React.Fragment>
                  );
                }

                const level = getLevel(curr.my, curr.avg);
                const colors = ["#4CAF50", "#8BC34A", "#FFC107", "#FB923C", "#F87171"];

                return (
                  <React.Fragment key={term}>
                    <td style={{ border: "1px solid #EEE" }}>{curr.my}</td>
                    <td style={{ border: "1px solid #EEE" }}>{curr.avg}</td>
                    <td
                      style={{
                        border: "1px solid #EEE",
                        background: colors[level - 1] || "#DDD",
                        color: "white",
                        fontWeight: 700,
                      }}
                    >
                      {["A", "B", "C", "D", "E"][level - 1] || "-"}
                    </td>
                  </React.Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ============================
          COMMENT 입력 영역
      ============================ */}
      <div
        style={{
          marginTop: 24,
          padding: "14px 16px",
          background: "#FFFDF8",
          border: "1px solid #E7DCC9",
          borderRadius: 12,
          boxShadow: "0 4px 10px rgba(0,0,0,0.04)",
        }}
      >
        <div
          style={{
            fontWeight: 800,
            marginBottom: 10,
            color: "#A21CAF",
            fontSize: 14,
          }}
        >
          📝 COMMENT
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="성취도나 지도 방향에 대한 코멘트를 입력해주세요."
          style={{
            width: "100%",
            minHeight: 90,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #D6CFC0",
            fontSize: 13,
            lineHeight: 1.5,
            resize: "vertical",
            background: "#FFFFFF",
          }}
        />

        {/* 저장 / 삭제 버튼 */}
        <div style={{ display: "flex", marginTop: 12, gap: 10 }}>
          <button
            onClick={onSave}
            style={{
              flex: 1,
              padding: "8px 0",
              background: "#E6F0FF",
              border: "1px solid #BFD1F4",
              borderRadius: 8,
              fontWeight: 700,
            }}
          >
            저장
          </button>

          <button
            onClick={onDelete}
            style={{
              width: 90,
              padding: "8px 0",
              background: "#FCE7E7",
              border: "1px solid #F5C2C2",
              borderRadius: 8,
              fontWeight: 700,
            }}
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
/* =================================================================== */
/* 공통 컴포넌트 */
/* =================================================================== */

function TimelineItem({ label, time }: { label: string; time?: string }) {
  if (!time) return null;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        fontSize: 13,
      }}
    >
      <span>{label}</span>
      <span style={{ fontWeight: 600 }}>{time}</span>
    </div>
  );
}

/* =================================================================== */
/* 도넛 그래프 */
/* =================================================================== */

function DoughnutChart({
  study,
  rest,
  short,
}: {
  study: number;
  rest: number;
  short: number;
}) {
  const total = study + rest + short;
  if (total === 0) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
        아직 집계된 학습 시간이 없습니다.
      </div>
    );
  }

  const pct = (v: number) => (v / total) * 100;

  return (
    <div style={{ margin: "0 auto", width: 180, height: 180 }}>
      <svg viewBox="0 0 36 36">
        <circle
          cx="18"
          cy="18"
          r="16"
          stroke="#e5e7eb"
          strokeWidth="4"
          fill="none"
        />
        <circle
          cx="18"
          cy="18"
          r="16"
          stroke="#2563EB"
          strokeWidth="4"
          strokeDasharray={`${pct(study)} ${100 - pct(study)}`}
          strokeDashoffset={25}
          fill="none"
        />
        <circle
          cx="18"
          cy="18"
          r="16"
          stroke="#DC2626"
          strokeWidth="4"
          strokeDasharray={`${pct(rest)} ${100 - pct(rest)}`}
          strokeDashoffset={25 - pct(study)}
          fill="none"
        />
        <circle
          cx="18"
          cy="18"
          r="16"
          stroke="#0EA5E9"
          strokeWidth="4"
          strokeDasharray={`${pct(short)} ${100 - pct(short)}`}
          strokeDashoffset={25 - pct(study) - pct(rest)}
          fill="none"
        />
      </svg>
    </div>
  );
}