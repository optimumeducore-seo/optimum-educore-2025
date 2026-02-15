// src/pages/ParentMonthlyReport.tsx
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";

import { useParams, useNavigate, NavLink } from "react-router-dom";

import { db } from "../firebase";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";

import html2canvas from "html2canvas";
import jsPDF from "jspdf";

import { loadGrade } from "../services/firestore";
import { loadMockExams } from "../services/firestore";

import BridgeMockExamSection from "../components/BridgeMockExamSection";

/* 🔥 studyCalc는 한 번만 */
import {
  calcNetStudyMin,
  calcNetStudyMin_SP,
  calcBreakdown,
  calcByType,
  type Segment,
  type SegmentType,
} from "../utils/studyCalc";


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
  academyIn?: string;
  academyOut?: string;
  academyBySubject?: Record<string, SubjectEntry>;
  subjects?: Record<
    string,
    {
      wordTest?: { correct?: number; total?: number };
    }
  >;
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
  study: number;   // 에듀코어
  academy: number; // 학원(기타학원 포함)
  meal: number;    // 식사
  outing: number;  // 외출
};

const segLabelMap: Record<string, string> = {
  MATH: "수학",
  ENGLISH: "영어",
  KOREAN: "국어",
  SCIENCE: "과학",
  OTHER_ACADEMY: "기타",
  MEAL: "식사",
  OUTING: "외출",
};


function hmToMin(hm?: string) {
  if (!hm) return 0;
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function formatHM(min?: number) {
  if (!min || min <= 0) return "0분";

  const h = Math.floor(min / 60);
  const m = min % 60;

  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

function safeHM(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw !== "string") return null;

  if (raw.includes("T")) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  if (raw.includes(":")) return raw.slice(0, 5);
  return null;
}

function getWordTestTotal(source: any) {
  if (!source) return { correct: 0, total: 0 };

  let correct = 0;
  let total = 0;

  // 0) 루트에 wordTest가 바로 있는 경우
  if (source.wordTest?.total > 0) {
    correct += Number(source.wordTest.correct ?? 0);
    total += Number(source.wordTest.total ?? 0);
  }

  // 1) records 형태: subjects 안에 있는 경우
  const subjectsObj = source.subjects && typeof source.subjects === "object" ? source.subjects : null;
  if (subjectsObj) {
    Object.values(subjectsObj).forEach((sub: any) => {
      if (sub?.wordTest?.total > 0) {
        correct += Number(sub.wordTest.correct ?? 0);
        total += Number(sub.wordTest.total ?? 0);
      }
    });
  }

  // 2) dayPlan 형태: kor/eng/math 같은 과목키가 루트에 있는 경우
  const subjectKeys = ["kor", "eng", "math", "soc", "hist2", "his1", "sci", "sci1", "tech", "hanja", "jp"];
  subjectKeys.forEach((k) => {
    const v = source?.[k];
    if (v?.wordTest?.total > 0) {
      correct += Number(v.wordTest.correct ?? 0);
      total += Number(v.wordTest.total ?? 0);
    }
  });

  // 3) teacherTasks 안에 wordTest가 섞여있는 경우(혹시 몰라서)
  const tt = source.teacherTasks;
  const tList = Array.isArray(tt) ? tt : tt && typeof tt === "object" ? Object.values(tt) : [];
  tList.forEach((t: any) => {
    if (t?.wordTest?.total > 0) {
      correct += Number(t.wordTest.correct ?? 0);
      total += Number(t.wordTest.total ?? 0);
    }
  });

  return { correct, total };
}

async function loadRecordsForStudent(studentId: string): Promise<Records> {
  const result: Records = {};

  // records 컬렉션의 모든 날짜 문서(예: 2025-11-20, 2025-11-21 ...)
  const snap = await getDocs(collection(db, "records"));

  snap.forEach((docSnap) => {
    const date = docSnap.id;          // "2025-11-20"
    const data = docSnap.data() as any;

    // 날짜 문서 안에서 이 학생의 필드만 꺼냄
    const cell = data[studentId];

    if (cell) {
      result[date] = cell as DayCell;
    }
  });

  return result;
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

/* ================================
   🔵 모의고사 요약 계산
 
================================ */
{/*
function getLifestyleMessage(summary: Summary) {
  const { study, academy, meal, outing } = summary;

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
  */}

/* ===============================
   ⭐ 모의고사 자동 분석 함수
================================ */
function analyzeScores(scores: any) {
  const result: any = { overall: [], subjects: {} };

  Object.entries(scores).forEach(([gradeLevel, subjects]: any) => {
    if (!subjects) return;

    Object.entries(subjects).forEach(([sub, terms]: any) => {
      let totalMy = 0;
      let totalAvg = 0;
      let count = 0;

      Object.values(terms).forEach((t: any) => {
        totalMy += Number(t.my || 0);
        totalAvg += Number(t.avg || 0);
        count++;
      });

      if (count === 0) return;

      const my = totalMy / count;
      const avg = totalAvg / count;
      const gap = my - avg;

      let msg = "";
      if (gap >= 10) msg = "평균보다 높아 강점이 잘 보입니다.";
      else if (gap >= 0) msg = "평균과 비슷하며 안정적입니다.";
      else if (gap >= -10) msg = "평균 이하로, 보완이 필요합니다.";
      else msg = "평균보다 많이 낮아 집중 보완이 필요합니다.";

      result.subjects[sub] = {
        my: Math.round(my),
        avg: Math.round(avg),
        gap: Math.round(gap),
        message: msg,
      };

      if (gap <= -10)
        result.overall.push(`${sub} 은(는) 평균보다 ${Math.abs(gap)}점 낮아 보완이 필요합니다.`);
      else if (gap < 0)
        result.overall.push(`${sub} 은(는) 평균보다 약간 낮은 편입니다.`);
      else if (gap >= 10)
        result.overall.push(`${sub} 은(는) 매우 우수합니다.`);
    });
  });

  return result;
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

function getLatestMockSummary(gradeData: any) {
  if (!gradeData) return [];

  const result: Array<{ subject: string; grade: any; latest: string }> = [];

  // 🔥 브릿지 여부 확인 (브랜치 키 존재하면 브릿지)
  const isBridge = !!gradeData["브릿지"];

  // 🔥 과목 목록 가져오기
  const subjects = isBridge
    ? Object.keys(gradeData["브릿지"])
    : Object.keys(gradeData["중3"] || gradeData["중2"] || gradeData["중1"] || {});

  subjects.forEach((sub) => {
    // 🔥 과목별 시험 데이터
    const mock = isBridge
      ? gradeData["브릿지"]?.[sub]              // 예: 브랜치 → 국어 → 모의고사 1회
      : gradeData["중3"]?.[sub] ||              // 중3 국어 → 1학기/2학기 시험들
        gradeData["중2"]?.[sub] ||
        gradeData["중1"]?.[sub];

    if (!mock) return;

    // 🔥 시험 회차 정렬
    const keys = Object.keys(mock).sort();
    const latestKey = keys[keys.length - 1];
    const latest = mock[latestKey];

    if (!latest) return;

    // 🔥 브릿지는 avg = 등급
    const grade =
      isBridge ? latest.avg : latest.grade ?? latest.avg ?? "-";

    result.push({
      subject: sub,
      grade,
      latest: latestKey, // 예: 모의고사 3회 / 2학기 기말
    });
  });

  return result;
}

async function mergeBridgeMock(list: any, id: string) {
  const snap = await getDocs(
    collection(db, `mockExams/${id}/bridgeMock`)
  );

  snap.forEach((doc) => {
    const data = doc.data();
    const term = data.round
      ? `모의고사 ${data.round}회`
      : "모의고사 1회";

    const subjects = data.subjects || {};

    Object.keys(subjects).forEach((sub) => {
      const s = subjects[sub];

      const score = s.totalScore ?? 0;
      const grade = s.grade ?? 0;

      if (!list["브릿지"]) list["브릿지"] = {};
      if (!list["브릿지"][sub]) list["브릿지"][sub] = {};

      list["브릿지"][sub][term] = {
        my: score,
        avg: grade, // 브릿지는 avg = 등급
      };
    });
  });
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

const SUBJECT_LABEL: Record<string, string> = {
  soc: "사회",
  hist2: "한국사",
  sci: "과학",
  sci1: "과학", // ✅ 추가 (날짜에 따라 sci1로 저장된 케이스 대응)
  kor: "국어",
  eng: "영어",
  his1: "세계사",
  math: "수학",
  tech: "기술가정",
  hanja: "한자",
  jp: "일본어",
};

const SUBJECT_KEYS = new Set([
  "kor",
  "eng",
  "math",
  "soc",
  "hist2",
  "his1",
  "sci",  // ✅ 추가 (실데이터에 sci가 있음)
  "sci1", // ✅ 유지
  "tech",
  "hanja",
  "jp",
]);

function extractItemsFromDayPlan(dayPlan: any): { done: boolean }[] {
  if (!dayPlan) return [];
  const items: { done: boolean }[] = [];

  // ✅ teacherTasks: 배열/객체 둘 다 처리
  const tt = dayPlan.teacherTasks;

  const tList = Array.isArray(tt)
    ? tt
    : tt && typeof tt === "object"
      ? Object.values(tt)
      : [];

  tList.forEach((t: any) => {
    if (!t) return;

    // subtasks 배열 있으면 그걸로 카운트
    if (Array.isArray(t.subtasks) && t.subtasks.length) {
      t.subtasks.forEach((st: any) => items.push({ done: st?.done === true }));
      return;
    }

    // text만 있는 과제도 1개로 카운트
    if (String(t?.text ?? t?.title ?? "").trim() !== "") {
      items.push({ done: t?.done === true });
      return;
    }

    // 그래도 1개로 치고 싶으면 (옵션)
    items.push({ done: t?.done === true });
  });

  // ✅ 과목 done (kor/soc/hist2/sci/sci1...)
  Object.entries(dayPlan).forEach(([k, v]: any) => {
    if (!SUBJECT_KEYS.has(k)) return;
    if (!v || typeof v !== "object") return;
    if ("done" in v) items.push({ done: v.done === true });
  });

  return items;
}

function calcTotalStats(dayPlan: any) {
  const items = extractItemsFromDayPlan(dayPlan);
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const rate = total ? Math.round((done / total) * 100) : 0;
  return { total, done, rate };
}

/* ===============================
   메인 컴포넌트
================================ */
export default function ParentMonthlyReport() {
  const { id } = useParams();
  if (!id) {
  return <div style={{ padding: 40 }}>잘못된 접근입니다. (id 없음)</div>;
}
  const nav = useNavigate();

  const [student, setStudent] = useState<Student | null>(null);
  const [records, setRecords] = useState<Records>({});
    const [month, setMonth] = useState(() =>
  new Date().toISOString().slice(0, 7)
);
  const [viewYear, setViewYear] = useState(() => Number(month.split("-")[0]));
const [viewMonth, setViewMonth] = useState(() => Number(month.split("-")[1]) - 1);

useEffect(() => {
  setViewYear(Number(month.split("-")[0]));
  setViewMonth(Number(month.split("-")[1]) - 1);
}, [month]);
const [gradeData, setGradeData] = useState<any>(null);
const [comment, setComment] = useState("");
const [analysis, setAnalysis] = useState<any>(null);
const [openTimeline, setOpenTimeline] = useState(false);
const [open, setOpen] = useState(false);
const [showDayModal, setShowDayModal] = useState(false);
const [dayDetail, setDayDetail] = useState<any>(null);
const [dayPlan, setDayPlan] = useState<any>(null);

const [openSubject, setOpenSubject] = useState<string | null>(null);

const tasksArr = useMemo(() => {
  if (!dayPlan) return [];
  const ignore = new Set([
    "date","createdAt","updatedAt","done","id","memo","comment","name",
    "teacherTasks","studentPlans","wordTest","proofImages","proofMemo" // ✅ 여기 추가
  ]);


  return Object.entries(dayPlan)
    .filter(([k, v]) => !ignore.has(k) && v != null)
    .map(([k, v]) => ({
      key: k,
      title: SUBJECT_LABEL[k] || k,
      raw: v, // ✅ 클릭했을 때 상세로 쓸 수도 있으니 raw만 들고감
    }));
}, [dayPlan]);

const totalStats = useMemo(() => calcTotalStats(dayPlan), [dayPlan]);

const [dayPlanLoading, setDayPlanLoading] = useState(false);

async function loadDayPlan(dateStr: string) {
  console.log("🔥 loadDayPlan called:", dateStr, "id:", id);
  

  if (!id) return;
  setDayPlanLoading(true);

  try {
    const ref = doc(db, "studyPlans", id, "days", dateStr);
    const snap = await getDoc(ref);
const data = snap.exists() ? snap.data() : null;

console.log("DAYPLAN RAW:", data);
console.log("teacherTasks RAW:", data?.teacherTasks);
console.log("teacherTasks values:", data?.teacherTasks ? Object.values(data.teacherTasks) : null);

console.log("extractItemsFromDayPlan:", extractItemsFromDayPlan(data));
console.log("calcTotalStats:", calcTotalStats(data));

setDayPlan(data);
  } catch (e) {
    console.error("loadDayPlan failed", e);
    setDayPlan(null);
  } finally {
    setDayPlanLoading(false);
  }
}

// 부모 페이지 month는 "2026-02" 같은 문자열이 이미 있으니

const recordsList = useMemo(() => {
  return Object.entries(records || {}).map(([date, cell]: any) => ({
    date,
    ...(cell || {}),
  }));
}, [records]);
const renderCalendar = () => {
  if (!recordsList.length) return <p style={{ color: "#aaa" }}>출결 데이터 없음</p>;

  const year = viewYear;
  const monthIdx = viewMonth;

  const lastDay = new Date(year, monthIdx + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, monthIdx, 1).getDay();
  const blanks = Array(firstDayOfWeek).fill(null);

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: 14, gap: 16 }}>
        <button
          onClick={() => {
            if (monthIdx === 0) {
              setViewMonth(11);
              setViewYear(year - 1);
            } else setViewMonth(monthIdx - 1);
          }}
          style={{ width: 32, height: 32, borderRadius: "50%", background: "#f3f4f6", border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 16 }}
        >
          ←
        </button>

        <h4 style={{ margin: 0, color: "#1e3a8a", fontWeight: 800, fontSize: 16, textAlign: "center", minWidth: 140 }}>
           {year}-{String(monthIdx + 1).padStart(2, "0")}
        </h4>

        <button
          onClick={() => {
            if (monthIdx === 11) {
              setViewMonth(0);
              setViewYear(year + 1);
            } else setViewMonth(monthIdx + 1);
          }}
          style={{ width: 32, height: 32, borderRadius: "50%", background: "#f3f4f6", border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 16 }}
        >
          →
        </button>
      </div>

      {/* 요일 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", marginBottom: 8, color: "#555", fontWeight: 700, fontSize: 12 }}>
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => <div key={d}>{d}</div>)}
      </div>

      {/* 날짜 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {blanks.map((_, i) => <div key={"blank" + i} />)}

        {[...Array(lastDay)].map((_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

          const dow = new Date(dateStr).getDay();
          const log = recordsList.find((r: any) => r.date === dateStr);
         // if (log) console.log("LOG RAW:", dateStr, log);

          let bg = "#F3F4F6"; // 기본 회색

// 토요일
if (dow === 6) bg = "#EEF2FF"; // 은은한 블루그레이

// 일요일
if (dow === 0) bg = "#FDECEC"; // 연한 와인톤

// 출석 로그가 있을 경우
if (log) {
  if (log.time || log.inTime) {
    bg = "#efebdd"; // ✨ 고급 베이지골드
  } else {
    bg = "#FDECEC"; // 결석은 은은한 레드
  }

          }

          // 간단 라벨(등/하원)
          const inTimeLabel = safeHM(log?.time ?? log?.inTime);
          const outTimeLabel = safeHM(log?.outTime);

          // 과목/활동(segments에서 1개 pick)
          const segLabelMap: Record<string, string> = {
            MATH: "수학",
            ENGLISH: "영어",
            KOREAN: "국어",
            SCIENCE: "과학",
            OTHER_ACADEMY: "기타",
            MEAL: "식사",
            OUTING: "외출",
          };

          let segmentsLabel: string | null = null;
          if (log && Array.isArray(log.segments) && log.segments.length > 0) {
            const openOne = log.segments.find((s: any) => s?.start && !s?.end);
            const doneOne = log.segments.find((s: any) => s?.start && s?.end);
            const pick = openOne ?? doneOne;
            if (pick) segmentsLabel = segLabelMap[pick.type] ?? pick.type;
          }

         return (
  <div
    key={dateStr}
    onClick={async () => {
      if (!id) return;
console.log("🔥 CLICKED:", dateStr, "id:", id);
      console.log("🔥 CLICKED:", dateStr);

      setDayDetail({ date: dateStr, ...(log ?? {}) });
      setShowDayModal(true);

      await loadDayPlan(dateStr);
    }}
    style={{
      borderRadius: 10,
      background: bg,
      color: "#374151",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      fontWeight: 600,
      fontSize: 13,
      paddingTop: 6,
      paddingBottom: 8,
      cursor: log ? "pointer" : "default",
      opacity: log ? 1 : 0.9,
    }}
  >
              <div>{day}</div>

              {inTimeLabel && <div style={{ marginTop: 2, fontSize: 10, color: "#1d4ed8", fontWeight: 700 }}>{inTimeLabel}</div>}
              {outTimeLabel && <div style={{ marginTop: 1, fontSize: 10, color: "#b91c1c", fontWeight: 700 }}>{outTimeLabel}</div>}

              {segmentsLabel && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    color: "#0d2350",
                    fontWeight: 800,
                    width: "90%",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    background: "rgba(174,214,233,0.55)",
                    borderRadius: 6,
                    padding: "2px 4px",
                  }}
                >
                  {segmentsLabel}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

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
    // teacherComment만 비움 (나중에 UI 추가 예정)
    await setDoc(
      doc(db, "mockExamsComments", id),
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

/* ---------------------------------
    성적 + 모의고사 성적 + 코멘트 로드
----------------------------------*/

useEffect(() => {
  if (!id) return;

  (async () => {
    // 1) 중1/중2/중3/브릿지 수동입력 gradeData
    const list = (await loadGrade(id)) || { scores: {} };
console.log("🔥 로딩된 gradeData:", JSON.stringify(list, null, 2));
// 🔥 '브랜치' → '브릿지' 자동 변환
if (list.scores && list.scores["브랜치"]) {
  list.scores["브릿지"] = list.scores["브랜치"];
  delete list.scores["브랜치"];
  console.log("✅ 브랜치 → 브릿지 변환 완료:", list.scores);
}

    // 2) 🔥 브릿지 mock 자동 병합
    await mergeBridgeMock(list, id);
    await setDoc(doc(db, "grades", id), list, { merge: true });

    // 3) 병합된걸 저장
    setGradeData(list);

    // 4) 분석 생성
    const a = analyzeScores(list);
    setAnalysis(a);

    // 5) 코멘트
    const cSnap = await getDoc(doc(db, "mockExamsComments", id));
    if (cSnap.exists()) {
      setComment(cSnap.data().teacherComment || "");
    }
  })();
}, [id]);



/* ---------------------------------
    gradeData 변화 시 분석 업데이트 (중복 방지)
----------------------------------*/
useEffect(() => {
  if (!gradeData) return;
  const a = analyzeScores(gradeData);
  setAnalysis(a);
}, [gradeData]);

  /* ===============================
        데이터 로드
  ================================= */
  useEffect(() => {
  if (!id) return;

  (async () => {
    // 학생 정보
    const stSnap = await getDoc(doc(db, "students", id));
    if (stSnap.exists()) {
      setStudent({ id, ...(stSnap.data() as Omit<Student, "id">) });
    }

    // 🔥 날짜 기준 records에서 이 학생 기록만 모아오기
    const rec = await loadRecordsForStudent(id);
    setRecords(rec);
    console.log("ALL RECORDS:", rec);
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
  let days = 0;
  let study = 0;
  let academy = 0;
  let meal = 0;
  let outing = 0;

  monthDates.forEach((date) => {
    const cell = records[date];
    if (!cell) return;

    days++;

    const rec = {
      time: cell.time,
      inTime: cell.inTime,
      outTime: cell.outTime,
      segments: (cell as any).segments,
      academyIn: cell.academyIn,
      academyOut: cell.academyOut,
    };

    const byType = calcByType(rec);

    study += calcNetStudyMin(rec);     // ✅ 에듀코어(순공)
    const academyMin =
  (byType.OTHER_ACADEMY ?? 0) +
  (byType.MATH ?? 0) +
  (byType.ENGLISH ?? 0) +
  (byType.KOREAN ?? 0) +
  (byType.SCIENCE ?? 0);

academy += academyMin;   // ✅ 학원
   meal += byType.MEAL ?? 0;
outing += byType.OUTING ?? 0;        // ✅ 외출
  });

  return { days, study, academy, meal, outing };
}, [monthDates, records]);
 
const donutData = [
  { label: "에듀코어", value: summary.study },
  { label: "학원", value: summary.academy },
  { label: "식사", value: summary.meal },
  { label: "외출", value: summary.outing },
];

const prevSummary = useMemo(() => {
  // ✅ “현재 보고있는 month” 기준으로 지난달 계산 (중요!)
  const cur = new Date(month + "-01");
  cur.setMonth(cur.getMonth() - 1);
  const prevMonthKey = cur.toISOString().slice(0, 7);

  const prevMonthDates = sortDates(
    Object.keys(records).filter((d) => d.startsWith(prevMonthKey))
  );

  if (prevMonthDates.length === 0) return null;

  let days = 0;
  let study = 0;        // 에듀코어(순공)
  let academy = 0;      // 학원(segments 기반)
  let meal = 0;         // 식사
  let outing = 0;       // 외출
  let short = 0;        // 생활시간(식사+외출)
  let academyOuting = 0; // (옵션) OTHER_ACADEMY 합

  prevMonthDates.forEach((date) => {
    const cell = records[date];
    if (!cell) return;

    days++;

    const rec = {
      time: cell.time,
      inTime: cell.inTime,
      outTime: cell.outTime,
      segments: (cell as any).segments,
      academyIn: cell.academyIn,
      academyOut: cell.academyOut,
    };

    const byType = calcByType(rec);

    // ✅ 순공(에듀코어)
    study += calcNetStudyMin(rec);

    // ✅ 학원시간: OTHER_ACADEMY + (과목타입이 학원으로 찍힌 경우까지) 합산
    academy +=
      (byType.OTHER_ACADEMY ?? 0) +
      (byType.MATH ?? 0) +
      (byType.ENGLISH ?? 0) +
      (byType.KOREAN ?? 0) +
      (byType.SCIENCE ?? 0);

    // ✅ 식사/외출
    meal += byType.MEAL ?? 0;
    outing += byType.OUTING ?? 0;

    // ✅ 생활시간(원하면 정의 바꿔도 됨)
    short += (byType.MEAL ?? 0) + (byType.OUTING ?? 0);

    // ✅ (옵션) “학원 외출”을 OTHER_ACADEMY로 잡고 싶으면 유지
    academyOuting += byType.OTHER_ACADEMY ?? 0;
  });

  return {
    days,
    study,
    academy,
    meal,
    outing,
    short,
    academyOuting,
  };
}, [records, month]);
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


{showDayModal && dayDetail && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10000,
      padding: 16,
    }}
    onClick={() => {
      setShowDayModal(false);
      setDayDetail(null);
      setDayPlan(null);
    }}
  >
    <div
      style={{
        width: "min(560px, 100%)",
        background: "#fff",
        borderRadius: 16,
        border: "1px solid #e5e7eb",
        boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
        padding: 16,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#111827" }}>
            {dayDetail.date}
          </div>
          <div style={{ fontSize: 14, color: "#218282", marginTop: 4 }}>
            데일리 루틴
          </div>
        </div>

        <button
          onClick={() => {
            setShowDayModal(false);
            setDayDetail(null);
            setDayPlan(null);
          }}
          style={{
            border: "1px solid #e5e7eb",
            background: "#f3f4f6",
            borderRadius: 10,
            padding: "8px 10px",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          닫기
        </button>
      </div>

      {/* ✅ 등원/하원 */}
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        <div
          style={{
            padding: 10,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#eff6ff",
          }}
        >
          <div style={{ fontSize: 12, color: "#1e3a8a", fontWeight: 900 }}>
            등원
          </div>
          <div style={{ fontSize: 14, fontWeight: 900, marginTop: 4 }}>
            {safeHM(dayDetail.time ?? dayDetail.inTime) ?? "-"}
          </div>
        </div>

        <div
          style={{
            padding: 10,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#fff1f2",
          }}
        >
          <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 900 }}>
            하원
          </div>
          <div style={{ fontSize: 14, fontWeight: 900, marginTop: 4 }}>
            {safeHM(dayDetail.outTime) ?? "-"}
          </div>
        </div>
      </div>

      {/* ✅ 루틴(segments) */}
      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 900, color: "#474541" }}>
          루틴(학원/식사/외출)
        </div>

        {Array.isArray(dayDetail.segments) && dayDetail.segments.length > 0 ? (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {dayDetail.segments.map((s: any, idx: number) => {
              const label = segLabelMap[s?.type] ?? (s?.type ?? "활동");
              const st = safeHM(s?.start);
              const en = safeHM(s?.end);
              const isOpen = st && !en;

              return (
                <div
                  key={idx}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#111827" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#5c4712" }}>
                    {st ? `${st} ~ ${en ?? ""}` : "-"}
                    {isOpen ? " (진행중)" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 13, color: "#9ca3af" }}>
            활동 기록 없음
          </div>
        )}
      </div>

      {/* ✅ 단어시험 (과목 전체 합산) */}
     {/* ✅ 단어시험 (어디에 있든 합산) */}
{(() => {
  // dayPlan이 있으면 우선, 없으면 dayDetail(=records)에서
  const wt = getWordTestTotal(dayPlan ?? dayDetail);

if (wt.total === 0) return null;

const score = Math.round((wt.correct / wt.total) * 100);

return (
  <div
    style={{
      marginTop: 12,
      padding: 12,
      borderRadius: 12,
      border: "1px solid #e5e7eb",
      background: "#f0f9ff",
    }}
  >
    <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 6 }}>
      📘 영어 단어 시험
    </div>
    <div style={{ fontSize: 16, fontWeight: 900 }}>
      {score}점 ({wt.correct}/{wt.total})
    </div>
  </div>
);
})()}

{/* ✅ 오늘 과제 (studyPlans/dayPlan.teacherTasks) 
<div
  style={{
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fffdf4",
  }}
>
  <div style={{ fontSize: 13, fontWeight: 900, color: "#7c5c12" }}>
    📌 오늘 과제
  </div>

  <div
  style={{
    marginTop: 8,
    padding: "10px 12px",
    borderRadius: 12,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  }}
>
  <div style={{ fontWeight: 800 }}>
    전체 수행률
  </div>

 <div style={{ fontWeight: 900 }}>
  {totalStats.total
    ? `${totalStats.done}/${totalStats.total} (${totalStats.rate}%)`
    : "과제 없음"}
</div>
</div>

{tasksArr.length > 0 ? (
  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
    {tasksArr.map((t: any) => {
      const items =
        Array.isArray(t.items) ? t.items :
        Array.isArray(t.tasks) ? t.tasks :
        Array.isArray(t.subtasks) ? t.subtasks :
        [];

      const doneCount = items.filter((x: any) => x?.done === true).length;
      const totalCount = items.length;
      const rate = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

      return (
        <div
          key={t.key}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 900 }}>{t.title}</div>

          <div style={{ fontWeight: 700, color: "#374151" }}>
            {totalCount ? `${doneCount}/${totalCount}` : "-"}
          </div>

          <div
            style={{
              fontWeight: 900,
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid #e5e7eb",
              background: rate >= 80 ? "#ecfdf5" : rate >= 50 ? "#fffbeb" : "#fef2f2",
            }}
          >
            {totalCount ? `${rate}%` : "0%"}
          </div>
        </div>
      );
    })}
  </div>
) : (
  <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>내용 없음</div>
)}
</div>
*/}
      {/* 여기 아래에: 등원/하원 / segments / 단어시험 결과 */}
      {/* (너가 원한 “영단어 시험 결과”도 여기 추가하면 됨) */}
    </div>
  </div>
)}
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



<div
  style={{
    padding: "16px 16px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    marginTop: 18,
  }}
>
  <h4 style={{ margin: "0 0 10px 0", fontSize: 18, color: "#2b3f8e" }}>
    에듀코어 데일리 루틴
  </h4>
  {renderCalendar()}
</div>

{/*<TimelineSection
  monthDates={monthDates}
  records={records}
  open={open}
  setOpen={setOpen}
  id={id}     // ⬅ 추가!
/>

{/* 📘 모의고사 요약
<MockSummarySection data={getLatestMockSummary(gradeData)} /> */}

<ScheduleSection student={student} />

<MockSummarySection data={getLatestMockSummary(gradeData)} />

{/* =============================== */}
{/*    성적 요약 (GradeSection)      */}
{/* =============================== */}

<GradeSection
  id={id}
  gradeData={gradeData?.scores || {}}
  comment={comment}
  setComment={setComment}
  onSave={handleSaveComment}
  onDelete={handleDeleteComment}
/>



{/* =============================== */}
{/*        하단 카피라이터         */}
{/* =============================== */}

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
  Empowering Students – Inspiring Families.
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
    { label: "에듀코어", value: summary.study, color: "#1E3A8A" },
    { label: "학원", value: summary.academy, color: "#F59E0B" },
    { label: "식사", value: summary.meal, color: " #0EA5E9"},
    { label: "외출", value: summary.outing, color: "#EF4444" },
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
<DoughnutChart data={[
  { label: "에듀코어", value: summary.study },
  { label: "학원(기타학원 포함)", value: summary.academy },
  { label: "식사", value: summary.meal },
  { label: "외출", value: summary.outing },
]} />

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
                    <span style={{ marginLeft: "auto" }}>
  {formatHM(item.value)}
</span>
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
//function MessageSection() {
  //return (
    //<div style={{ marginTop: 30 }}>
      //<h2>월간 분석 리포트</h2>
    //</div>
  //);
//}



/* =================================================================== */
/* 타임라인 섹션 */
/* =================================================================== */

{/*function TimelineSection({
  monthDates,
  records,
  open,
  setOpen,
  id,
}: {
  monthDates: string[];
  records: Records;
  open: boolean;
  setOpen: (v: boolean) => void;
  id?: string;
}) {
  return (
    <div style={{ marginTop: 32 }}>
      
      <div
  style={{
    fontSize: 14,
    fontWeight: 800,
    color: "#1E3A8A",     // 제목 네이비
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 10,
  }}
>
  DAILY TIMELINE
</div>

      
      <div
        className="no-print"
        style={{
          display: "grid",
          gridTemplateColumns: "3fr 1fr",
          gap: 10,
          marginBottom: open ? 16 : 12,
        }}
      >
       
        <button
  onClick={() => setOpen(!open)}
  style={{
    width: "100%",
    padding: "10px 16px",
    borderRadius: 12,
    cursor: "pointer",
    background: "linear-gradient(135deg, #E8EDF5 0%, #F5F7FA 100%)",
    border: "1px solid #C8D3E5",

    fontSize: 14,            // 통일
    fontWeight: 800,         // 통일
    letterSpacing: 1.1,      // 통일
    textTransform: "uppercase",   // 통일

    color: "#3A2E2A",        // 버튼은 브라운 (유지)
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  }}
>
  DAILY TIMELINE
  <span>{open ? "▲" : "▼"}</span>
</button>

       
        <NavLink
  to={`/study-plan/${id}?role=parent`}
  style={{
    padding: "8px 14px",
    borderRadius: 10,
    background: "#3B4C8C",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    textDecoration: "none",
    display: "inline-block",
  }}
>
          EDUCORE PLANNER
        </NavLink>
      </div>

      
      <div
        style={{
          maxHeight: open ? "3000px" : "0px",
          overflow: "hidden",
          transition: "max-height 0.45s cubic-bezier(.4,0,.2,1)",
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

const subjects = cell.subjects || {};   // 👈 이 줄 추가

const totalWord = Object.values(subjects).reduce(
  (acc: any, sub: any) => {
    return {
      correct: acc.correct + (sub.wordTest?.correct ?? 0),
      total: acc.total + (sub.wordTest?.total ?? 0),
    };
  },
  { correct: 0, total: 0 }
);
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
      {totalWord.total > 0 && (
  <TimelineItem
    label="단어 테스트"
    time={`${totalWord.correct}/${totalWord.total} (${Math.round(
      (totalWord.correct / totalWord.total) * 100
    )}%)`}
  />
)}

     
{cell.academyBySubject && (
  <>
    <div
      style={{
        marginTop: 8,
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      학원
    </div>

    {Object.entries(cell.academyBySubject).map(([sub, data]: any) =>
      data.slots?.map((slot: any, idx: number) => (
        <TimelineItem
          key={`${date}-${sub}-${idx}`}
          label={` - ${sub}`}
          time={`${slot.from} ~ ${slot.to}`}
        />
      ))
    )}
  </>
)}

{(cell.academyIn || cell.academyOut) && (
  <>
    <div style={{ marginTop: 8, fontWeight: 700, fontSize: 13 }}>
      학원 방문 기록
    </div>

    {cell.academyIn && (
      <TimelineItem label=" - 학원 등원" time={cell.academyIn} />
    )}

    {cell.academyOut && (
      <TimelineItem label=" - 학원 하원" time={cell.academyOut} />
    )}


    {cell.academyIn && cell.academyOut && (
      <TimelineItem
        label=" - 학원 외출 총합"
        time={
          (() => {
            const toMin = (hm: string) => {
              const [h, m] = hm.split(":").map(Number);
              return h * 60 + m;
            };
            const min = toMin(cell.academyOut) - toMin(cell.academyIn);
            return `${min}분`;
          })()
        }
      />
    )}
  </>
)}

     
      {cell.memo && (
        <TimelineItem label="메모" time={cell.memo} />
      )}
    </div>
  );
})}
      </div>
    </div>
  );
}*/}

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
/* 🔥 MockSummarySection — 모의고사 요약 */
/* =================================================================== */
type MockItem = {
  subject: string;
  grade: number | string;
  latest: string;
};

function MockSummarySection({ data }: { data: MockItem[] }) {
  if (!data || data.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 32,
        padding: "20px 22px",
        background: "#F3F7FF",
        borderRadius: 14,
        border: "1px solid #D4E0FF",
        boxShadow: "0 4px 10px rgba(0,0,0,0.05)",
      }}
    >
      <h2
        style={{
          fontSize: 18,
          fontWeight: 900,
          marginBottom: 14,
          borderLeft: "4px solid #3B82F6",
          paddingLeft: 10,
          color: "#1E3A8A",
        }}
      >
        📘 모의고사 요약
      </h2>

      {data.map((d: MockItem) => (
        <div
          key={d.subject}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 0",
            borderBottom: "1px solid #E5EAF5",
            fontSize: 14,
          }}
        >
          <span style={{ fontWeight: 700 }}>{d.subject}</span>
          <span>
            {d.grade}등급
            <span style={{ color: "#666", marginLeft: 8 }}>
              (최근: {d.latest})
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* =================================================================== */
/* 🔥 모의고사 등급 계산 함수 (전국 백분위 기준) */
/* =================================================================== */
function getMockLevel(score: number, subject: string) {
  if (!score && score !== 0) return 9;

  const fullScore =
    subject === "통합과학" ||
    subject === "통합사회" ||
    subject === "역사"
      ? 50
      : 100;

  const pct = (score / fullScore) * 100;

  if (pct >= 96) return 8;
  if (pct >= 89) return 7;
  if (pct >= 77) return 6;
  if (pct >= 60) return 5;
  if (pct >= 40) return 4;
  if (pct >= 23) return 3;
  if (pct >= 11) return 2;
  if (pct >= 4) return 1;
  return 9;
}

/* =================================================================== */
/* 🔥 Optimum Educore — 성적표 통합 컴포넌트 + 모의고사 회차 모달 */
/* =================================================================== */

export function GradeSection({
  id,
  gradeData,
  comment,
  setComment,
  onSave,
  onDelete,
}: {
  id: string;
  gradeData: any;
  comment: string;
  setComment: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  type TabType = "중1" | "중2" | "중3" | "브릿지";
  const [activeTab, setActiveTab] = useState<TabType>("중1");

  /* ---------------------------------------------------
     🔥 tabKey는 여기에서 "한 번만" 선언 (정답)
  --------------------------------------------------- */
  const tabKey = activeTab === "브릿지" ? "브릿지" : activeTab;

  /* ---------------------------------------------------
     🔥 getScore는 tabKey만 사용
  --------------------------------------------------- */
  const getScore = (subject: string, term: string) => {
    if (!gradeData) return { my: 0, avg: "" };

    return gradeData?.[tabKey]?.[subject]?.[term] || {
      my: 0,
      avg: "",
    };
  };

  // 🔥 모달 상태
  const [examModal, setExamModal] = useState<{
    tab: TabType;
    term: string;
    exam: any;
  } | null>(null);

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

  // 🔹 기본 구조
  const termOptions = {
    중1: ["2학기 중간", "2학기 기말"],
    중2: ["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말"],
    중3: ["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말"],
    브릿지: Array.from({ length: 8 }, (_, i) => `모의고사 ${i + 1}회`),
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
  const subjList = activeTab === "브릿지" ? branchSubjects : subjects;

  /* ---------------------------------------------------
     🔍 ExamDetailModal (여긴 tabKey 따로 있어도 OK. 충돌 없음)
  --------------------------------------------------- */
  const ExamDetailModal = ({
    tab,
    term,
    exam,
    onClose,
  }: {
    tab: "중1" | "중2" | "중3" | "브릿지";
    term: string;
    exam: any;
    onClose: () => void;
  }) => {
    const list = tab === "브릿지" ? branchSubjects : subjects;

    const rows = list.map((subject) => {
      const tabKeyLocal = tab === "브릿지" ? "브릿지" : tab;

      const curr =
        gradeData?.[tabKeyLocal]?.[subject]?.[term] || { my: 0, avg: 0 };

      const level =
        tab === "브릿지"
          ? Number(curr.avg || 0)
          : getLevel(curr.my || 0, curr.avg || 0);

      return {
        subject,
        score: curr.my,
        avg: curr.avg,
        level,
      };
    });

  const valid = rows.filter(
    (r) => typeof r.level === "number" && r.level > 0 && r.level <= 9
  );

  // 과목 가중치
  const weightMap: Record<string, number> = {
    국어: 100,
    영어: 100,
    수학: 100,
    통합과학: 50,
    통합사회: 50,
    역사: 50,
  };

  const weightedSum = valid.reduce(
    (sum, r) => sum + r.level * (weightMap[r.subject] || 50),
    0
  );
  const weightTotal = valid.reduce(
    (sum, r) => sum + (weightMap[r.subject] || 50),
    0
  );
  const avgLevel = weightTotal > 0 ? weightedSum / weightTotal : 0;

  const strong = valid.filter((r) => r.level <= 3).map((r) => r.subject);
  const weak = valid.filter((r) => r.level >= 6).map((r) => r.subject);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "88%",
          maxWidth: 480,
          background: "#FFFDF8",
          borderRadius: 16,
          padding: 18,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 10px 26px rgba(0,0,0,0.25)",
          fontSize: 12,
          lineHeight: 1.55,
          border: "1px solid #E7DCC9",
        }}
      >
        {/* 헤더 */}
       <div
  style={{
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingBottom: 6,
    borderBottom: "1px solid #E5DED4",
  }}
>
  <div>
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#9CA3AF",
        letterSpacing: 1.1,
      }}
    >
      OPTIMUM EDUCORE · MOCK ANALYSIS
    </div>
    <div
      style={{
        marginTop: 3,
        fontWeight: 900,
        fontSize: 14,
        color: "#111827",
      }}
    >
      {tab === "브릿지" ? "브릿지 모의고사" : tab} · {term}
    </div>
  </div>

  <button
    onClick={onClose}
    style={{
      border: "none",
      background: "#F3F4F6",
      borderRadius: 999,
      width: 26,
      height: 26,
      fontSize: 14,
      cursor: "pointer",
      fontWeight: 700,
      color: "#4B5563",
    }}
  >
    ✕
  </button>
</div>

        {/* 요약 배지 */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 10,
            fontSize: 11,
          }}
        >
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: "#EEF2FF",
              color: "#4F46E5",
              fontWeight: 700,
            }}
          >
            평균 등급 {valid.length ? avgLevel.toFixed(1) : "-"}
          </span>
          {strong.length > 0 && (
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: "#ECFDF3",
                color: "#15803D",
                fontWeight: 700,
              }}
            >
              강점: {strong.join(", ")}
            </span>
          )}
          {weak.length > 0 && (
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: "#FEF2F2",
                color: "#B91C1C",
                fontWeight: 700,
              }}
            >
              보완: {weak.join(", ")}
            </span>
          )}
        </div>

        {/* 과목별 표 */}
        <table
  style={{
    width: "100%",
    borderCollapse: "collapse",
    marginBottom: 14,
    fontSize: 12,
    textAlign: "center",   // ★ 중앙정렬
  }}
>
          <thead>
            <tr style={{ background: "#F5EFE6" }}>
              <th
                style={{
                  padding: 6,
                  border: "1px solid #E5DED4",
                  textAlign: "center",
                }}
              >
                과목
              </th>
              {tab === "브릿지" ? (
                <>
                  <th
                    style={{
                      padding: 6,
                      border: "1px solid #E5DED4",
                      textAlign: "center",
                    }}
                  >
                    점수
                  </th>
                  <th
                    style={{
                      padding: 6,
                      border: "1px solid #E5DED4",
                      textAlign: "center",
                    }}
                  >
                    등급
                  </th>
                </>
              ) : (
                <>
                  <th
                    style={{
                      padding: 6,
                      border: "1px solid #E5DED4",
                      textAlign: "center",
                    }}
                  >
                    내 점수
                  </th>
                  <th
                    style={{
                      padding: 6,
                      border: "1px solid #E5DED4",
                      textAlign: "center",
                    }}
                  >
                    평균
                  </th>
                  <th
                    style={{
                      padding: 6,
                      border: "1px solid #E5DED4",
                      textAlign: "center",
                    }}
                  >
                    상대 등급
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subject}>
                <td
                  style={{
                    border: "1px solid #EEE",
                    padding: 4,
                    background: "#FBFAF7",
                    fontWeight: 700,
                  }}
                >
                  {r.subject}
                </td>
                <td style={{ border: "1px solid #EEE", padding: 4 }}>
                  {r.score || "-"}
                </td>
                <td style={{ border: "1px solid #EEE", padding: 4 }}>
                  {tab === "브릿지" ? r.level || "-" : r.avg || "-"}
                </td>
                {tab !== "브릿지" && (
                  <td style={{ border: "1px solid #EEE", padding: 4 }}>
                    {r.level > 0 ? `${r.level}등급` : "-"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* 🔥 브릿지 전용 – 세부 분석 섹션 */}
        {tab === "브릿지" && id && (
          <div
            style={{
              marginTop: 6,
              padding: "10px 12px",
              borderRadius: 12,
              background: "#F9FAFB",
              border: "1px solid #E5E7EB",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                marginBottom: 8,
                color: "#111827",
              }}
            >
              브릿지 모의고사 상세 분석
            </div>
            <BridgeMockExamSection studentId={id} />
          </div>
        )}

        {/* 분석 텍스트 */}
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 10,
            background: "#FFFDF8",
            border: "1px solid #E7DCC9",
            lineHeight: 1.6,
            fontSize: 12,
          }}
        >
          {valid.length === 0 ? (
            <>이 회차는 아직 입력된 성적이 없습니다.</>
          ) : (
            <>
              <div style={{ marginBottom: 4 }}>
                · 이 모의고사의 <b>전체 평균 등급</b>은{" "}
                <b>{avgLevel.toFixed(1)}등급</b>입니다.
              </div>
              {strong.length > 0 && (
                <div style={{ marginBottom: 2 }}>
                  · <b>강점 과목</b> (1~3등급): {strong.join(", ")}
                </div>
              )}
              {weak.length > 0 && (
                <div>
                  · <b>보완 필요 과목</b> (6등급 이상): {weak.join(", ")}
                </div>
              )}
              {strong.length === 0 && weak.length === 0 && (
                <div>
                  · 전반적으로 4~5등급대의 안정적인 분포를 보이고 있습니다.
                </div>
              )}
            </>
          )}
        </div>

        {/* 닫기 버튼 */}
        <div style={{ textAlign: "right", marginTop: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: "6px 16px",
              borderRadius: 999,
              border: "1px solid #D6CEC0",
              background: "#F3F4F6",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              color: "#374151",
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

  /* ============================
        메인 렌더링
  ============================ */
  return (
    <>
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
          {["중1", "중2", "중3", "브릿지"].map((tab) => (
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
              <th style={{ padding: 10, border: "1px solid #E5DED4" }}>
                과목
              </th>

              {terms.map((t) => (
                <th
                  key={t}
                  colSpan={activeTab === "브릿지" ? 2 : 3}
                  style={{
                    border: "1px solid #E5DED4",
                    cursor: "pointer",
                    padding: 8,
                  }}
                 
  onClick={() =>
  setExamModal({
    tab: activeTab,
    term: t,
    exam: gradeData[activeTab]?.[t],   // 👈 실제 점수 & 문항 데이터
  })
}
                  title="클릭하면 이 회차 모의고사 분석이 표시됩니다."
                >
                  {t}
                </th>
              ))}
            </tr>

            <tr style={{ background: "#FBFAF7" }}>
              <th></th>

              {terms.map((t) =>
                activeTab === "브릿지" ? (
                  <React.Fragment key={t}>
                    <th>점수</th>
                    <th>등급</th>
                  </React.Fragment>
                ) : (
                  <React.Fragment key={t}>
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
                  const curr = getScore(subject, term);

                  if (activeTab === "브릿지") {
                    return (
                      <React.Fragment key={term}>
                        <td style={{ border: "1px solid #EEE" }}>
                          {curr.my}
                        </td>
                        <td style={{ border: "1px solid #EEE" }}>
                          {curr.avg || "-"}
                        </td>
                      </React.Fragment>
                    );
                  }

                  const level = getLevel(curr.my, curr.avg);
                  const colors = [
                    "#4CAF50",
                    "#8BC34A",
                    "#FFC107",
                    "#FB923C",
                    "#F87171",
                  ];

                  return (
                    <React.Fragment key={term}>
                      <td style={{ border: "1px solid #EEE" }}>
                        {curr.my}
                      </td>
                      <td style={{ border: "1px solid #EEE" }}>
                        {curr.avg}
                      </td>
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

      {/* 🔥 학기/중간/기말 성적 모달 */}
{examModal && (
  <ExamDetailModal
  tab={examModal.tab}
  term={examModal.term}
  exam={examModal.exam}
  onClose={() => setExamModal(null)}   // ← 이렇게 변경!!
/>
)}


    </>
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

/* =================================================================== */
/* 도넛 그래프 (data 배열 버전) */
/* =================================================================== */

function DoughnutChart({
  data,
}: {
  data: Array<{ label: string; value: number }>;
}) {
  const safe = (data || []).map(d => ({
    ...d,
    value: Math.max(0, Number(d.value || 0)),
  }));

  const total = safe.reduce((sum, d) => sum + d.value, 0);

  if (total <= 0) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
        아직 집계된 시간이 없습니다.
      </div>
    );
  }

  const colors: Record<string, string> = {
    "에듀코어": "#1E3A8A",
    "학원(기타학원 포함)": "#C8A76A",
    "학원": "#C8A76A",
    "식사": "#0EA5E9",
    "외출": "#EF4444",
  };

  const pct = (v: number) => (v / total) * 100;

  // strokeDashoffset 누적 계산
  const OFFSET = 25;
  let acc = 0;

  return (
    <div style={{ position: "relative", width: "180px", height: "180px" }}>
      <svg viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx="18"
          cy="18"
          r="16"
          stroke="#E5E7EB"
          strokeWidth="4"
          fill="none"
        />

        {safe
          .filter(d => d.value > 0)
          .map((d, idx) => {
            const p = pct(d.value);
            const dashoffset = OFFSET - acc;
            acc += p;

            return (
              <circle
                key={d.label + idx}
                cx="18"
                cy="18"
                r="16"
                stroke={colors[d.label] ?? "#9CA3AF"}
                strokeWidth="4"
                strokeDasharray={`${p} ${100 - p}`}
                strokeDashoffset={dashoffset}
                fill="none"
              />
            );
          })}
      </svg>

      {/* 중앙 텍스트 */}
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
          {formatHM(total)}
        </div>
        <div style={{ fontSize: 10, color: "#6B7280" }}>총 합계</div>
      </div>
    </div>
  );
}