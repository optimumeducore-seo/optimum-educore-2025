// src/pages/StudyPlanPage.tsx
import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, useLocation, } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { deleteDoc } from "firebase/firestore";
import { uploadProof } from "../services/storage";
import { getStorage, ref, deleteObject } from "firebase/storage";
import StudyTimelineModal from "../components/StudyTimelineModal";
import "./StudyPlanPage.css";


/* ------------------------------------------------------------------ */
/* 타입 / 상수 정의 */
/* ------------------------------------------------------------------ */

type TaskItem = {
  text?: string;      // 수동 과제용
  title?: string;     // 자동 메인 과제 제목
  done: boolean;
  carriedOver?: boolean;   // ✅ 이 줄 추가
  carriedFrom?: string;
  subtasks?: {
    text: string;
    done: boolean;
  }[];
};

type SubjectPlan = {
  teacherTasks: TaskItem[];
  studentPlans: TaskItem[];
  memo?: string;
  teacherComment?: string;
  done?: boolean;
  updatedAt?: any;
  proofImages?: string[];
  proofMemo?: string;
  wordTest?: { correct?: number; total?: number };
};
const SUBJECT_LABELS: Record<string, string> = {
  kor: "국어",
  math: "수학",
  eng: "영어",
  sci: "과학",
  soc: "사회",
  hist1: "세계",
  hist2: "한국",
  tech: "기가",
  hanja: "한자",
  jp: "일본",
  academy: "학원",
  meal: "식사",
  self: "자습",
  rest: "휴식",
};

const SUBJECT_SUMMARY_LABELS: Record<string, string> = SUBJECT_LABELS;

type StudentExam = {
  id: string;      // examId
  title: string;
  start: string;
  end: string;
  subjects: { key: string; name: string }[];
};

type DayPlan = {
  date: string;
  subjects: Record<string, SubjectPlan>;
  timelineBlocks?: Record<string, string>;
};

type ExamItem = {
  id: string;
  examDate: string;  // YYYY-MM-DD
  subject: string;
  range: string;
  memo?: string;
};

const SUBJECTS = [
  { key: "common", label: "공통" },
  { key: "kor", label: "국어" },
  { key: "math", label: "수학" },
  { key: "eng", label: "영어" },
  { key: "sci", label: "과학" },
  { key: "soc", label: "사회" },
  { key: "hist1", label: "역사1 · 세계사" },
  { key: "hist2", label: "역사2 · 한국사" },
  { key: "tech", label: "기술가정" },
  { key: "hanja", label: "한자" },
  { key: "jp", label: "일본어" },
];

const SUBJECT_COLORS: Record<string, { bg: string; text: string; light: string }> = {

  kor: { bg: "#3B82F6", text: "#FFFFFF", light: "#DBEAFE" },
  math: { bg: "#6366F1", text: "#FFFFFF", light: "#E0E7FF" },
  eng: { bg: "#10B981", text: "#FFFFFF", light: "#D1FAE5" },
  sci: { bg: "#F59E0B", text: "#FFFFFF", light: "#FEF3C7" },
  soc: { bg: "#EF4444", text: "#FFFFFF", light: "#FEE2E2" },

  hist1: { bg: "#8B5CF6", text: "#FFFFFF", light: "#EDE9FE" },
  hist2: { bg: "#EC4899", text: "#FFFFFF", light: "#FCE7F3" },

  tech: { bg: "#06B6D4", text: "#FFFFFF", light: "#CFFAFE" },
  hanja: { bg: "#A855F7", text: "#FFFFFF", light: "#F3E8FF" },
  jp: { bg: "#F97316", text: "#FFFFFF", light: "#FFEDD5" },

  academy: { bg: "#334155", text: "#FFFFFF", light: "#E2E8F0" },
  meal: { bg: "#F59E0B", text: "#FFFFFF", light: "#FEF3C7" },
  self: { bg: "#22C55E", text: "#FFFFFF", light: "#DCFCE7" },
  rest: { bg: "#CBD5E1", text: "#1F2937", light: "#F1F5F9" },
};
const cleanForFirestore = (obj: any) => {
  const res: any = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined) res[k] = v;
  });
  return res;
};

const stripUndefinedDeep = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(stripUndefinedDeep).filter((v) => v !== undefined);
  }
  if (obj && typeof obj === "object") {
    const out: any = {};
    Object.entries(obj).forEach(([k, v]) => {
      const vv = stripUndefinedDeep(v);
      if (vv !== undefined) out[k] = vv;
    });
    return out;
  }
  return obj === undefined ? undefined : obj;
};

const normalizeTasks = (v: any[]): any[] => {
  if (!v || !Array.isArray(v)) return [];

  return v.map((item: any) => {
    if (!item) return { text: "", done: false };

    // ⭐ 자동 생성된 과제: 구조 그대로 유지
    if (item.subtasks && Array.isArray(item.subtasks)) {
      return item;  // 🔥 핵심!!
    }

    // 문자열로 된 수동 과제
    if (typeof item === "string") {
      return { text: item, done: false };
    }

    // 일반 과제
    return {
      text: item.text || "",
      done: !!item.done,
    };
  });
};
const sumTimelineByRange = (
  plans: Record<string, DayPlan>,
  startDate: string,
  endDate: string
) => {
  const acc: Record<string, number> = {};

  Object.entries(plans).forEach(([date, day]) => {
    if (date < startDate || date > endDate) return;

    const blocks = day.timelineBlocks || {};
    Object.values(blocks).forEach((subKey) => {
      if (!subKey) return;
      acc[subKey] = (acc[subKey] || 0) + 10;
    });
  });

  return acc;
};

function getNextDate(ds: string) {
  const d = new Date(ds);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

const toDate = (s: string) => new Date(s + "T00:00:00");
const dday = (end: string) => {
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const e = toDate(end).getTime();
  const diff = Math.ceil((e - t) / (1000 * 60 * 60 * 24));
  return diff; // 남은 일수(오늘 포함 느낌이면 +1 조정 가능)
};

/* ===============================
   🔵 과목 데이터 정리 함수
   =============================== */
const makeCleanSubject = (subj: any = {}) => {
  const rawTeacher = Array.isArray(subj.teacherTasks) ? subj.teacherTasks : [];

  const teacher: TaskItem[] = rawTeacher
    .filter(Boolean) // ✅ undefined 제거
    .map((t: any) => {
      const base: any = {
  id: t.id || crypto.randomUUID(),
  done: !!t.done,
  carriedOver: !!t.carriedOver,
};

if (t.carriedFrom) {
  base.carriedFrom = t.carriedFrom;
}

      // ✅ 레거시 자동과제 복구(진짜 자동인 경우만)
      if (t.id && t.title && !t.text && t.subtasks == null) {
        return { ...base, title: t.title, subtasks: [] };
      }

      // ✅ 자동과제
      if (Array.isArray(t.subtasks)) {
        return {
          ...base,
          title: t.title || t.text || "",
          subtasks: t.subtasks
            .filter(Boolean)
            .map((s: any) => ({ text: s?.text || "", done: !!s?.done })),
        };
      }

      // ✅ 수동과제(이월 포함)
      return { ...base, text: t.text || t.title || "" };
    })
    // ✅ 완전 빈 과제 제거(요약/렌더 터짐 방지)
   .filter((t: TaskItem) => (Array.isArray(t.subtasks) ? true : !!t.text));


  const student = Array.isArray(subj.studentPlans)
    ? normalizeTasks(subj.studentPlans).filter(Boolean)
    : [];

 return {
  teacherTasks: teacher,
  studentPlans: student,
  memo: subj.memo || "",
  teacherComment: subj.teacherComment || "", // ✅ 추가
  done: !!subj.done,
  proofImages: subj.proofImages || [],
  proofMemo: subj.proofMemo || "",
  wordTest: subj.wordTest || { correct: 0, total: 0 },
};
};


/* ---------------------------------------------------------- */
/* 🔥  Legacy 자동 과제 (subtasks: undefined) 데이터 정리용 */
/* ---------------------------------------------------------- */
const fixLegacyTasks = async (
  id: string,
  selectedDate: string,
  plans: Record<string, any>
) => {
  const day = plans[selectedDate];
  if (!day || !day.subjects) return;

  let needFix = false;
  const payload: any = {};

  for (const key of Object.keys(day.subjects)) {
    const subj = day.subjects[key];
    if (!subj?.teacherTasks) continue;

    const fixedList = subj.teacherTasks.map((t: any) => {
      // null 이든 undefined 든 다 잡기
      if (t.id && t.title && t.subtasks == null) {
        needFix = true;
        return {
          id: t.id,
          title: t.title,
          done: !!t.done,
          subtasks: [], // 자동과제로 인정되도록 복구
        };
      }
      return t;
    });

    if (needFix) {
      payload[key] = {
        ...subj,
        teacherTasks: fixedList,
      };
    }
  }

  if (needFix) {

    await setDoc(
      doc(db, "studyPlans", id, "days", selectedDate),
      payload,
      { merge: true }
    );
  }
};

/* ===============================
   🔁 과제 이월 유틸
   =============================== */

const markAsCarriedOver = (t: any) => {
  if (Array.isArray(t.subtasks)) {
    return {
      ...t,
      carriedOver: true,
      done: false,
      subtasks: t.subtasks.map((s: any) => ({
        ...s,
        done: false,
      })),
    };
  }

  return {
    ...t,
    carriedOver: true,
    done: false,
  };
};

const cloneForNextDay = (t: any, fromDate: string) => {
  if (Array.isArray(t.subtasks)) {
    return {
      ...t,
      carriedOver: false,
      carriedFrom: fromDate,   // ✅ 추가
      done: false,
      subtasks: t.subtasks.map((s: any) => ({ ...s, done: false })),
    };
  }

  return {
    ...t,
    carriedOver: false,
    carriedFrom: fromDate,     // ✅ 추가
    done: false,
  };
};

function getExamStatus(start: string, end: string) {
  const today = new Date();
  const s = new Date(start);
  const e = new Date(end);

  today.setHours(0,0,0,0);
  s.setHours(0,0,0,0);
  e.setHours(0,0,0,0);

  const diffToStart = Math.ceil((s.getTime() - today.getTime()) / (1000*60*60*24));
  const diffFromStart = Math.floor((today.getTime() - s.getTime()) / (1000*60*60*24));

  if (today < s) {
    return `D-${diffToStart}`;
  }

  if (today >= s && today <= e) {
    return `시험중 D+${diffFromStart}`;
  }

  return "종료";
}

/* ------------------------------------------------------------------ */
/* 메인 컴포넌트 */
/* ------------------------------------------------------------------ */

export default function StudyPlanPage() {
  const { id } = useParams<{ id: string }>(); // studentId
const navigate = useNavigate();
  const location = useLocation();

  // 역할 구분 (?role=teacher / ?role=student / ?role=parent)
  // 역할 구분
const searchParams = new URLSearchParams(location.search);
const roleParam = searchParams.get("role");

const role =
  roleParam === "parent" || roleParam === "teacher"
    ? roleParam
    : "student";

const isStudent = role === "student";
const isTeacher = role === "teacher";
const isParent = role === "parent";
const readonly = role === "parent";


  // 상태들
  const [student, setStudent] = useState<any | null>(null);
  const fallbackSubjects = React.useMemo(() => {
  const list: string[] = Array.isArray(student?.academySubjects)
    ? student.academySubjects
    : [];

  // 중복 제거(혹시 같은 과목 여러 번 들어가면)
  const uniq = Array.from(new Set(list.map((x) => (x ?? "").trim()).filter(Boolean)));

  return uniq.map((name) => ({
    id: name, // 한글 id OK
    name,
  }));
}, [student?.academySubjects]);

  const [plans, setPlans] = useState<Record<string, DayPlan>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());

 const [selectedSubject, setSelectedSubject] = useState<string>("common");

  const [teacherInput, setTeacherInput] = useState("");
  const [studentInput, setStudentInput] = useState("");
  const [memo, setMemo] = useState("");
  const [done, setDone] = useState(false);

  const [proofImages, setProofImages] = useState<string[]>([]);
  const [proofMemo, setProofMemo] = useState("");

  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // 🔥 시험기간 관리용 상태
  const [testList, setTestList] = useState<any[]>([]);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testTitle, setTestTitle] = useState("");
  const [testStart, setTestStart] = useState("");
  const [testEnd, setTestEnd] = useState("");
  const [testMemo, setTestMemo] = useState("");
  const [zoomImgIndex, setZoomImgIndex] = useState<number | null>(null);


const [myExams, setMyExams] = useState<StudentExam[]>([]);
const [selectedExamId, setSelectedExamId] = useState<string>("");
const [goals, setGoals] = useState<Record<string, number>>({});
const [showTimelineModal, setShowTimelineModal] = useState(false);
const [timelineDate, setTimelineDate] = useState<string | null>(null);

const [openEnergyWeek, setOpenEnergyWeek] = useState(false);
const [openEnergyMonth, setOpenEnergyMonth] = useState(false);

useEffect(() => {
  const load = async () => {
    if (!id) return;

    const snap = await getDocs(collection(db, "studentExams", id, "exams"));
    const list = snap.docs.map((d) => ({
      id: d.id,                 // ✅ 이게 문서ID
      ...(d.data() as any),
    })) as any[];

    const normalized: StudentExam[] = list.map((x) => ({
      id: x.id,                 // ✅ 무조건 문서ID만 사용
      title: x.title || "",
      start: x.start || x.planStart || "",   // (필드명이 다를 수 있으니 보강)
      end: x.end || x.planEnd || "",
      subjects: (x.subjects || []).map((s: any) => ({ key: s.key, name: s.name })),
    }));

    setMyExams(normalized);
    setSelectedExamId((prev) => prev || (normalized[0]?.id ?? ""));
  };

  load();
}, [id]);


  // 🔹 빠른 기간 선택 (텀 스케줄 출력용)
  const quickRange = (type: string) => {
    const today = new Date();
    let s: string | undefined;
    let e: string | undefined;

    if (type === "week") {
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      s = monday.toISOString().slice(0, 10);
      e = today.toISOString().slice(0, 10);
    } else if (type === "month") {
      s = new Date(today.getFullYear(), today.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      e = today.toISOString().slice(0, 10);
    } else if (type === "lastWeek") {
      const lastMonday = new Date(today);
      lastMonday.setDate(today.getDate() - 7 - ((today.getDay() + 6) % 7));
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      s = lastMonday.toISOString().slice(0, 10);
      e = lastSunday.toISOString().slice(0, 10);
    } else if (type === "lastMonth") {
      const y = today.getFullYear();
      const m = today.getMonth() - 1;
      s = new Date(y, m, 1).toISOString().slice(0, 10);
      e = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    }

    if (s && e) {
      setStart(s);
      setEnd(e);
    }
  };

  const deleteTest = async (testId: string) => {
    if (!id) return;
    if (!window.confirm("삭제할까요?")) return;

    await deleteDoc(doc(db, "studyPlans", id, "tests", testId));

    setTestList(prev => prev.filter(t => t.id !== testId));
  };

  /* ------------------------------------------------------------------ */
  /* 🔹 Firestore 로드 (플랜 + 시험기간) */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      const sSnap = await getDoc(doc(db, "students", id));
      if (sSnap.exists()) setStudent({ id, ...(sSnap.data() as any) });

      // days 컬렉션
      const colRef = collection(db, "studyPlans", id, "days");
      const snap = await getDocs(colRef);

      const map: Record<string, DayPlan> = {};

      snap.forEach((d) => {
        const raw = d.data() as any;
        const subjects: Record<string, SubjectPlan> = {};

        SUBJECTS.forEach(({ key }) => {
          const sRaw = raw[key];
          if (!sRaw) return;

          subjects[key] = makeCleanSubject(sRaw);

          // 🔥 타입 안정화 (UI용)
          subjects[key].teacherTasks = subjects[key].teacherTasks || [];
          subjects[key].studentPlans = subjects[key].studentPlans || [];
        });

        map[d.id] = {
  date: d.id,
  subjects,
  timelineBlocks: raw.timelineBlocks || {},
};
      });

      setPlans(map);

      // 시험기간 컬렉션
      const testRef = collection(db, "studyPlans", id, "tests");
      const testSnap = await getDocs(testRef);
      setTestList(
        testSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      );

      // 처음 진입 시: 오늘 날짜 자동 선택
      const today = new Date().toISOString().slice(0, 10);
      setSelectedDate(today);
    };

    load();
  }, [id]);

  /* ------------------------------------------------------------------ */
  /* 🔹 날짜 / 과목 변경 시 입력창 동기화 */
  /* ------------------------------------------------------------------ */

  const loadProof = async () => {
    if (!id || !selectedDate) return;

    const ref = doc(db, "studyPlans", id, "days", selectedDate);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const data = snap.data();

      const imgs = (data.proofImages || [])
        .map((it: any) => (typeof it === "string" ? it : it?.url))
        .filter(Boolean);

      setProofImages(imgs);
      setProofMemo(data.memo || "");
    } else {
      setProofImages([]);
      setProofMemo("");
    }
  };

  useEffect(() => {
    if (!id || !selectedDate) return;

    fixLegacyTasks(id, selectedDate, plans);
    loadProof();
  }, [id, selectedDate, plans]);

  useEffect(() => {
    (window as any).plans = plans;
  }, [plans]);

  // -------------------------------------------------------------
  // 🔥 오늘 과제(Subtasks) 자동 로드
  // -------------------------------------------------------------
  useEffect(() => {
    if (!id || !selectedDate || !selectedSubject) return;

    const loadTodayTasks = async () => {
      const planRef = doc(db, "studyPlans", id, "days", selectedDate);
      const snap = await getDoc(planRef);

      if (!snap.exists()) {
        setTeacherInput("");
        setStudentInput("");
        return;
      }

      const data = snap.data();
      const cleanSubj = makeCleanSubject(data[selectedSubject]);

      setTeacherInput(
        cleanSubj.teacherTasks
          .filter((t: any) => !Array.isArray(t.subtasks)) // 수동 과제만
          .map((t: any) => t.text)
          .join("\n")
      );

      setStudentInput(
        cleanSubj.studentPlans.map((t: any) => t.text).join("\n")
      );
    };
    loadTodayTasks();

  }, [id, selectedDate, selectedSubject]);

  const [examData, setExamData] = useState<ExamItem[]>([]);

  useEffect(() => {
    if (!student) return;

    const load = async () => {
      const ref = collection(
        db,
        "examManager",
        `${student.school}_${student.grade}`,
        "exams"
      );

      const snap = await getDocs(ref);
      setExamData(
        snap.docs.map((d) => ({
          id: d.id,                          // Firestore 문서 ID
          examDate: d.data().examDate || "", // YYYY-MM-DD
          subject: d.data().subject || "",
          range: d.data().range || "",
          memo: d.data().memo || "",
        }))
      );
    };

    load();
  }, [student]);

useEffect(() => {
  const loadProgress = async () => {
    if (!id || !selectedExamId) return;

    const ref = doc(db, "studentExams", id, "progress", selectedExamId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      setGoals({});
      return;
    }
    const data = snap.data() as any;
    setGoals(data.goals || {});
  };

  loadProgress();
}, [id, selectedExamId]);

  // ✅ 오늘 날짜의 "선생님 과제" 요약 (과목별로 한 번에 보기용)
  const todayTeacherSummary = React.useMemo(() => {
    if (!selectedDate) return [];

    const day = plans[selectedDate];
    if (!day || !day.subjects) return [];

    const list: { key: string; label: string; tasks: TaskItem[] }[] = [];

    SUBJECTS.forEach(({ key, label }) => {
      const subj = day.subjects[key];
      const tasks = subj?.teacherTasks || [];
      if (!tasks.length) return;

      list.push({
        key,
        label,
        tasks,
      });
    });

    return list;
  }, [plans, selectedDate]);

const teacherCommentText =
  selectedDate
    ? plans[selectedDate]?.subjects?.[selectedSubject]?.teacherComment || ""
    : "";

  const dayTimelineBlocks = useMemo(() => {
  if (!selectedDate) return {};

  const day = plans[selectedDate];
  const blocks = day?.timelineBlocks || {};
  return blocks;
}, [plans, selectedDate]);

const subjectSummary = useMemo(() => {
  const acc: Record<string, number> = {};

  Object.values(dayTimelineBlocks).forEach((subKey) => {
    if (!subKey) return;
    acc[subKey] = (acc[subKey] || 0) + 10;
  });

  console.log("subjectSummary 👉", acc);

  return acc;
}, [dayTimelineBlocks]);

const focusRows = useMemo(() => {
  const entries = Object.entries(subjectSummary)
    .filter(([key]) => !["meal", "rest"].includes(key))
    .sort((a, b) => b[1] - a[1]);

  const max = entries[0]?.[1] || 1;

  const rows = entries.map(([key, min]) => ({
    key,
    label: SUBJECT_SUMMARY_LABELS[key] || SUBJECT_LABELS[key] || key,
    minutes: min,
    ratio: Math.round((min / max) * 100),
  }));



  return rows;
}, [subjectSummary]);
console.log("subjectSummary 👉", subjectSummary);

const weeklySummary = useMemo(() => {
  if (!selectedDate) return {};

  const base = new Date(selectedDate);
  const day = base.getDay();
  const monday = new Date(base);
  monday.setDate(base.getDate() - (day === 0 ? 6 : day - 1));

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const start = monday.toISOString().slice(0, 10);
  const end = sunday.toISOString().slice(0, 10);

  return sumTimelineByRange(plans, start, end);
}, [plans, selectedDate]);

const weeklyRows = useMemo(() => {
  const entries = Object.entries(weeklySummary)
    .filter(([key]) => !["meal", "rest"].includes(key))
    .sort((a, b) => b[1] - a[1]);

  const max = entries[0]?.[1] || 1;

  return entries.map(([key, min]) => ({
    key,
    label: SUBJECT_SUMMARY_LABELS[key] || SUBJECT_LABELS[key] || key,
    minutes: min,
    ratio: Math.round((min / max) * 100),
  }));
}, [weeklySummary]);

const monthlySummary = useMemo(() => {
  if (!selectedDate) return {};

  const base = new Date(selectedDate);
  const y = base.getFullYear();
  const m = base.getMonth();

  const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const endDay = new Date(y, m + 1, 0).getDate();
  const end = `${y}-${String(m + 1).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  return sumTimelineByRange(plans, start, end);
}, [plans, selectedDate]);
const monthlyRows = useMemo(() => {
  const entries = Object.entries(monthlySummary)
    .filter(([key]) => !["meal", "rest"].includes(key))
    .sort((a, b) => b[1] - a[1]);

  const max = entries[0]?.[1] || 1;

  return entries.map(([key, min]) => ({
    key,
    label: SUBJECT_SUMMARY_LABELS[key] || SUBJECT_LABELS[key] || key,
    minutes: min,
    ratio: Math.round((min / max) * 100),
  }));
}, [monthlySummary]);
  /* ------------------------------------------------------------------ */
  /* 🔹 체크박스 토글 (선생님/학생 공통) */
  /* ------------------------------------------------------------------ */

  const toggleTask = async (
  field: "teacherTasks" | "studentPlans",
  index: number
) => {
  if (!id || !selectedDate || !selectedSubject || readonly) return;

  // 1) 현재 상태에서 "업데이트 결과" 먼저 계산
  const day = plans[selectedDate];
  if (!day) return;

  const subj = day.subjects?.[selectedSubject];
  if (!subj) return;

  const list = [...(subj[field] || [])];
  if (!list[index]) return;

  list[index] = { ...list[index], done: !list[index].done };

  const updatedSubject: SubjectPlan = {
    ...subj,
    [field]: list,
  };

  const updatedDay: DayPlan = {
    ...day,
    subjects: {
      ...day.subjects,
      [selectedSubject]: updatedSubject,
    },
  };

  // 2) 화면은 즉시 반영 (await 없이)
  setPlans((prev) => ({
    ...prev,
    [selectedDate]: updatedDay,
  }));

  // 3) Firestore 저장 (여기서 await OK)
  const ref = doc(db, "studyPlans", id, "days", selectedDate);

  const payload = stripUndefinedDeep(
    cleanForFirestore({
      date: selectedDate,
      [selectedSubject]: updatedSubject,
    })
  );

  await setDoc(ref, payload, { merge: true });
};
const saveGoal = async (subjectKey: string, value: number) => {
  if (!id || !selectedExamId) return;

  const next = { ...goals, [subjectKey]: value };
  setGoals(next);

  await setDoc(
    doc(db, "studentExams", id, "progress", selectedExamId),
    {
      studentId: id,
      examId: selectedExamId,
      goals: next,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};


  /* ------------------------------ */
  /* 🔵 메인 과제 전체 토글 */
  /* ------------------------------ */
 const toggleMain = (taskIndex: number) => {
  if (!id || !selectedDate || !selectedSubject || readonly) return; // ✅ parent 막기

  setPlans((prev) => {
    const day = prev[selectedDate];
    if (!day) return prev;

    const subj = day.subjects?.[selectedSubject];
    if (!subj) return prev;

    const teacherTasks = (subj.teacherTasks || []).map((task, i) => {
      if (i !== taskIndex) return task;

      // 🔵 일반 과제
      if (!Array.isArray(task.subtasks) || task.subtasks.length === 0) {
        return { ...task, done: !task.done };
      }

      // 🔵 자동 과제 (메인)
      const doneCount = task.subtasks.filter((s) => s.done).length;
      const total = task.subtasks.length;

      const shouldComplete = doneCount === total ? false : true;

      return {
        ...task,
        done: shouldComplete,
        subtasks: task.subtasks.map((s) => ({
          ...s,
          done: shouldComplete,
        })),
      };
    });

    const updatedSubject = { ...subj, teacherTasks };

    const ref = doc(db, "studyPlans", id, "days", selectedDate);

    // ✅ undefined 제거해서 Firestore 에러 방지
    const payload = stripUndefinedDeep(
      cleanForFirestore({
        date: selectedDate,
        [selectedSubject]: updatedSubject,
      })
    );

    // ✅ setPlans 안에서는 await 금지 → 그냥 호출
    void setDoc(ref, payload, { merge: true });

    return {
      ...prev,
      [selectedDate]: {
        ...day,
        subjects: {
          ...day.subjects,
          [selectedSubject]: updatedSubject,
        },
      },
    };
  });
};
  /* ------------------------------ */
  /* 🔵 서브 과제 개별 토글 */
  /* ------------------------------ */
  const toggleSubtask = (taskIndex: number, subIndex: number) => {
  if (!id || !selectedDate || !selectedSubject || readonly) return; // ✅ parent 막기

  setPlans((prev) => {
    const day = prev[selectedDate];
    if (!day) return prev;

    const subj = day.subjects?.[selectedSubject];
    if (!subj) return prev;

    const teacherTasks = (subj.teacherTasks || []).map((task, i) => {
      if (i !== taskIndex) return task;
      if (!Array.isArray(task.subtasks) || task.subtasks.length === 0) return task;

      // 🔥 서브 과제 불변 토글
      const newSubtasks = task.subtasks.map((s, j) =>
        j === subIndex ? { ...s, done: !s.done } : s
      );

      const allDone = newSubtasks.every((s) => s.done);

      return {
        ...task,
        done: allDone,
        subtasks: newSubtasks,
      };
    });

    const updatedSubject = {
      ...subj,
      teacherTasks,
    };

    const ref = doc(db, "studyPlans", id, "days", selectedDate);

    // ✅ undefined 제거해서 Firestore 에러 방지
    const payload = stripUndefinedDeep(
      cleanForFirestore({
        date: selectedDate,
        [selectedSubject]: updatedSubject,
      })
    );

    void setDoc(ref, payload, { merge: true });

    return {
      ...prev,
      [selectedDate]: {
        ...day,
        subjects: {
          ...day.subjects,
          [selectedSubject]: updatedSubject,
        },
      },
    };
  });
};

  /* ------------------------------ */
  /* 🔁 안 한 과제 다음날로 미루기 */
  /* ------------------------------ */
 const carryOverWithMark = async () => {
  if (!id || !selectedDate || !selectedSubject) return;

  const nextDate = getNextDate(selectedDate);

  setPlans(prev => {
    const today = prev[selectedDate];
    if (!today) return prev;

    const subj = today.subjects[selectedSubject];
    if (!subj) return prev;

    const todayTasks: any[] = [];
    const nextTasks: any[] = [];

      subj.teacherTasks.forEach(t => {
        // 🔹 서브과제 있는 자동 과제
      if (Array.isArray(t.subtasks)) {
          const doneSubs = t.subtasks.filter(s => s.done);
          const undoneSubs = t.subtasks.filter(s => !s.done);

          // 오늘에 남길 과제
        if (doneSubs.length > 0) {
          todayTasks.push({
            ...t,
            subtasks: doneSubs,
            done: doneSubs.length === t.subtasks.length,
          });
        }

          // 내일로 넘길 과제
        if (undoneSubs.length > 0) {
          nextTasks.push({
            ...t,
  subtasks: undoneSubs.map(s => ({ ...s, done: false })),
            done: false,
            carriedOver: false,
  carriedFrom: selectedDate,   // ✅ “어제에서 넘어옴” 표시
          });

        }

        return;
      }

      // 🔹 수동 과제
      if (t.done) {
        todayTasks.push(t);
      } else {
          todayTasks.push(markAsCarriedOver(t));
          nextTasks.push(cloneForNextDay(t,selectedDate));
      }
    });

    if (nextTasks.length === 0) return prev;

    const nextDay = prev[nextDate] || { date: nextDate, subjects: {} };
    const nextSubj = nextDay.subjects[selectedSubject] || {
      teacherTasks: [],
      studentPlans: [],
    };

      const updatedToday = { ...subj, teacherTasks: todayTasks };
      const updatedNext = {
      ...nextSubj,
      teacherTasks: [...nextSubj.teacherTasks, ...nextTasks],
    };

      // Firestore 저장
      setDoc(
        doc(db, "studyPlans", id, "days", selectedDate),
        { date: selectedDate, [selectedSubject]: updatedToday },
        { merge: true }
      );

      setDoc(
        doc(db, "studyPlans", id, "days", nextDate),
        { date: nextDate, [selectedSubject]: updatedNext },
        { merge: true }
      );

    return {
      ...prev,
      [selectedDate]: {
        ...today,
          subjects: {
            ...today.subjects,
            [selectedSubject]: updatedToday,
          },
      },
      [nextDate]: {
        ...nextDay,
          subjects: {
            ...nextDay.subjects,
            [selectedSubject]: updatedNext,
          },
      },
    };
  });
};

  const updateWordTest = async (
    date: string,
    subjectKey: string,
    data: { correct?: number; total?: number }
  ) => {
    if (!id || !date) return;

    // 기존 데이터 불러오기
    const prevDay = plans[date];
    const prevSubj = prevDay?.subjects?.[subjectKey] || {};

    const updatedSubject = {
      ...prevSubj,
      wordTest: data,
    };

    const ref = doc(db, "studyPlans", id, "days", date);

    await setDoc(
      ref,
      {
        date,
        [subjectKey]: {
          wordTest: data
        }
      },
      { merge: true }
    );

    // React state 업데이트
    setPlans((prev) => ({
      ...prev,
      [date]: {
        date,
        subjects: {
          ...(prev[date]?.subjects || {}),
          [subjectKey]: updatedSubject,
        },
      },
    }));
  };

  

  /* ------------------------------------------------------------------ */
  /* 🔹 날짜 선택 */
  /* ------------------------------------------------------------------ */

  const handleSelectDate = (ds: string) => {
    setSelectedDate(ds);
  };

  /* ------------------------------------------------------------------ */
  /* 🔹 문제집 템플릿 (선생님 버튼) */
  /* ------------------------------------------------------------------ */

  const fillWorkbookTemplate = () => {
    const subjLabel =
      SUBJECTS.find((s) => s.key === selectedSubject)?.label || "과목";

    const today = selectedDate || new Date().toISOString().slice(0, 10);

    const base =
      `${subjLabel}) 문제집 p.___ ~ ___\n` +
      `단원평가 / 개념정리\n` +
      `오답정리 (${today.slice(5).replace("-", "/")})`;

    setTeacherInput((prev) => (prev ? prev + "\n" + base : base));
  };

  /* ------------------------------------------------------------------ */
  /* 🔹 시험기간 저장 */
  /* ------------------------------------------------------------------ */

  const saveTestPeriod = async () => {
    if (!id) return;
    if (!testTitle.trim() || !testStart || !testEnd) {
      alert("시험명, 시작일, 종료일을 모두 입력하세요.");
      return;
    }

    const ref = doc(collection(db, "studyPlans", id, "tests"));
    const data = {
      title: testTitle.trim(),
      start: testStart,
      end: testEnd,
      memo: testMemo.trim(),
      createdAt: serverTimestamp(),
    };

    await setDoc(ref, data);

    setTestList((prev) => [...prev, { id: ref.id, ...data }]);

    setShowTestModal(false);
    setTestTitle("");
    setTestStart("");
    setTestEnd("");
    setTestMemo("");
    alert("시험기간이 저장되었습니다.");
  };

  /* ------------------------------------------------------------------ */
  /* 🔹 저장 */
  /* ------------------------------------------------------------------ */
const handleSave = async () => {
  if (!id || !selectedDate) return alert("날짜를 먼저 선택하세요.");
  if (isParent) return;

  const prevDay = plans[selectedDate];
  const prevSubj = prevDay?.subjects?.[selectedSubject] || {};

  const ref = doc(db, "studyPlans", id, "days", selectedDate);

  if (isTeacher) {
    const prevTeacher = prevSubj?.teacherTasks || [];

    // 1) 자동 과제 유지
    const autoList = prevTeacher.filter((t: any) =>
      Array.isArray(t.subtasks)
    );

    // 2) 수동 과제 갱신
    const manualList = teacherInput
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({
        text,
        done: prevTeacher.find((x: any) => x.text === text)?.done ?? false,
      }));

    // 3) 최종 선생님 과제
    const teacherTasks = [...autoList, ...manualList];
const studentPlans =
  plans[selectedDate]?.subjects?.[selectedSubject]?.studentPlans ||
  prevSubj?.studentPlans ||
  [];
   const mergedSubject: SubjectPlan = {
  teacherTasks:
    (plans[selectedDate]?.subjects?.[selectedSubject]?.teacherTasks) ??
    (prevSubj?.teacherTasks || []),
  studentPlans,
  memo: memo.trim(),
  teacherComment: prevSubj?.teacherComment || "",
  done,
  updatedAt: serverTimestamp(),
  proofImages: prevSubj?.proofImages || [],
  proofMemo: prevSubj?.proofMemo || "",
  wordTest: prevSubj?.wordTest || {},
};

    const data = cleanForFirestore({
      date: selectedDate,
      [selectedSubject]: mergedSubject,
    });

    const payload = stripUndefinedDeep(data);

    await setDoc(ref, payload, { merge: true });

    setPlans((prev) => ({
      ...prev,
      [selectedDate]: {
        date: selectedDate,
        subjects: {
          ...(prev[selectedDate]?.subjects || {}),
          [selectedSubject]: mergedSubject,
        },
      },
    }));

    alert("저장 완료! (선생님 계획)");
    return;
  }

  if (isStudent) {
    const prevStudent = prevSubj?.studentPlans || [];

    const studentPlans = studentInput
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({
        text,
        done: prevStudent.find((x) => x.text === text)?.done ?? false,
      }));

    const mergedSubject: SubjectPlan = {
      teacherTasks: prevSubj?.teacherTasks || [], // ✅ 기존 선생님 과제 유지
      studentPlans,
      memo: memo.trim(),
      done,
      updatedAt: serverTimestamp(),
      proofImages: prevSubj?.proofImages || [],
      proofMemo: prevSubj?.proofMemo || "",
      wordTest: prevSubj?.wordTest || {},
    };

    const data = cleanForFirestore({
      date: selectedDate,
      [selectedSubject]: mergedSubject,
    });

    const payload = stripUndefinedDeep(data);

    await setDoc(ref, payload, { merge: true });

    setPlans((prev) => ({
      ...prev,
      [selectedDate]: {
        date: selectedDate,
        subjects: {
          ...(prev[selectedDate]?.subjects || {}),
          [selectedSubject]: mergedSubject,
        },
      },
    }));

    alert("저장 완료! (학생 계획)");
  }
};

  const getLatestTest = (ds: string) => {
    const d = new Date(ds).getTime();

    // ds 날짜를 포함하는 시험만 찾기
    const included = testList.filter(t => {
      const s = new Date(t.start).getTime();
      const e = new Date(t.end).getTime();
      return d >= s && d <= e;
    });

    if (included.length === 0) return null;

    // 시작일이 가장 늦은(최신) 시험을 선택
    included.sort(
      (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()
    );

    return included[0];
  };

  const isTestDay = (ds: string) => {
    return testList.some(t => ds >= t.start && ds <= t.end);
  };

  /* ------------------------------------------------------------------ */
  /* 📅 공부합계 */
  /* ------------------------------------------------------------------ */
  const formatMinutes = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
};


  /* ------------------------------------------------------------------ */
  /* 📅 달력 렌더링 */
  /* ------------------------------------------------------------------ */


  const renderCalendar = () => {
    const firstDay = new Date(year, month, 1).getDay();
    const last = new Date(year, month + 1, 0).getDate();

    const blanks = Array(firstDay).fill(null);
    const today = new Date().toISOString().slice(0, 10);
const selectedExam = myExams.find((x) => x.id === selectedExamId);
const examStatus = selectedExam ? getExamStatus(selectedExam.start, selectedExam.end) : "";


    return (
      <div>
    {/* 월 이동 헤더 */}
{/* 월 이동 헤더 - 세련된 버전 */}
<div
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "24px",
    padding: "10px 16px",
    background: "#e2eefd", 
    borderRadius: "20px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.03)", // 아주 은은한 그림자
    border: "1px solid #F1F5F9"
  }}
>
  {/* 왼쪽: 이전달 버튼 */}
  <button
    style={{
      width: "40px",
      height: "40px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "12px",
      border: "1px solid #E2E8F0",
      background: "#fff",
      cursor: "pointer",
      transition: "all 0.2s"
    }}
    onClick={() => {
      if (month === 0) { setYear(year - 1); setMonth(11); }
      else { setMonth(month - 1); }
    }}
  >
    <span style={{ fontSize: "16px", color: "#64748B", fontWeight: "800" }}>〈</span>
  </button>

  {/* 중앙: 연도와 월 (계층 구조 강조) */}
  <div style={{ textAlign: "center", cursor: "pointer" }} onClick={() => {
    // 💡 클릭하면 오늘 날짜로 돌아오는 기능 같은 걸 넣으면 좋아!
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }}>
    <div style={{ 
      fontSize: "13px", 
      color: "#29292a", 
      fontWeight: 700, 
      letterSpacing: "1px",
      marginBottom: "2px"
    }}>
      {year}
    </div>
    <div style={{ 
      fontSize: "22px", 
      fontWeight: 900, 
      color: "#1E293B",
      display: "flex",
      alignItems: "center",
      gap: "6px"
    }}>
      {month + 1}월
      <span style={{ fontSize: "12px", color: "#3B82F6", background: "#EFF6FF", padding: "2px 8px", borderRadius: "20px" }}>
        Today
      </span>
    </div>
  </div>

  {/* 오른쪽: 다음달 버튼 */}
  <button
    style={{
      width: "40px",
      height: "40px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "12px",
      border: "1px solid #E2E8F0",
      background: "#fff",
      cursor: "pointer",
      transition: "all 0.2s"
    }}
    onClick={() => {
      if (month === 11) { setYear(year + 1); setMonth(0); }
      else { setMonth(month + 1); }
    }}
  >
    <span style={{ fontSize: "16px", color: "#64748B", fontWeight: "800" }}>〉</span>
  </button>



          {isTeacher && (
            <button
              onClick={() => setShowTestModal(true)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #FCA5A5",
                background: "#FEF2F2",
                fontSize: 11,
                fontWeight: 700,
                color: "#B91C1C",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              📘 시험기간 추가
            </button>
          )}
        </div>

        {/* 요일 */}
        <div
          className="sp-calendar-weekdays">

          {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>

        {/* 날짜 그리드 */}
        <div
          className="sp-day-grid">

          {blanks.map((_, i) => (
            <div key={i} />
          ))}

          {Array.from({ length: last }, (_, i) => i + 1).map((d) => {
            const ds = `${year}-${String(month + 1).padStart(
              2,
              "0"
            )}-${String(d).padStart(2, "0")}`;
            const p = plans[ds];
            const todayExam = examData.filter(ex => ex.examDate === ds);


            const isSelected = ds === selectedDate;
            const isToday = ds === today;
            const testDay = isTestDay(ds);

            let teacherDone = 0,
              teacherTotal = 0,
              studentDone = 0,
              studentTotal = 0;

            if (p?.subjects) {
              Object.values(p.subjects).forEach((sub: any) => {
                const tTasks = sub.teacherTasks ?? [];
                const sPlans = sub.studentPlans ?? [];

                teacherDone += tTasks.filter((t: any) => t?.done).length;
                teacherTotal += tTasks.length;

                studentDone += sPlans.filter((t: any) => t?.done).length;
                studentTotal += sPlans.length;
              });
            }

            const bgClass =
              isSelected ? "bg-selected" :
                testDay ? "bg-test" :
                  teacherTotal || studentTotal ? "bg-has-plan" :
                    "bg-default";

            let bg = "#F9FAFB";
            if (teacherTotal || studentTotal) bg = "#E0F2FE";

            const anyDone =
              p &&
              Object.values(p.subjects || {}).some((sub) => sub.done === true);
            if (anyDone) bg = "#DCFCE7";

            // 시험기간인 날은 연핑크로 강조 (선택된 날은 선택색 우선)
            if (testDay) bg = "#FFE4E6";
            if (isSelected) bg = "#FEE2E2";

            return (
              <button
                className={`sp-day-box ${isToday ? "is-today" : ""} ${bgClass}`}
                key={ds}
              onClick={() => {
  console.log("날짜 클릭:", ds);
  handleSelectDate(ds);
  setTimelineDate(ds);
  setShowTimelineModal(true);
}}
              >
                <div className="sp-day-num">{d}</div>

                {testDay && (
                  <div className="sp-test-badge">📌 시험기간</div>
                )}

                {teacherTotal > 0 && (
                  <div className="badge-blue">
                    선생님 {teacherDone}/{teacherTotal}
                  </div>
                )}

                {studentTotal > 0 && (
                  <div className="badge-green">
                    내 계획 {studentDone}/{studentTotal}
                  </div>
                )}
                {/* 단어 시험 표시 */}
                {p?.subjects?.[selectedSubject]?.wordTest?.total ? (
                  <div
                    style={{
                      fontSize: 10,
                      color: "#DC2626",
                      marginTop: 2,
                      fontWeight: 700,
                    }}
                  >
                    단어{" "}
                    {p?.subjects?.[selectedSubject]?.wordTest?.correct ?? 0}/
                    {p?.subjects?.[selectedSubject]?.wordTest?.total ?? 0}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /* UI 시작 */
  /* ------------------------------------------------------------------ */
  const selectedDay = selectedDate ? plans[selectedDate] : undefined;
const teacherComment =
  selectedDay?.subjects?.[selectedSubject]?.teacherComment || "";
  
  const currentRoleLabel = isTeacher
    ? "선생님 모드"
    : isStudent
      ? "학생 모드"
      : "학부모 보기 (읽기 전용)";

  const currentSubjectLabel =
    SUBJECTS.find((s) => s.key === selectedSubject)?.label || "";

  // 선택한 날짜가 포함된 시험기간들
  const selectedDateTests =
    selectedDate
      ? testList.filter(
        (t) => selectedDate >= t.start && selectedDate <= t.end
      )
      : [];
      const studentPlansList =
  selectedDate ? (plans[selectedDate]?.subjects?.[selectedSubject]?.studentPlans || []) : [];

const hasStudentPlans = studentPlansList.length > 0;
const selectedExam = myExams.find((x) => x.id === selectedExamId);
const examStatus = selectedExam ? getExamStatus(selectedExam.start, selectedExam.end) : null;
  return (
    <div
      className="sp-container"
      style={{
        maxWidth: 960,
        margin: "32px auto",
        padding: "28px 24px",
        background: "#FFF",
        borderRadius: 18,
        boxShadow: "0 8px 22px rgba(15,23,42,0.12)",
        fontFamily: "Pretendard",
      }}
    >
      {/* 상단 헤더 */}
      <div
        style={{
          padding: "18px 20px",
          background: "#EEF2FF",
          borderRadius: 14,
          border: "1px solid #D9E1FF",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 900, color: "#0d3571" }}>
          {student?.name} 학생 학습 플래너
        </div>

        {student && (
          <div style={{ fontSize: 13, color: "#363c45", marginTop: 6 }}>
            {student.school} {student.grade} • 총 과제일{" "}
            {Object.keys(plans).length}일
          </div>
        )}

      
      </div>

{/* 출력/이동 영역 (선생님/학생) */}
{!isParent && (
  <div className="examCard">
    <div className="examTopRow">
      <select
        className="examSelect"
        value={selectedExamId ?? ""}
        onChange={(e) => setSelectedExamId(e.target.value)}
      >
        <option value="">시험 선택</option>
        {myExams.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.title}
          </option>
        ))}
      </select>

      <div className="examActions">
        <button
          className="btnExamMode"
          type="button"
          onClick={() => {
            if (!id) return alert("학생 ID 없음");
            if (!selectedExamId) return alert("시험을 먼저 선택하세요");
            navigate(`/study-plan/term-print/${id}/${selectedExamId}`);
          }}
        >
          시험모드
        </button>

        <button
          className="btnPortfolio"
          type="button"
          onClick={() => navigate(`/study-plan/portfolio-print/${id}`)}
        >
          포트폴리오
        </button>
      </div>
    </div>

    {selectedExam && (
      <div className="examMetaBox">
        <div className="examMetaLine1">
          <div className="examTitle">{selectedExam.title}</div>

          <div
            className={`examBadge ${
              examStatus === "종료"
                ? "isEnd"
                : examStatus === "시험중"
                ? "isOn"
                : "isBefore"
            }`}
          >
            {examStatus}
          </div>
        </div>

        <div className="examMetaLine2">
          <span>
            {selectedExam.start} ~ {selectedExam.end}
          </span>
          <span>·</span>
          <span>과목 {selectedExam.subjects.length}</span>
        </div>
      </div>
    )}

    {myExams.length === 0 && (
      <div className="examEmpty">
        등록된 시험이 없습니다. (선생님이 시험 관리에서 먼저 입력해야 함)
      </div>
    )}
  </div>
)}

      {/* ---------------- 2컬럼 레이아웃 ---------------- */}
      <div
        className="sp-grid">
    {/* 오른쪽: 과목 탭 + 입력/체크 */}
        <div
          style={{
            padding: 16,
            background: "#FFFFFF",
            borderRadius: 14,
            border: "1px solid #E5E7EB",
          }}
        >
          {/* 📘 오늘 선생님 과제 요약 (과목 탭 위에 노출) */}
          {selectedDate && todayTeacherSummary.length > 0 && (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #DBEAFE",
                background: "#EFF6FF",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#1D4ED8",
                  marginBottom: 6,
                }}
              >
                [오늘 선생님 과제 한눈에 보기]
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: 12,
                  color: "#1F2937",
                }}
              >
                {todayTeacherSummary.map((subj) => (
                  <div
                    key={subj.key}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 8,
                      background: "#FFFFFF",
                      border: "1px dashed #BFDBFE",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                        marginBottom: 3,
                        color: "#1E3A8A",
                      }}
                    >
                      {subj.label}
                    </div>
                    <div
                      style={{
                        whiteSpace: "pre-line",
                        fontSize: 11,
                        lineHeight: 1.4,
                      }}
                    >
                      {subj.tasks.map((task: any, i: number) => (
  <label
    key={i}
    style={{
      display: "flex",
      gap: 6,
      marginBottom: 4,
      fontSize: 12,
    }}
  >
    <input
      type="checkbox"
      checked={task.done}
      onChange={() => toggleTask("teacherTasks", i)}
    />
    <span>{task.title || task.text}</span>
  </label>
))}

                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 과목 탭 (5개씩 두 줄) */}
          {/* 
          <div
            className="sp-subject-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {SUBJECTS.map((s) => {
              const active = s.key === selectedSubject;
              return (
                <button
                  key={s.key}
                  onClick={() => setSelectedSubject(s.key)}
                  style={{
                    flex: "0 0 auto",
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: active
                      ? "1px solid #1E3A8A"
                      : "1px solid #E5E7EB",
                    background: active ? "#1E3A8A" : "#F9FAFB",
                    color: active ? "#FFFFFF" : "#4B5563",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
*/}
   
          {/* 선택 날짜가 시험기간이면 안내 */}
          {selectedDateTests.length > 0 && (
            <div
              style={{
                fontSize: 12,
                color: "#B91C1C",
                marginBottom: 10,
                background: "#FEF2F2",
                borderRadius: 8,
                padding: "6px 8px",
                border: "1px solid #FCA5A5",
              }}
            >
              📌 현재 시험기간:{" "}
              {selectedDateTests
                .map((t) => {
                  const range =
                    t.start.slice(5).replace("-", "/") +
                    " ~ " +
                    t.end.slice(5).replace("-", "/");
                  return t.title ? `${t.title} (${range})` : range;
                })
                .join(", ")}
            </div>
          )}

     

          {/* 문제집 자동 채우기 버튼 (선생님만) */}
          {isTeacher && (
            <button
              onClick={fillWorkbookTemplate}
              style={{
                marginTop: -6,
                marginBottom: 8,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px dashed #93C5FD",
                background: "#EFF6FF",
                fontSize: 11,
                color: "#1D4ED8",
                cursor: "pointer",
              }}
            >
              🧾 문제집 기본 템플릿 넣기
            </button>
          )}

          {/* 🔵 단어 시험 기록 */}
         {selectedDate && isTeacher && (
            <div
              style={{
                background: "#F0F9FF",
                border: "1px solid #93C5FD",
                padding: 10,
                borderRadius: 10,
                marginTop: 12,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1D4ED8",
                  marginBottom: 6,
                }}
              >
                📘 단어 시험 기록
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                {/* ✅ 맞은 개수 */}
                <input
                  type="number"
                  placeholder="맞은 개수"
                  value={
                    selectedDay?.subjects?.[selectedSubject]?.wordTest?.correct ?? ""
                  }
                  onChange={(e) => {
                    if (!selectedDate || !id) return;

                    const num = Number(e.target.value || 0);

                    // 1) 화면 상태 업데이트
                    setPlans((prev) => {
                      const day = prev[selectedDate] || { subjects: {} as any };
                      const subjects = day.subjects || {};
                      const subj = subjects[selectedSubject] || {};

                      const newWord = {
                        ...(subj.wordTest || { correct: 0, total: 0 }),
                        correct: num,
                      };

                      const updatedDay = {
                        ...day,
                        subjects: {
                          ...subjects,
                          [selectedSubject]: {
                            ...subj,
                            wordTest: newWord,
                          },
                        },
                      };

                      // 🔥 2) Firestore에도 같이 저장
                      const prevSubj =
                        (plans[selectedDate]?.subjects?.[selectedSubject] as any) || {};
                      const fsWord = {
                        ...(prevSubj.wordTest || { correct: 0, total: 0 }),
                        correct: num,
                      };

                      const ref = doc(db, "studyPlans", id, "days", selectedDate);
                      setDoc(
                        ref,
                        cleanForFirestore({
                          date: selectedDate,
                          [selectedSubject]: {
                            ...prevSubj,
                            wordTest: fsWord,
                          },
                        }),
                        { merge: true }
                      );

                      return {
                        ...prev,
                        [selectedDate]: updatedDay,
                      };
                    });
                  }}
                  style={{
                    width: 100,
                    padding: 6,
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                  }}
                />

                {/* ✅ 총 문제 수 */}
                <input
                  type="number"
                  placeholder="총 문제 수"
                  value={
                    selectedDay?.subjects?.[selectedSubject]?.wordTest?.total ?? ""
                  }
                  onChange={(e) => {
                    if (!selectedDate || !id) return;

                    const num = Number(e.target.value || 0);

                    // 1) 화면 상태 업데이트
                    setPlans((prev) => {
                      const day = prev[selectedDate] || { subjects: {} as any };
                      const subjects = day.subjects || {};
                      const subj = subjects[selectedSubject] || {};

                      const newWord = {
                        ...(subj.wordTest || { correct: 0, total: 0 }),
                        total: num,
                      };

                      const updatedDay = {
                        ...day,
                        subjects: {
                          ...subjects,
                          [selectedSubject]: {
                            ...subj,
                            wordTest: newWord,
                          },
                        },
                      };

                      // 🔥 2) Firestore에도 같이 저장
                      const prevSubj =
                        (plans[selectedDate]?.subjects?.[selectedSubject] as any) || {};
                      const fsWord = {
                        ...(prevSubj.wordTest || { correct: 0, total: 0 }),
                        total: num,
                      };

                      const ref = doc(db, "studyPlans", id, "days", selectedDate);
                      setDoc(
                        ref,
                        cleanForFirestore({
                          date: selectedDate,
                          [selectedSubject]: {
                            ...prevSubj,
                            wordTest: fsWord,
                          },
                        }),
                        { merge: true }
                      );

                      return {
                        ...prev,
                        [selectedDate]: updatedDay,
                      };
                    });
                  }}
                  style={{
                    width: 100,
                    padding: 6,
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                  }}
                />
              </div>
            </div>
          )}

       {/*
          <button
  onClick={() => alert("⚠️ 이월 기능 점검중이라 잠시 꺼뒀어요.")}
  style={{
    width: "100%",
    marginTop: 10,
    padding: "8px 0",
    background: "#FEE2E2",
    color: "#991B1B",
    borderRadius: 10,
    border: "1px solid #FCA5A5",
    fontSize: 13,
    fontWeight: 700,
  }}
>
  ❌ 안 한 과제 다음날로 미루기
</button> */}


      {/* ✏️ 내 공부 계획 — 선생님 박스와 같은 이중 박스 (여기 1곳만!) */}
{selectedDate && (
  <div
    style={{
      marginBottom: 14,
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #D1FAE5",
      background: "#ECFDF5",
    }}
  >
    <div style={{ fontSize: 14, fontWeight: 800, color: "#047857", marginBottom: 6 }}>
      [나의 학습 계획]
    </div>

    <div
      style={{
        padding: "6px 8px",
        borderRadius: 8,
        background: "#FFFFFF",
        border: "1px dashed #8de3f8",
      }}
    >
      <textarea
        value={studentInput}
        onChange={(e) => setStudentInput(e.target.value)}
        readOnly={isParent || isTeacher}
        disabled={(isParent || isTeacher) && !studentInput}
        rows={4}
        placeholder="예) 오답 정리, 개념 암기, 시험 대비 요약노트 등"
        style={{
          width: "100%",
          borderRadius: 10,
          border: "1px solid #E5E7EB",
          padding: "8px 10px",
          fontSize: 13,
          background: "#F9FAFB",
          resize: "vertical",
        }}
      />

      {hasStudentPlans && (
        <div style={{ marginTop: 10 }}>
          {studentPlansList.map((task, i) => (
            <label
              key={i}
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 4,
                fontSize: 12,
                color: "#1F2937",
              }}
            >
              <input
                type="checkbox"
                checked={!!task.done}
                onChange={() => toggleTask("studentPlans", i)}
                disabled={isParent}
              />
              <span>{task.text}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  </div>
)}

{/* 🔥 몰입 에너지 통합 박스 */}
{selectedDate && (focusRows.length > 0 || weeklyRows.length > 0 || monthlyRows.length > 0) && (
  <div style={{ marginTop: 14, marginBottom: 14, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 12 }}>
    <div style={{ fontSize: 14, fontWeight: 900, color: "#1E3A8A", marginBottom: 12 }}>🔥 몰입 에너지</div>

    {/* 오늘 몰입 섹션 - 텍스트와 바 분리형 */}
  {focusRows.length > 0 && (
  <div style={{ padding: "14px 16px", borderRadius: 12, background: "#FFFFFF", border: "1px solid #E2E8F0", marginBottom: 12 }}>
    {/* 타이틀과 과목 리스트를 한 줄(row)에 배치 */}
    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: "#1E3A8A", whiteSpace: "nowrap" }}>
        ⚡️ 오늘 실시간 몰입
      </span>
      
      <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>
        {focusRows.map((r, idx) => (
          <span key={r.key}>
            <span style={{ color: SUBJECT_COLORS[r.key]?.bg, fontWeight: 800 }}>{r.label}</span> {r.minutes}분
            {idx < focusRows.length - 1 && <span style={{ margin: "0 8px", opacity: 0.3 }}>|</span>}
          </span>
        ))}
      </div>
    </div>

    {/* 하단 컬러 바(Bar) */}
    <div style={{ width: "100%", height: 10, background: "#F1F5F9", borderRadius: 999, overflow: "hidden", display: "flex" }}>
      {focusRows.map((row) => {
        const total = focusRows.reduce((sum, r) => sum + r.minutes, 0) || 1;
        return (
          <div key={row.key} title={`${row.label} ${row.minutes}분`}
            style={{
              width: `${(row.minutes / total) * 100}%`,
              height: "100%",
              background: SUBJECT_COLORS[row.key]?.bg || "#3B82F6",
              transition: "width 0.4s ease"
            }}
          />
        );
      })}
    </div>
  </div>
)}
    {/* 주간/월간 아코디언도 동일한 깔끔한 스타일로 적용 */}
    {[
      { label: "📅 이번 주 누적", rows: weeklyRows, open: openEnergyWeek, setter: setOpenEnergyWeek },
      { label: "🗓 이번 달 누적", rows: monthlyRows, open: openEnergyMonth, setter: setOpenEnergyMonth }
    ].map((item, idx) => item.rows.length > 0 && (
      <div key={idx} style={{ marginBottom: 8 }}>
        <button type="button" onClick={() => item.setter(!item.open)} style={energyAccordionBtnStyle}>
          <span>{item.label}</span>
          <span>{item.open ? "▾" : "▸"}</span>
        </button>
        {item.open && (
          <div style={{ marginTop: 8, padding: "12px", borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E8F0" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: 10 }}>
              {item.rows.map((r) => (
                <span key={r.key} style={{ fontSize: 10, fontWeight: 700, color: "#64748B" }}>
                  {r.label} <b style={{ color: SUBJECT_COLORS[r.key]?.bg }}>{formatMinutes(r.minutes)}</b>
                </span>
              ))}
            </div>
            <div style={{ width: "100%", height: 8, background: "#F1F5F9", borderRadius: 999, overflow: "hidden", display: "flex" }}>
              {item.rows.map((row) => {
                const total = item.rows.reduce((sum, r) => sum + r.minutes, 0) || 1;
                return (
                  <div key={row.key} style={{ width: `${(row.minutes / total) * 100}%`, height: "100%", background: SUBJECT_COLORS[row.key]?.bg }} />
                );
              })}
            </div>
          </div>
        )}
      </div>
    ))}
  </div>
)}
          {/* 🔥 집공 인증샷 섹션 
          {selectedDate && (
            <ProofSection
              images={proofImages}
              setImages={setProofImages}
              memo={proofMemo}
              setMemo={setProofMemo}
              readonly={isParent || isTeacher}
              studentId={id || ""}           // ← 여기 추가!
              selectedDate={selectedDate || ""}
            />
          )}
            */}
        {/* 📝 선생님 코멘트 - 깔끔한 피드백 카드 스타일 */}
{/* 📝 선생님 코멘트 - 복구 및 디자인 개선 */}
<div
  style={{
    marginTop: 20,
    padding: "16px",
    borderRadius: "14px",
    background: "#F8FAFC", 
    border: "1px solid #E2E8F0",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: 13,
      fontWeight: 800,
      color: "#372f37",
      marginBottom: 10,
    }}
  >
    <span>💬</span> [선생님 코멘트]
  </div>

  <div
    style={{
      fontSize: 14,
      lineHeight: 1.6,
      color: teacherCommentText ? "#a3478e" : "#94A3B8", 
      minHeight: "40px", // 기존 높이 유지
      whiteSpace: "pre-wrap",
      padding: "12px",
      background: "#FFFFFF", 
      borderRadius: "10px",
      border: "1px solid #F1F5F9",
    }}
  >
    {/* 변수명이 정확한지 확인: teacherCommentText */}
    {teacherCommentText && teacherCommentText.trim() !== "" 
      ? teacherCommentText 
      : "아직 남겨진 코멘트가 없습니다."}
  </div>
</div>

          {/* 저장 버튼 */}
          {!isParent && (
            <>
            
              <button
                onClick={handleSave}
                style={{
                  width: "100%",
                  padding: "10px 0",
                  marginTop: 18,
                  background: "#ddeafc",
                  color: "#343333",
                  borderRadius: 10,
                  border: "none",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                저장하기
              </button>
            </>
          )}
        </div>

 {/* 왼쪽: 달력 */}
<div
  style={{
    padding: 16,
    background: "#F9FAFB",
    borderRadius: 14,
    border: "1px solid #E5E7EB",
  }}
>
  {renderCalendar()}
</div>

{showTimelineModal && timelineDate && (
  <StudyTimelineModal
    key={timelineDate}
    open={true}
    dateStr={timelineDate}
    studentId={id || ""}
    onClose={() => {
      setShowTimelineModal(false);
      setTimelineDate(null);
    }}
  />
)}
    
      </div>

      {/* ---------------- WEEKLY VIEW ---------------- */}
      <WeeklyView selectedDate={selectedDate} plans={plans} tests={testList} />

      {/* ---------------- 시험기간 모달 ---------------- */}
      {showTestModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#FFFFFF",
              borderRadius: 16,
              padding: "18px 18px 16px",
              boxShadow: "0 10px 30px rgba(15,23,42,0.35)",
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "#B91C1C",
                marginBottom: 12,
              }}
            >
              📘 시험기간 등록
            </div>

            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#4B5563",
                  marginBottom: 4,
                }}
              >
                시험 이름
              </div>
              <input
                type="text"
                value={testTitle}
                onChange={(e) => setTestTitle(e.target.value)}
                placeholder="예) 1학기 중간고사"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #E5E7EB",
                  fontSize: 13,
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#4B5563",
                    marginBottom: 4,
                  }}
                >
                  시작일
                </div>
                <input
                  type="date"
                  value={testStart}
                  onChange={(e) => setTestStart(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 8px",
                    borderRadius: 8,
                    border: "1px solid #E5E7EB",
                    fontSize: 12,
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#4B5563",
                    marginBottom: 4,
                  }}
                >
                  종료일
                </div>
                <input
                  type="date"
                  value={testEnd}
                  onChange={(e) => setTestEnd(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 8px",
                    borderRadius: 8,
                    border: "1px solid #E5E7EB",
                    fontSize: 12,
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#4B5563",
                  marginBottom: 4,
                }}
              >
                메모 (선택)
              </div>
              <textarea
                value={testMemo}
                onChange={(e) => setTestMemo(e.target.value)}
                rows={3}
                placeholder="범위, 목표, 유의사항 등을 적어주세요."
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1px solid #E5E7EB",
                  padding: "8px 10px",
                  fontSize: 13,
                  background: "#F9FAFB",
                  resize: "vertical",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  등록된 시험기간
                </div>

                {testList.map(t => (
                  <div
                    key={t.id}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #E5E7EB",
                      marginBottom: 6,
                      background: "#FAFAFA",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <div>
                      <b>{t.title}</b>
                      <div style={{ fontSize: 12, color: "#6B7280" }}>
                        {t.start} ~ {t.end}
                      </div>
                    </div>

                    <button
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #FCA5A5",
                        background: "#FEF2F2",
                        fontSize: 11,
                        color: "#B91C1C",
                      }}
                      onClick={() => deleteTest(t.id)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowTestModal(false)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: "1px solid #E5E7EB",
                  background: "#F9FAFB",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                취소
              </button>
              <button
                onClick={saveTestPeriod}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "none",
                  background: "#B91C1C",
                  color: "#FFFFFF",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* 📌 공통 InputSection */
/* ------------------------------------------------------------------ */

type InputSectionProps = {
  title: string;
  value: string;
  setValue: (v: string) => void;
  readonly: boolean;
  placeholder?: string;
  rows?: number;
  subjLabel?: string; // 선생님 과제일 때 과목명 prefix용
};

function InputSection({
  title,
  value,
  setValue,
  readonly,
  placeholder,
  rows = 4,
  subjLabel,
}: InputSectionProps) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#4B5563",
          marginBottom: 6,
        }}
      >
        {title}
      </div>

      <textarea
        value={value}
        onChange={(e) => {
          let text = e.target.value;

          // 선생님 과제일 때만 "과목)" prefix 자동
          if (!readonly && title === "선생님 과제" && subjLabel) {
  const prefix = subjLabel + ")";
  if (text && !text.startsWith(prefix)) {
    text = prefix + " " + text;
  }
}

          setValue(text);
        }}
        readOnly={readonly}
        disabled={readonly && !value}
        rows={rows}
        style={textarea}
        placeholder={placeholder}
      />
    </div>
  );
}

type ProofSectionProps = {
  images: string[];
  setImages: React.Dispatch<React.SetStateAction<string[]>>;
  memo: string;
  setMemo: React.Dispatch<React.SetStateAction<string>>;
  readonly: boolean;
  studentId: string;
  selectedDate: string;
};

function ProofSection({
  images,
  setImages,
  memo,
  setMemo,
  readonly,
  studentId,
  selectedDate,
}: ProofSectionProps) {

  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const deleteImage = async (url: string, index: number) => {
    if (!selectedDate) return;

    // 1) 상태에서 삭제
    const newList = images.filter((_, i) => i !== index);
    setImages(newList);

    try {
      // 2) Storage에서 삭제
      const storage = getStorage();
      const fileRef = ref(storage, url);

      await deleteObject(fileRef);

      // 3) Firestore 업데이트
      await setDoc(
        doc(db, "studyPlans", studentId, "days", selectedDate),
        {
          proofImages: newList,   // 필드명도 맞춰줘야 함!!
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {

    }
  };
  /** ------------------------------------------------------
   * 🔥 1) 자동 리사이즈 (긴 변 1200px)
   --------------------------------------------------------*/
  const resizeImage = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const img = document.createElement("img");
      const reader = new FileReader();

      reader.onload = (e) => (img.src = e.target!.result as string);
      reader.readAsDataURL(file);

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 1200;

        let w = img.width;
        let h = img.height;

        if (w > h && w > MAX) {
          h = (h * MAX) / w;
          w = MAX;
        } else if (h > w && h > MAX) {
          w = (w * MAX) / h;
          h = MAX;
        }

        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);

        canvas.toBlob((blob) => {
          if (blob)
            resolve(new File([blob], file.name, { type: "image/jpeg" }));
        }, "image/jpeg", 0.85);
      };
    });
  };

  /** ------------------------------------------------------
   * 🔥 2) 파일 업로드 + 리사이즈 + 저장
   --------------------------------------------------------*/
  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const arr = Array.from(files);
    const urls: string[] = [];

    // storage 업로드
    for (const f of arr) {
      const resized = await resizeImage(f); // ⭐ 자동 리사이즈 적용
      const url = await uploadProof(resized, studentId);
      if (url) urls.push(url);
    }

    // 화면에 즉시 표시
    setImages((prev) => [...prev, ...urls]);

    // 날짜별 Firestore 저장
    if (selectedDate) {
      await setDoc(
        doc(db, "studyPlans", studentId, "days", selectedDate),
        {
          proofImages: [...images, ...urls],
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  };

  /** ------------------------------------------------------
   * 🔥 3) 확대된 이미지에서 좌우 이동 처리
   --------------------------------------------------------*/
  const moveImage = (dir: "prev" | "next") => {
    if (!zoomImg) return;
    const idx = images.indexOf(zoomImg);

    if (idx === -1) return;

    if (dir === "prev" && idx > 0) {
      setZoomImg(images[idx - 1]);
    }
    if (dir === "next" && idx < images.length - 1) {
      setZoomImg(images[idx + 1]);
    }
  };

  return (
    <div style={{ marginTop: 10, marginBottom: 16 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#4B5563",
          marginBottom: 6,
        }}
      >
        📸 집공 인증샷 / 메모
      </div>

      {!readonly && (
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handleFiles}
          style={{ fontSize: 12, marginBottom: 8 }}
        />
      )}

      {/* 썸네일 */}
      {images.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          {images.map((url, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img
                src={url}
                onClick={() => setZoomImg(url)}
                style={{
                  width: 72,
                  height: 72,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid #E5E7EB",
                  cursor: "pointer",
                }}
              />

              {!readonly && (
                <button
                  type="button"
                  onClick={() => deleteImage(url, i)}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 18,
                    height: 18,
                    borderRadius: "999px",
                    border: "none",
                    background: "#EF4444",
                    color: "#FFF",
                    fontSize: 10,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 🔥 확대 + 좌우 슬라이드 */}
      {zoomImg && (
        <div
          onClick={() => setZoomImg(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 999,
            cursor: "zoom-out",
          }}
        >
          {/* 이전 버튼 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              moveImage("prev");
            }}
            style={{
              position: "absolute",
              left: 20,
              fontSize: 40,
              background: "transparent",
              border: "none",
              color: "white",
              cursor: "pointer",
            }}
          >
            ‹
          </button>

          {/* 확대 이미지 */}
          <img
            src={zoomImg}
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              borderRadius: 12,
            }}
          />

          {/* 다음 버튼 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              moveImage("next");
            }}
            style={{
              position: "absolute",
              right: 20,
              fontSize: 40,
              background: "transparent",
              border: "none",
              color: "white",
              cursor: "pointer",
            }}
          >
            ›
          </button>
        </div>
      )}

      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        readOnly={readonly}
        rows={2}
        placeholder="집에서 공부한 내용, 인증 메모를 적어주세요."
        style={textarea}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 📅 WEEKLY VIEW — 주간 학습 요약 */
/* ------------------------------------------------------------------ */

function WeeklyView({
  selectedDate,
  plans,
  tests,
}: {
  selectedDate: string | null;
  plans: Record<string, DayPlan>;
  tests: any[];
}) {
  // 🔥 days 배열 안전 생성 (HMR 시 undefined 방지)
  const base = selectedDate ? new Date(selectedDate) : new Date();
  const dayIndex = base.getDay();
  const monday = new Date(base);
  monday.setDate(base.getDate() - dayIndex + 1);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  });
  if (!selectedDate) {
    return (
      <div
        style={{
          marginTop: 32,
          padding: "20px 22px",
          background: "#F9FAFB",
          borderRadius: 14,
          border: "1px solid #E5E7EB",
          textAlign: "center",
          color: "#6B7280",
        }}
      >
        날짜를 선택하면 주간 계획이 표시됩니다.
      </div>
    );
  }


  const dayNames = ["월", "화", "수", "목", "금", "토", "일"];

  const isTestDay = (ds: string) =>
    tests?.some((t: any) => ds >= t.start && ds <= t.end);

  return (
    <div
      style={{
        marginTop: 32,
        padding: "20px 22px",
        background: "#EEF2FF",
        borderRadius: 14,
        border: "1px solid #D9E1FF",
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: "#1E3A8A",
          marginBottom: 14,
        }}
      >
        📅 WEEKLY VIEW — 주간 학습 요약
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 10,
        }}
      >
        {days.map((ds, idx) => {
          const p = plans[ds];

          // 🔥 기록 없음 early-return (여기가 정확한 위치)
          if (!p || !p.subjects) {
            return (
              <div
                key={ds}
                style={{
                  padding: "10px 12px",
                  background: "#FFFFFF",
                  borderRadius: 12,
                  border: "1px solid #E5E7EB",
                  minHeight: 120,
                  boxShadow: "0 3px 8px rgba(0,0,0,0.05)",
                  fontSize: 12,
                  color: "#9CA3AF",
                }}
              >
                기록 없음
              </div>
            );
          }

          let teacherDone = 0,
            teacherTotal = 0,
            studentDone = 0,
            studentTotal = 0;
          let anyDone = false;

          if (p.subjects) {
            Object.values(p.subjects).forEach((sub: any) => {
              const tTasks = sub.teacherTasks ?? [];
              const sPlans = sub.studentPlans ?? [];

              teacherDone += tTasks.filter((t: any) => t?.done).length;
              teacherTotal += tTasks.length;

              studentDone += sPlans.filter((t: any) => t?.done).length;
              studentTotal += sPlans.length;

              if (sub.done) anyDone = true;
            });
          }

          const testDay = isTestDay(ds);

          return (
            <div
              key={ds}
              style={{
                padding: "10px 12px",
                background: "#FFFFFF",
                borderRadius: 12,
                border: "1px solid #E5E7EB",
                minHeight: 120,
                boxShadow: "0 3px 8px rgba(0,0,0,0.05)",
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 13,
                  color: "#1E3A8A",
                  marginBottom: 4,
                }}
              >
                {dayNames[idx]} {ds.slice(5)}
              </div>

              {testDay && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#B91C1C",
                    marginBottom: 4,
                  }}
                >
                  📌 시험기간
                </div>
              )}

              {p ? (
                <>
                  <div
                    style={{
                      fontSize: 12,
                      color: teacherTotal ? "#1D4ED8" : "#9CA3AF",
                    }}
                  >
                    선생님 {teacherDone}/{teacherTotal}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: studentTotal ? "#16A34A" : "#9CA3AF",
                    }}
                  >
                    내 계획 {studentDone}/{studentTotal}
                  </div>

                  {anyDone && (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 11,
                        color: "#059669",
                        fontWeight: 700,
                      }}
                    >
                      ✔ 하루 전체 과목 중 완료된 것 있음
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>기록 없음</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 공용 스타일 */
/* ------------------------------------------------------------------ */

const navBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: "999px",
  border: "1px solid #E5E7EB",
  background: "#F3F4F6",
  cursor: "pointer",
};

const badgeBlue: React.CSSProperties = {
  fontSize: 10,
  color: "#1D4ED8",
};

const badgeGreen: React.CSSProperties = {
  fontSize: 10,
  color: "#16A34A",
};

const textarea: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid #E5E7EB",
  padding: "8px 10px",
  fontSize: 13,
  background: "#F9FAFB",
  resize: "vertical",
};

const topOutBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #CBD5E1",
  background: "#FFFFFF",
  fontSize: 12,
  fontWeight: 700,
  color: "#1E3A8A",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const rangeBtn: React.CSSProperties = {
  padding: "6px 10px",
  background: "#EEF2FF",
  border: "1px solid #CBD5E1",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  color: "#1E3A8A",
  whiteSpace: "nowrap",
};

const dateInput: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 12,
  border: "1px solid #CBD5E1",
  borderRadius: 6,
  background: "#FFFFFF",
};

const applyBtn: React.CSSProperties = {
  padding: "6px 12px",
  background: "#1E3A8A",
  color: "#FFFFFF",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  border: "none",
  whiteSpace: "nowrap",
};

const energyAccordionBtnStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #E2E8F0",
  background: "#FFFFFF",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 800,
  color: "#1E3A8A",
};