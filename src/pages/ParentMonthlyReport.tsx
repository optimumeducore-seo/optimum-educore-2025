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
  inTime?: string;   // ⭐ 여기에 이 줄 추가

  outTime?: string;
  studyMin?: number;
  commuteMin?: number;
  restroomMin?: number;
  mealMin?: number;
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
  academy: number;
};

function hmToMin(hm?: string) {
  if (!hm) return 0;
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/* ===========================================
   ⭐ 학원시간 계산 util 함수 (여기 붙여!)
=========================================== */
function getAcademySummary(records: Records, monthDates: string[]) {
  const result: Record<string, number> = {};

  monthDates.forEach(date => {
    const cell = records[date];
    if (!cell?.academyBySubject) return;

    Object.entries(cell.academyBySubject).forEach(([subject, data]) => {
      const total = data.slots?.reduce((sum, slot) => {
        if (!slot.from || !slot.to) return sum;
        const [fh, fm] = slot.from.split(":").map(Number);
        const [th, tm] = slot.to.split(":").map(Number);
        return sum + (th * 60 + tm - (fh * 60 + fm));
      }, 0) || 0;

      if (total > 0) {
        result[subject] = (result[subject] || 0) + total;
      }
    });
  });

  return result;
}

function getOutingWarning(summary: Summary) {
  if (summary.days === 0) return null;

  const avg = summary.short / summary.days; // 하루 평균 생활시간(분)

  if (avg >= 180) {
    return {
      level: 3,
      message: "⚠ 생활시간이 하루 3시간 이상으로 매우 많은 편입니다. 학습 흐름이 자주 끊겼을 가능성이 높습니다.",
      color: "#B91C1C",
      bg: "#FEE2E2"
    };
  }

  if (avg >= 150) {
    return {
      level: 2,
      message: "⚠ 생활시간이 하루 2시간 30분 이상입니다. 이동·식사 루틴 조정이 필요합니다.",
      color: "#C2410C",
      bg: "#FFEDD5"
    };
  }

  if (avg >= 120) {
    return {
      level: 1,
      message: "⚠ 생활시간이 하루 2시간 이상입니다. 집중 흐름을 해치지 않도록 주의가 필요합니다.",
      color: "#92400E",
      bg: "#FEF3C7"
    };
  }

  if (avg >= 90) {
    return {
      level: 0,
      message: "생활시간이 하루 1.5시간 이하로 안정적으로 유지되었습니다.",
      color: "#166534",
      bg: "#DCFCE7"
    };
  }

  return {
    level: 0,
    message: "생활시간이 매우 안정적으로 관리되었습니다.",
    color: "#166534",
    bg: "#DCFCE7"
  };
}

function getLifestyleMessage(summary: Summary) {
  const { study, short } = summary;

  if (short > study * 0.6) {
    return "생활시간이 학습시간 대비 높았던 날이 많습니다. 이동·식사·휴식 시간을 줄일 수 있는 루틴 점검이 필요합니다.";
  }

  if (short > 180) {
    return "이동/식사/화장실 시간이 길었던 날이 있었어요. 동선이나 루틴을 최적화하면 학습 흐름이 더 좋아질 수 있습니다.";
  }

  return "생활시간과 학습시간의 균형이 안정적으로 유지되었습니다.";
}

function getAcademyRatioMessage(summary: Summary) {
  const { study, academy } = summary;
  const total = study + academy;

  if (total === 0) return "";

  const ratio = Math.round((academy / total) * 100);

  if (ratio >= 60) {
    return `학원 학습시간이 전체의 ${ratio}%로 높은 편이에요. 학원 중심 루틴이 안정적으로 유지되고 있습니다.`;
  }

  if (ratio >= 30) {
    return `학원 학습 비중은 ${ratio}%로 균형적인 편입니다.`;
  }

  return `학원 학습 비중이 ${ratio}%로 낮습니다. 자율 학습 비중이 높았던 달입니다.`;
}

function getGrowthMessage(prev: Summary | null, curr: Summary) {
  if (!prev) {
    return "이번 달이 첫 기록입니다.";
  }

  const diffStudy = curr.study - prev.study;
  const diffAcademy = curr.academy - prev.academy;

  let msg = "";

  if (diffStudy > 0) {
    msg += `순공시간이 지난달보다 ${diffStudy}분 증가했습니다. `;
  } else if (diffStudy < 0) {
    msg += `순공시간이 지난달보다 ${Math.abs(diffStudy)}분 감소했습니다. `;
  }

  if (diffAcademy > 0) {
    msg += `학원 학습시간은 ${diffAcademy}분 늘었습니다.`;
  } else if (diffAcademy < 0) {
    msg += `학원 학습시간은 ${Math.abs(diffAcademy)}분 줄었습니다.`;
  }

  if (!msg) {
    msg = "지난달과 큰 변화 없이 안정적으로 유지되었습니다.";
  }

  return msg;
}




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
  const [month, setMonth] = useState(() =>
  new Date().toISOString().slice(0, 7)
);
function changeMonth(offset: number) {
  const current = new Date(month + "-01");
  current.setMonth(current.getMonth() + offset);
  setMonth(current.toISOString().slice(0, 7));
}
const btnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#EEE8DF",
  borderRadius: 8,
  border: "1px solid #D6CEC5",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

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

  const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
];

function getEnglishMonth(ym: string) {
  const [year, m] = ym.split("-");
  const monthName = MONTH_NAMES[Number(m) - 1];
  return `${monthName} ${year}`;
}

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
  let academy = 0;  // ⭐ 추가

  monthDates.forEach((date) => {
    const cell = records[date];
    if (!cell) return;

    days++;

    // 순공 계산: 등원~하원
    const start = cell.time ? hmToMin(cell.time) : 0;
    const end = cell.outTime ? hmToMin(cell.outTime) : start;
    const gross = Math.max(0, end - start);

    // 이동/화장실/식사
    const outing =
      (cell.commuteMin ?? 0) +
      (cell.restroomMin ?? 0) +
      (cell.mealMin ?? 0);

    // 순공 + 생활시간
    study += Math.max(0, gross - outing);
    short += outing;

    // ⭐⭐⭐ 학원시간 누적
    if (cell.academyBySubject) {
      Object.values(cell.academyBySubject).forEach((data: any) => {
        const academyTotal =
          data.slots?.reduce((sum: number, slot: any) => {
            if (!slot.from || !slot.to) return sum;
            const [fh, fm] = slot.from.split(":").map(Number);
            const [th, tm] = slot.to.split(":").map(Number);
            return sum + ((th * 60 + tm) - (fh * 60 + fm));
          }, 0) || 0;

        academy += academyTotal;
      });
    }
  });

  // ⭐ return에 academy 반드시 포함!!
  return { days, study, rest, short, academy };
}, [monthDates, records]);

 


  const prevSummary = useMemo(() => {
    const prevMonth = new Date();
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const prevMonthKey = prevMonth.toISOString().slice(0, 7);

    const prevMonthDates = sortDates(
      Object.keys(records).filter((d) => d.startsWith(prevMonthKey))
    );

    if (prevMonthDates.length === 0) return null;

    let study = 0;
    let rest = 0;
    let short = 0;
    let days = 0;
    let academy = 0;

    prevMonthDates.forEach((date) => {
      const cell = records[date];
      if (!cell) return;

      days++;

      const start = cell.time ? hmToMin(cell.time) : 0;
      const end = cell.outTime ? hmToMin(cell.outTime) : start;
      const gross = Math.max(0, end - start);

      const outing =
        (cell.commuteMin ?? 0) +
        (cell.restroomMin ?? 0) +
        (cell.mealMin ?? 0);

      study += Math.max(0, gross - outing);
      short += outing;

      if (cell.academyBySubject) {
        Object.values(cell.academyBySubject).forEach((data: any) => {
          const academyTotal =
            data.slots?.reduce((sum: number, slot: any) => {
              if (!slot.from || !slot.to) return sum;
              const [fh, fm] = slot.from.split(":").map(Number);
              const [th, tm] = slot.to.split(":").map(Number);
              return sum + ((th * 60 + tm) - (fh * 60 + fm));
            }, 0) || 0;

          academy += academyTotal;
        });
      }
    });

    return { days, study, rest, short, academy };
  }, [records]);

  const attendanceDays = monthDates.filter(date => !!records[date]?.time).length;
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

  const outingWarning = getOutingWarning(summary);

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




          {/* 🔥 달 변경 + 인쇄 버튼 — 에듀코어 스타일 */}
{/* 🔥 Month Selector + Print — English Premium Style */}
<div
  className="no-print"
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#F8F5EF",
    border: "1px solid #E4DED4",
    borderRadius: 14,
    padding: "14px 20px",
    marginBottom: 28,
    fontFamily: "'Pretendard','Noto Sans KR',sans-serif",
  }}
>
  {/* ◀ prev month */}
  <button
    onClick={() => changeMonth(-1)}
    style={{
      padding: "6px 12px",
      background: "#EDE9DF",
      borderRadius: 8,
      border: "1px solid #D6CEC2",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 700,
      color: "#5A4A3A",
    }}
  >
    ◀
  </button>

  {/* English Month */}
  <div
    style={{
      fontSize: 22,
      fontWeight: 800,
      color: "#3A342E",
      letterSpacing: "0.5px",
    }}
  >
    {getEnglishMonth(month)}
  </div>

  {/* ▶ next month */}
  <button
    onClick={() => changeMonth(1)}
    style={{
      padding: "6px 12px",
      background: "#EDE9DF",
      borderRadius: 8,
      border: "1px solid #D6CEC2",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 700,
      color: "#5A4A3A",
    }}
  >
    ▶
  </button>

  {/* Print */}
  <button
    onClick={() => window.print()}
    style={{
      marginLeft: 12,
      padding: "6px 18px",
      background: "#C8A76A",
      color: "#4A3A25",
      fontWeight: 700,
      fontSize: 12,
      borderRadius: 8,
      border: "1px solid #B89A5A",
      cursor: "pointer",
      whiteSpace: "nowrap",
    }}
  >
    🖨 PRINT
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
   <MessageSection
  lifestyle={getLifestyleMessage(summary)}
  academy={getAcademyRatioMessage(summary)}
  growth={getGrowthMessage(prevSummary, summary)}
  outingWarning={outingWarning}
/>
        
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

function DoughnutSection({ summary }: { summary: any }) {
  const items = [
    { label: "순공", value: summary.study, color: "#1E3A8A" },
    { label: "생활시간(이동·식사·화장실)", value: summary.short, color: "#b4d149ff" },
    { label: "학원학습", value: summary.academy, color: "#C8A76A" },
  ];

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

      <div
        style={{
          display: "flex",
          gap: 24,
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        {/* 도넛 */}
        <DoughnutChart
          study={summary.study}
          rest={summary.rest}
          short={summary.short}
          academy={summary.academy}
        />

        {/* 범례 */}
        <div style={{ fontSize: 14, color: "#333", minWidth: 180 }}>
          {items.map(
            (item) =>
              item.value > 0 && (
                <div
                  key={item.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: item.color,
                      marginRight: 10,
                    }}
                  />
                  <span style={{ fontWeight: 700 }}>{item.label}</span>
                  <span style={{ marginLeft: "auto" }}>
                    {item.value}분
                  </span>
                </div>
              )
          )}
        </div>
      </div>

      <div
  style={{
    marginTop: 8,
    fontSize: 13,
    fontWeight: 700,
  }}
>
  출석일: {summary.days}일
</div>
    </div>
  );
}

function MessageSection({
  lifestyle,
  academy,
  growth,
  outingWarning,
}: {
  lifestyle: string;
  academy: string;
  growth: string;
  outingWarning: any;
}) {
  return (
    <div
      style={{
        marginTop: 30,
        padding: "20px 22px",
        background: "#FFFDF8",
        borderRadius: 16,
        border: "1px solid #E7DCC9",
        boxShadow: "0 6px 12px rgba(0,0,0,0.05)",
        fontSize: 14,
        lineHeight: 1.6,
        color: "#333",
      }}
    >
      <h2
        style={{
          fontSize: 18,
          fontWeight: 900,
          marginBottom: 14,
          borderLeft: "4px solid #D4A65A",
          paddingLeft: 10,
        }}
      >
        월간 분석 리포트
      </h2>

      {/* 🟦 생활 패턴 분석 */}
      <div style={{ marginBottom: 10 }}>
        <b>🟦 생활 패턴 분석</b>
        <br />
        {lifestyle}
      </div>

      {/* 🟨 학원 학습 비율 */}
      <div style={{ marginBottom: 10 }}>
        <b>🟨 학원 학습 비율</b>
        <br />
        {academy}
      </div>

      {/* 🟩 성장 변화 */}
      <div style={{ marginBottom: 14 }}>
        <b>🟩 성장 변화(전월 대비)</b>
        <br />
        {growth}
      </div>

      {/* 🔥 생활시간 경고 박스 */}
      {outingWarning && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 12,
            background: outingWarning.bg,
            color: outingWarning.color,
            fontWeight: 700,
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {outingWarning.message}
        </div>
      )}
    </div>
  );
}

/* =================================================================== */
/* 타임라인 섹션 */
/* =================================================================== */



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

  const outing =
    (cell.commuteMin ?? 0) +
    (cell.mealMin ?? 0) +
    (cell.restroomMin ?? 0);

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
      {/* 날짜 */}
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
        {date}
      </div>

      {/* 등원, 하원 */}
<TimelineItem label="등원" time={cell.time || cell.inTime} />
<TimelineItem label="하원" time={cell.outTime} />

      {/* ⭐ 생활시간 총합 강조 박스 */}
      <div
        style={{
          marginTop: 8,
          padding: "6px 10px",
          background: "#FFE5E5",       // 연핑크 배경
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          color: "#B91C1C",            // 진한 레드 텍스트
        }}
      >
        생활시간 총합: {outing}분
      </div>

      {/* 순공 */}
      <TimelineItem
        label="순공"
        time={
          typeof cell.studyMin === "number"
            ? `${cell.studyMin}분`
            : undefined
        }
      />

      {/* 세부 생활시간 */}
      {typeof cell.restroomMin === "number" && (
        <TimelineItem label="화장실" time={`${cell.restroomMin}분`} />
      )}

      {typeof cell.commuteMin === "number" && (
        <TimelineItem label="이동" time={`${cell.commuteMin}분`} />
      )}

      {typeof cell.mealMin === "number" && (
        <TimelineItem label="식사" time={`${cell.mealMin}분`} />
      )}

      {/* 학원 */}
      {cell.academyBySubject && (
        <>
          <div
            style={{ marginTop: 8, fontWeight: 700, fontSize: 13 }}
          >
            학원
          </div>

          {Object.entries(cell.academyBySubject).map(([sub, data]) => {
            const total =
              data.slots?.reduce((sum, slot) => {
                if (!slot.from || !slot.to) return sum;
                const [fh, fm] = slot.from.split(":").map(Number);
                const [th, tm] = slot.to.split(":").map(Number);
                return sum + (th * 60 + tm - (fh * 60 + fm));
              }, 0) || 0;

            return (
              <TimelineItem
                key={sub}
                label={` - ${sub}`}
                time={`${total}분`}
              />
            );
          })}
        </>
      )}

      {/* 메모 */}
      {cell.memo && (
        <TimelineItem label="메모" time={cell.memo} />
      )}
    </div>
  );
})}
      </div>
    </div>
  );
}

function AcademySection({ academy }: { academy: Record<string, number> }) {
  const total = Object.values(academy).reduce((a, b) => a + b, 0);

  if (total === 0) return null;

  return (
    <div style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 800,
          margin: "20px 0 10px",
          borderLeft: "4px solid #8B5CF6",
          paddingLeft: 10,
        }}
      >
        학원 학습 요약
      </h2>

      <div style={{ fontSize: 14, marginBottom: 8 }}>
        총 학원 학습시간: <b>{total}분</b>
      </div>

      <div
        style={{
          background: "#faf7ff",
          border: "1px solid #e5d8ff",
          padding: "12px 16px",
          borderRadius: 12,
        }}
      >
        {Object.entries(academy).map(([sub, min]) => (
          <div
            key={sub}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 13,
            }}
          >
            <span>{sub}</span>
            <span>{min}분</span>
          </div>
        ))}
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
  academy,
}: {
  study: number;
  rest: number;
  short: number;
  academy: number;
}) {
  const total = study + academy + short;
  const totalLearning = study + academy;   // ⭐ 중앙 숫자용
  const OFFSET = 25;

  if (total === 0) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
        아직 집계된 학습 시간이 없습니다.
      </div>
    );
  }

  const pct = (v: number) => (v / total) * 100;

  return (
    <div style={{ position: "relative", width: "180px", height: "180px" }}>
      <svg viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="18" cy="18" r="16" stroke="#E5E7EB" strokeWidth="4" fill="none" />

        {/* 순공 */}
        <circle
          cx="18"
          cy="18"
          r="16"
          stroke="#1E3A8A"
          strokeWidth="4"
          strokeDasharray={`${pct(study)} ${100 - pct(study)}`}
          strokeDashoffset={OFFSET}
          fill="none"
        />

        {/* 학원학습 */}
        <circle
          cx="18"
          cy="18"
          r="16"
          stroke="#C8A76A"
          strokeWidth="4"
          strokeDasharray={`${pct(academy)} ${100 - pct(academy)}`}
          strokeDashoffset={OFFSET - pct(study)}
          fill="none"
        />

        {/* 생활시간 */}
        <circle
          cx="18"
          cy="18"
          r="16"
          stroke="#b4d149ff"
          strokeWidth="4"
          strokeDasharray={`${pct(short)} ${100 - pct(short)}`}
          strokeDashoffset={OFFSET - pct(study) - pct(academy)}
          fill="none"
        />
      </svg>

      {/* 중앙 숫자 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 18, color: "#1E293B" }}>
          {totalLearning}분
        </div>
        <div style={{ fontSize: 10, color: "#6B7280" }}>총 학습</div>
      </div>
      
    </div>
    
  );
}
