import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "./firebase";
import GradeModal from "./components/GradeModal";
import GradeChartModal from "./components/GradeChartModal";  // ✅ 중괄호 제거
import EditStudentModal from "./components/EditStudentModal";
import {
  collection,
  doc,
  setDoc,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  where,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
// ✅ Firestore에서 학생 완전 삭제 함수
async function deleteStudentFromFS(studentId: string) {
  try {
    await deleteDoc(doc(db, "students", studentId));
    console.log("🗑️ Firestore에서 학생 완전 삭제됨:", studentId);
  } catch (e) {
    console.error("❌ Firestore 학생 삭제 실패:", e);
  }
}



/** ================= 유틸: 시간 계산 ================= */
/** "HH:MM" -> 총 분 */
const hmToMin = (hm?: string) => {
  if (!hm || !/^\d{2}:\d{2}$/.test(hm)) return 0;
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};
/** 총 분 -> "HH:MM" */
const minToHM = (min: number) => {
  const mm = Math.max(0, Math.round(min));
  const h = Math.floor(mm / 60);
  const m = mm % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** 두 시간 차이(분) */
const spanMin = (from?: string, to?: string) => {
  if (!from || !to) return 0;
  const start = hmToMin(from);
  const end = hmToMin(to);
  // ✅ 자정을 넘긴 경우 보정 (예: 16:00 → 06:00)
  const diff = end >= start ? end - start : end + 24 * 60 - start;
  return diff;
};

// 과목별 파스텔톤 색상 매핑
const subjectColor = (sub: string) => {
  switch (sub) {
    case "영어": return "linear-gradient(135deg,#f9a8d4,#fbcfe8)"; // 핑크
    case "수학": return "linear-gradient(135deg,#a7f3d0,#6ee7b7)"; // 민트
    case "국어": return "linear-gradient(135deg,#ddd6fe,#c4b5fd)"; // 보라
    case "과학": return "linear-gradient(135deg,#bae6fd,#93c5fd)"; // 하늘
    case "기타": return "linear-gradient(135deg,#fef3c7,#fde68a)"; // 노랑
    case "학교": return "linear-gradient(135deg,#fecaca,#fca5a5)"; // 코랄
    default: return "linear-gradient(135deg,#e5e7eb,#f3f4f6)"; // 기본 연회색
  }
};

// 과목별 라벨 스타일 (살짝 더 진한 파스텔톤 + 진회색)
const subjectLabel = (sub: string): React.CSSProperties => {
  const base: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",  // 진한 회색 (눈 편함)
    padding: "5px 12px",
    borderRadius: 8,
    whiteSpace: "nowrap",
    letterSpacing: "0.2px",
    border: "none",
  };

  // 🎨 뉴트럴 파스텔 톤 매핑
  const bgMap: Record<string, string> = {
    "영어": "#EEF2FF", // 라벤더 그레이 (은은한 보라+회색)
    "수학": "#E7F6EF", // 소프트 민트 (톤다운된 녹색)
    "국어": "#F5F3FF", // 페일 바이올렛
    "과학": "#ECF5FB", // 페일 블루그레이
    "기타": "#FAF5E7", // 샌드 베이지
    "학교": "#FBEAEA", // 로즈 베이지 (핑크X)
  };

  return {
    ...base,
    background: bgMap[sub] || "#F5F6F8",
  };
};
/** ================= 타입/상수 ================= */
const style = {
  button: {
    sm: {
      padding: "4px 8px",
      border: "1px solid #dde1ea",
      borderRadius: 6,
      background: "#fff",
      cursor: "pointer",
      fontSize: 12,
    } as React.CSSProperties,
  },
  status: {
    P: { color: "#10b981", background: "#d1fae5" },
    L: { color: "#f59e0b", background: "#fef3c7" },
    A: { color: "#ef4444", background: "#fee2e2" },
    E: { color: "#6366f1", background: "#e0e7ff" },
  } as Record<StatusKey, { color: string; background: string }>,
};

export type StatusKey = "P" | "L" | "A" | "E";
export type AcademyType =  "영어" | "수학" | "국어" | "과학" | "기타" | "학교";

export type TimeSlot = {
  day: number;
  from: string;
  to: string;
};
export type WeeklyTime = {
  slots: TimeSlot[];
};
export type SubjectEntry = { from?: string; to?: string; slots?: TimeSlot[] };

export interface DayCell {
  status: StatusKey;
  time?: string;
  outTime?: string;

  // (구버전 호환)
  academyFrom?: string;
  academyTo?: string;
  enabledSubjects?: AcademyType[];

  // 과목별 시간
  academyBySubject?: Partial<Record<AcademyType, SubjectEntry>>;
 overrideAcademyTimes?: Record<string, { subject: string; from: string; to: string; date: string }>;

  // 휴식/식사
  restroomCount?: number;
  restroomMin?: number;
  mealMin?: number;
   commuteMin?: number; // 이동 / 통학 시간(분 단위)

  // 메모/과제
  memo?: string;
  comment?: string;
  studyNote?: string;
  tasks?: TaskItem[];
  hwDone?: boolean;

  // 패널티/기타
  sleepPenaltyCount?: number;
  latePenaltyCount?: number;     // ✅ 새 이름
  latepenaltyCount?: number;     // 🟡 레거시(코드 다 바꾸면 삭제)
  shortBreakCount?: number;
  shortBreakMin?: number;
  focusScore?: number;

  // 과거 오타는 제거 권장(필요시만 임시로 유지)
  // addSleepPenalty?: number;
  // addSllatePenalty?: number;

  // 개인시간표 적용 여부
  scheduleAppliedDate?: string;
}

export type TaskItem = { id: string; title: string; done?: boolean; note?: string };

export type Student = {
  id: string;
  name: string;
  grade?: string;
  school?: string;
  gradeLevel?: string;
    groupId?: string; // ✅ 추가 — 그룹 ID
  studentPhone?: string;
  parentPhone?: string;
  removed?: boolean;
  personalSchedule?: {
  current: Partial<Record<AcademyType, WeeklyTime>>;
  next?: {
    effectiveDate: string;
    data: Partial<Record<AcademyType, WeeklyTime>>;
  };
};
  koreanScore?: number;
  englishScore?: number;
  mathScore?: number;
  scienceScore?: number;
};

export type Records = Record<string, Record<string, DayCell>>;
export type Group = { id: string; name: string; students: Student[] };

export type StoreShape = {
  groups: Group[];
  currentGroupId: string | null;
  records: Records;
  students?: Student[]; // ✅ 이 줄을 추가하세요!
};



const STATUS: Record<StatusKey, { label: string; short: string }> = {
  P: { label: "출석", short: "출" },
  L: { label: "지각", short: "지" },
  A: { label: "결석", short: "결" },
  E: { label: "조퇴", short: "조" },
};



const sectionBox: React.CSSProperties = {
  background: "#fff",
  border: "2px solid #E5E7EB",
  borderRadius: 15,
  padding: 16,
  boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  minHeight: 420,
  boxSizing: "border-box",
  overflow: "hidden",        // ✅ 내용이 넘칠 경우 깔끔히 자름
};

const sectionHeader: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 14,
  color: "#1E3A8A",
  marginBottom: 8,
  letterSpacing: ".5px",
};

// 합계 분 계산 시 slots 우선, 레거시 from/to 있으면 포함
const getSubjectSumMin = (cell: DayCell | undefined, sub: AcademyType) => {
  if (!cell) return 0;
  const entry = cell.academyBySubject?.[sub];
  const slots = (entry?.slots || []) as TimeSlot[];
  let sum = slots.reduce((acc, sl) => acc + spanMin(sl.from, sl.to), 0);
  if (entry?.from || entry?.to) sum += spanMin(entry.from, entry.to);
  return sum;
};


if (!localStorage.getItem("access")) {
  const pass = prompt("🔒 비밀번호를 입력하세요:");
  if (pass !== "77777") {
    alert("비밀번호가 틀렸습니다.");
    window.location.href = "https://google.com";
  } else {
    localStorage.setItem("access", "ok");
  }
}



/** ================= 날짜/시간 유틸 ================= */
const pad2 = (n: number) => String(n).padStart(2, "0");
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => toYMD(new Date());
const fmtDate = (d: Date) => toYMD(d);
const nextDateStr = (ds: string) => {
  const d = new Date(ds);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
};
const nowHM = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const uid = () => Math.random().toString(36).slice(2, 10);

/** 월 범위 */
function monthRange(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = d.getMonth();
  return {
    start: fmtDate(new Date(y, m, 1)),
    end: fmtDate(new Date(y, m + 1, 0)),
  };
}

/** ================= 대한민국 공휴일 유틸 (2024~2029 + 간단 대체공휴일) ================= */
// 날짜 키
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

type HolidayMap = Record<string, string>;  // "YYYY-MM-DD" -> 이름
const HOLIDAY_CACHE: Record<number, HolidayMap> = {};

/** 고정 공휴일 */
const FIXED_HOLIDAYS: Array<{ m: number; d: number; name: string }> = [
  { m:1, d:1, name:"신정" },
  { m:3, d:1, name:"삼일절" },
  { m:5, d:5, name:"어린이날" },
  { m:6, d:6, name:"현충일" },
  { m:8, d:15, name:"광복절" },
  { m:10, d:3, name:"개천절" },
  { m:10, d:9, name:"한글날" },
  { m:12, d:25, name:"크리스마스" },
];

/** 음력 기반(연도별 실제 양력 날짜 매핑) — 간단 테이블 (필요 연도만 확장 가능) */
const LUNAR_SOLAR_TABLE: Record<number, Array<{ m:number; d:number; name:string }>> = {
  // 설연휴/석가탄신일/추석연휴(대체 포함 날짜들 일부 포함)
  2024: [
    { m:2, d:9, name:"설연휴" }, { m:2, d:10, name:"설날" }, { m:2, d:12, name:"설연휴" },
    { m:5, d:15, name:"석가탄신일" },
    { m:9, d:16, name:"추석연휴" }, { m:9, d:17, name:"추석" }, { m:9, d:18, name:"추석연휴" },
  ],
  2025: [
    { m:1, d:27, name:"설연휴" }, { m:1, d:28, name:"설날" }, { m:1, d:29, name:"설연휴" },
    { m:5, d:5,  name:"석가탄신일" },
    { m:10, d:5, name:"추석연휴" }, { m:10, d:6, name:"추석" }, { m:10, d:7, name:"추석연휴" },
  ],
  2026: [
    { m:2, d:16, name:"설연휴" }, { m:2, d:17, name:"설날" }, { m:2, d:18, name:"설연휴" },
    { m:5, d:24, name:"석가탄신일" },
    { m:10, d:4, name:"추석연휴" }, { m:10, d:5, name:"추석" }, { m:10, d:6, name:"추석연휴" },
  ],
  2027: [
    { m:2, d:6, name:"설연휴" }, { m:2, d:7, name:"설날" }, { m:2, d:8, name:"설연휴" },
    { m:5, d:13, name:"석가탄신일" },
    { m:9, d:25, name:"추석연휴" }, { m:9, d:26, name:"추석" }, { m:9, d:27, name:"추석연휴" },
  ],
  2028: [
    { m:1, d:26, name:"설연휴" }, { m:1, d:27, name:"설날" }, { m:1, d:28, name:"설연휴" },
    { m:5, d:2,  name:"석가탄신일" },
    { m:9, d:13, name:"추석연휴" }, { m:9, d:14, name:"추석" }, { m:9, d:15, name:"추석연휴" },
  ],
  2029: [
    { m:2, d:12, name:"설연휴" }, { m:2, d:13, name:"설날" }, { m:2, d:14, name:"설연휴" },
    { m:5, d:20, name:"석가탄신일" },
    { m:9, d:30, name:"추석연휴" }, { m:10, d:1, name:"추석" }, { m:10, d:2, name:"추석연휴" },
  ],
};

/** 간단 대체공휴일 규칙: 공휴일이 일요일이면 다음 월요일을 '대체공휴일'로 추가 */
function withSubstituteSunday(y: number, map: HolidayMap) {
  const add = (dt: Date, label: string) => {
    map[fmtDate(dt)] = label;
  };
  Object.entries({ ...map }).forEach(([ds, name]) => {
    const d = new Date(ds);
    if (d.getDay() === 0) { // Sunday
      const mon = new Date(d); mon.setDate(d.getDate() + 1);
      // 기존에 다른 휴일과 겹치면 그대로 두고, 비어있으면 대체 추가
      if (!map[fmtDate(mon)]) add(mon, `${name} 대체공휴일`);
    }
  });
}

/** 연도별 공휴일 맵(캐시) */
function getKoreanHolidayMap(year: number): HolidayMap {
  if (HOLIDAY_CACHE[year]) return HOLIDAY_CACHE[year];
  const map: HolidayMap = {};

  // 고정일
  FIXED_HOLIDAYS.forEach(({ m, d, name }) => { map[ymd(year, m, d)] = name; });

  // 음력 기반(사전 매핑)
  (LUNAR_SOLAR_TABLE[year] || []).forEach(({ m, d, name }) => {
    map[ymd(year, m, d)] = name;
  });

  // 간단 대체공휴일
  withSubstituteSunday(year, map);

  HOLIDAY_CACHE[year] = map;
  return map;
}

/** 헬퍼: 공휴일 여부/이름 */
function isHoliday(dateStr: string): boolean {
  const y = new Date(dateStr).getFullYear();
  return !!getKoreanHolidayMap(y)[dateStr];
}
function holidayName(dateStr: string): string | undefined {
  const y = new Date(dateStr).getFullYear();
  return getKoreanHolidayMap(y)[dateStr];
}

type AssignmentStatus = "todo" | "done";
type AssignmentFS = {
  id: string;
  studentId: string;
  groupId: string;
  title: string;
  status: AssignmentStatus;
  dateStr: string;          // YYYY-MM-DD (오늘 기준 조회용)
  createdAt?: any;
  updatedAt?: any;
};



type DonutSeg = { label: string; value: number; color: string };

function Donut({ size=120, stroke=18, segments }: { size?: number; stroke?: number; segments: DonutSeg[] }) {
  const total = Math.max(1, segments.reduce((a, s) => a + Math.max(0, s.value), 0));
  const C = size;
  const R = (size - stroke) / 2;
  const center = C / 2;
  const circumference = 2 * Math.PI * R;

  let acc = 0;
  const arcs = segments.map((seg, i) => {
    const val = Math.max(0, seg.value);
    const ratio = val / total;
    const dash = ratio * circumference;
    const gap = circumference - dash;
    const rotate = (acc / total) * 360 - 90; // -90: 12시부터 시작
    acc += val;
    return { ...seg, dash, gap, rotate };
  });

  return (
    <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:10, alignItems:"center" }}>
      <svg width={C} height={C} viewBox={`0 0 ${C} ${C}`}>
        {/* 바닥 원(연한 회색) */}
        <circle cx={center} cy={center} r={R} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
        {/* 세그먼트 */}
        {arcs.map((a, idx) => (
          <circle
            key={idx}
            cx={center}
            cy={center}
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={stroke}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeLinecap="butt"
            transform={`rotate(${a.rotate} ${center} ${center})`}
          />
        ))}
        {/* 가운데 구멍(텍스트 자리 시각적 정리용) */}
        <circle cx={center} cy={center} r={R - stroke/2 - 2} fill="#fff" />
      </svg>

      {/* 범례 */}
      <div style={{ display:"grid", gap:6, fontSize:12, alignSelf:"center" }}>
        {segments.map((s) => {
          const pct = Math.round((s.value / total) * 100);
          return (
            <div key={s.label} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ width:10, height:10, borderRadius:2, background:s.color, display:"inline-block" }} />
              <span style={{ color:"#374151" }}>{s.label}</span>
              <span style={{ marginLeft:"auto", color:"#6b7280" }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** ================= 저장/로드 ================= */
const STORAGE_KEY = "attendance_app_store_v4_subject_split";
function migrateToV4(raw?: string): StoreShape | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoreShape;
    return parsed;
  } catch {
    return null;
  }
}
function loadStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateToV4(raw)!;

    const v3 = localStorage.getItem("attendance_app_store_v3_groups_profile_time");
    if (v3) {
      const s = migrateToV4(v3);
      if (s) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        return s;
      }
    }

    const v2 = localStorage.getItem("attendance_app_store_v2_time");
    if (v2) {
      const p = JSON.parse(v2) as {
        className: string;
        students: Student[];
        records: Records;
      };
      const g: Group = {
        id: uid(),
        name: p.className || "우리반",
        students: p.students || [],
      };
      const s: StoreShape = {
        groups: [g],
        currentGroupId: g.id,
        records: p.records || {},
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      return s;
    }

    const g0: Group = { id: "default", name: "우리반", students: [] };
const init: StoreShape = {
  groups: [g0],
  currentGroupId: "default",
  records: {},
};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(init));
    return init;
  } catch {
  const g0: Group = { id: "default", name: "우리반", students: [] };
  const init: StoreShape = {
    groups: [g0],
    currentGroupId: "default",
    records: {},
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(init));
  return init;
}
}
function saveStore(s: StoreShape) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}




/** ================= 메인 앱 ================= */
export default function App() {

const [academySchedule, setAcademySchedule] = useState<Record<string, { start: string; end: string }[]>>({});

const [attendanceList, setAttendanceList] = useState<any[]>([]);



async function handleCheckIn(studentName: string) {
  try {
    await addDoc(collection(db, "attendance"), {
      name: studentName,
      status: "출석",
      time: serverTimestamp(),
    });
    console.log("✅ Firestore에 등원 저장:", studentName);
  } catch (e) {
    console.error("❌ Firestore 저장 실패:", e);
  }
}
async function handleCheckOut(name: string) {
  try {
    await addDoc(collection(db, "attendance"), {
      name: name,
      status: "하원",
      time: serverTimestamp(),
    });
    console.log("✅ Firestore에 하원 저장됨:", name);
  } catch (e) {
    console.error("❌ Firestore 하원 저장 실패:", e);
  }
}
async function saveStudentToFS(groupId: string, s: any) {
  try {
    // undefined 값 제거 (Firestore는 undefined 허용 안 함)
    const safeData = Object.fromEntries(
      Object.entries(s).filter(([_, v]) => v !== undefined && v !== "")
    );

    await setDoc(
  doc(db, "students", s.id),
  {
    id: s.id,
    name: s.name || "",
    grade: s.grade || "",
    school: s.school || "",
    studentPhone: s.studentPhone || "",
    parentPhone: s.parentPhone || "",
    groupId: groupId || "default",
    removed: false,
    createdAt: serverTimestamp(),
  },
  { merge: true }
);

    console.log("✅ Firestore에 학생 저장 완료:", s.name || "(이름 없음)");
  } catch (e) {
    console.error("❌ Firestore 학생 저장 실패:", e);
  }
}

// 새 과제 생성(아이디가 이미 있으면 upsert로 동작)
async function upsertAssignmentFS(a: AssignmentFS) {
  const payload = sanitize({ ...a, createdAt: a.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp() });
  await setDoc(doc(db, "assignments", a.id), payload, { merge: true });
  console.log("✅ 과제 저장/업데이트:", a.title, a.status);
}

async function toggleAssignmentFS(id: string, next: AssignmentStatus) {
  await setDoc(doc(db, "assignments", id), sanitize({ status: next, updatedAt: serverTimestamp() }), { merge: true });
}

async function renameAssignmentFS(id: string, newTitle: string) {
  await setDoc(doc(db, "assignments", id), sanitize({ title: newTitle, updatedAt: serverTimestamp() }), { merge: true });
}

async function deleteAssignmentFS(id: string) {
  await deleteDoc(doc(db, "assignments", id));
}
const [assignments, setAssignments] = useState<AssignmentFS[]>([]);
const today = useMemo(() => todayStr(), []);



// ✅ 빈 값(undefined, "") 필드 제거 유틸
const sanitize = (obj: any) =>
  Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined && v !== ""));

  useEffect(() => {
    if (typeof window === "undefined") return;

    const KEY = "access_until_v1"; // 저장키(12시간 유지)
    const until = Number(localStorage.getItem(KEY) || 0);
    if (Number.isFinite(until) && until > Date.now()) return; // 유효기간 남으면 통과

    const pass = window.prompt("🔒 비밀번호를 입력하세요:") ?? ""; // null 방지
    if (pass.trim() === "77777") {
      const EXPIRE_MS = 12 * 60 * 60 * 1000;
      localStorage.setItem(KEY, String(Date.now() + EXPIRE_MS));
      return; // 통과
    }

    // ❌ 틀리거나 빈 입력이면: 리다이렉트하지 말고 경고만
    window.alert("비밀번호가 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
    // 원하면 여기서 아무 것도 안 하고, 사용자가 새로고침해서 다시 시도하게 둡니다.
  }, []);



 const [store, setStore] = useState<StoreShape>(() => loadStore());

// ✅ 스토어 기본 그룹 아이디 보장
if (!store.currentGroupId) {
  store.currentGroupId = "default";
}
console.log("📦 현재 그룹 ID:", store.currentGroupId);

// ✅ Firestore 실시간 학생 반영 (완전 안정 버전)
useEffect(() => {
  const groupId = store.currentGroupId || "default";

  const q = query(
    collection(db, "students"),
    where("groupId", "==", groupId) // ✅ 현재 그룹 필터 적용
  );

  const unsub = onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name || "",
          grade: data.grade || "",
          school: data.school || "",
          studentPhone: data.studentPhone || "",
          parentPhone: data.parentPhone || "",
          groupId: data.groupId || "default",
          removed: !!data.removed,
        };
      });

      console.log("🔥 Firestore 실시간 학생 데이터:", list.length, list);

      setStore((prev) => {
        // ✅ 기존 그룹 유지, 없으면 기본 생성
        const baseGroups =
          prev.groups?.length > 0
            ? prev.groups
            : [{ id: "default", name: "우리반", students: [] }];

        // ✅ 그룹별 학생 매칭
        const groups = baseGroups.map((g) => ({
          ...g,
          students: list.filter(
            (s) => (s.groupId || "default") === g.id && !s.removed
          ),
        }));

        const currentGroupId = prev.currentGroupId ?? groups[0].id;

        return {
          ...prev,
          groups,
          currentGroupId,
          students: list,
        };
      });
    },
    (err) => console.error("❌ Firestore 실시간 구독 오류:", err)
  );

  return () => unsub();
}, [store.currentGroupId]); // ✅ 그룹 바뀔 때마다 새로 구독

// 학생 추가 함수 (공유용)
const addStudent = async () => {
  const student: Student = {
    id: uid(),
    name: (newStu.name || "").trim(),
    grade: (newStu.grade || "").trim(),
    school: (newStu.school || "").trim(),
    studentPhone: (newStu.studentPhone || "").trim(),
    parentPhone: (newStu.parentPhone || "").trim(),
    groupId: store.currentGroupId || "default", 
    
  // ✅ ← 여기 중요!!
    removed: false, // ✅ 기본값
  };

  try {
  const groupId = store.currentGroupId || "default"; // ✅ 미리 변수 저장
  console.log("📦 현재 그룹 ID:", groupId);

    // 1️⃣ 로컬에 즉시 반영 (UI 업데이트)
    setStore((prev) => ({
      ...prev,
      students: [...(prev.students || []), student],
    }));

    await setDoc(
  doc(db, "students", student.id),
  {
    ...student,
    groupId: store.currentGroupId || "default", // ✅ 추가
    createdAt: serverTimestamp(),
  },
  { merge: true }
);

    console.log("✅ Firestore 저장 완료:", student.name);
    alert(`${student.name} 학생이 등록되었습니다.`);

    // 3️⃣ 입력칸 초기화
    setNewStu({
      name: "",
      grade: "",
      school: "",
      studentPhone: "",
      parentPhone: "",
    });
  } catch (err) {
    console.error("❌ Firestore 저장 실패:", err);
  }
};

  const [date, setDate] = useState<string>(() => todayStr());
  const [editStudent, setEditStudent] = useState<string | null>(null);
  const [focusStatus, setFocusStatus] = useState<StatusKey | null>(null);
  const [bulkTitle, setBulkTitle] = useState("");
  const [bulkGrade, setBulkGrade] = useState<string>(""); 
  const [bulkSchool, setBulkSchool] = useState<string>("");


const applyPersonalScheduleForDate = (sid: string, ds: string) => {
  setStore((prev) => {
    const records = { ...prev.records };
    const d0 = { ...(records[ds] || {}) };

    let cell: DayCell = { ...(d0[sid] ?? { status: "P" }) };
   
    // 현재 그룹에서 학생 찾기
    const groupId = prev.currentGroupId ?? prev.groups[0]?.id;
    const st = prev.groups
      .find((g) => g.id === groupId)
      ?.students.find((s) => s.id === sid);

    // ✅ personalSchedule에서 current/next 분기
    const sched = st?.personalSchedule;
let personal: Partial<Record<AcademyType, WeeklyTime>> = {};

// ✅ old/new 구조 모두 호환
if (sched) {
  const s = sched as any;
  if (s.next && new Date() >= new Date(s.next.effectiveDate)) {
    personal = s.next.data || {};
  } else if (s.current) {
    personal = s.current;
  } else {
    // 옛날 구조 (current, next 없이 바로 slots가 들어있는 경우)
    personal = s;
  }
}
    const dow = new Date(ds).getDay();

    // 기존 데이터 복사
    const abs: Partial<Record<AcademyType, SubjectEntry>> = {
      ...(cell.academyBySubject || {}),
    };
    const enabled = new Set(cell.enabledSubjects || []);

    // 🎯 개인시간표 기준 병합 (요일 필터 + 중복 제거)
    (Object.keys(personal) as AcademyType[]).forEach((sub) => {
      const wt = personal[sub];
      if (!wt) return;

      // 오늘 요일에 해당 슬롯이 없으면 스킵
      if (!wt.slots || !wt.slots.some((slot) => slot.day === dow)) return;

      enabled.add(sub);

      // 기존 과목 엔트리
      const entry: SubjectEntry = (abs[sub] ?? {}) as SubjectEntry;
      const prevSlots: TimeSlot[] = Array.isArray(entry.slots)
        ? [...entry.slots]
        : [];

      // 오늘 해당 요일 슬롯만 추출
      const todaySlots =
        wt.slots?.filter((slot) => slot.day === dow) ?? [];

      // 중복 제거 후 병합
      const merged = [
        ...prevSlots,
        ...todaySlots.filter(
          (slot) =>
            !prevSlots.some(
              (s) =>
                s.day === slot.day &&
                s.from === slot.from &&
                s.to === slot.to
            )
        ),
      ];

      // 최종 반영
      abs[sub] = { ...entry, slots: merged };
    });

    // ✅ 최종 셀 업데이트
    cell = {
      ...cell,
      enabledSubjects: Array.from(enabled),
      academyBySubject: abs,
      scheduleAppliedDate: ds,
    };

    // ✅ records 갱신
    d0[sid] = cell;
    records[ds] = d0;
    return { ...prev, records };
  });
}; 
  // ✅ 순공 실시간 갱신 (5초마다)
  const [liveTick, setLiveTick] = useState(0);




  // ✅ 관리자 모드 상태 및 함수
  const [isAdmin, setIsAdmin] = useState<boolean>(() => localStorage.getItem("is_admin") === "1");
  useEffect(() => saveStore(store), [store]);

  const enterAdmin = () => {
    const saved = localStorage.getItem("admin_pin") || "1234"; // 기본 PIN
    const pin = prompt("관리자 PIN을 입력하세요 (기본: 1234)");
    if (!pin) return;
    if (pin === saved) {
      setIsAdmin(true);
      localStorage.setItem("is_admin", "1");
      alert("✅ 관리자 모드 ON");
    } else {
      alert("❌ PIN이 올바르지 않습니다.");
    }
  };

  const exitAdmin = () => {
    setIsAdmin(false);
    localStorage.removeItem("is_admin");
    alert("🔒 관리자 모드 OFF");
  };

  const changeAdminPin = () => {
    if (!isAdmin) return alert("관리자 모드에서만 변경할 수 있습니다.");
    const np = prompt("새 PIN(숫자 4자리 권장)");
    if (!np) return;
    localStorage.setItem("admin_pin", np);
    alert("🔑 PIN이 변경되었습니다.");
  };

  // 토글들
  const [showContact, setShowContact] = useState<Record<string, boolean>>({});
  const [showDetail, setShowDetail] = useState<Record<string, boolean>>({});
  const [statusPickerFor, setStatusPickerFor] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  // 현재 그룹
  // ✅ 현재 그룹 (메인)
const currentGroup = useMemo(
  () =>
    store.groups.find((g) => g.id === store.currentGroupId) ||
    store.groups[0] ||
    { students: [] },
  [store.groups, store.currentGroupId]
);

// ✅ 과제 실시간 수신
useEffect(() => {
  if (!currentGroup) return;
  const q = query(
    collection(db, "assignments"),
    where("groupId", "==", currentGroup.id),
    where("dateStr", "==", today),
    orderBy("createdAt", "desc")
  );

  const unsub = onSnapshot(
    q,
    (snap) => {
      const list: AssignmentFS[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as any) }));
      setAssignments(list);
      console.log("📡 과제 실시간 수신:", list.length);
    },
    (err) => console.error("❌ 과제 구독 오류:", err)
  );

  return () => unsub();
}, [currentGroup?.id, today]);

// ✅ 현재 그룹 학생 목록
const students = useMemo(() => {
  const list = currentGroup?.students ? [...currentGroup.students] : [];

  return list.sort((a, b) => {
    const g1 = parseInt(a.grade?.replace(/[^0-9]/g, "") || "0");
    const g2 = parseInt(b.grade?.replace(/[^0-9]/g, "") || "0");

    if (g1 !== g2) return g2 - g1; // 고학년 → 저학년
    return (a.name || "").localeCompare(b.name || "", "ko"); // 가나다순
  });
}, [currentGroup]);

// ✅ 학년 목록 생성
const uniqueGrades = useMemo(() => {
  const grades = new Set(students.map((s) => s.grade).filter(Boolean));
  return Array.from(grades).sort((a, b) => {
    const numA = parseInt((a ?? "0").replace(/[^0-9]/g, ""));
    const numB = parseInt((b ?? "0").replace(/[^0-9]/g, ""));
    return numB - numA;
  });
}, [students]);

// ✅ 개인 시간표 적용
useEffect(() => {
  const studentList = currentGroup?.students || [];
  studentList.forEach((student: any) => {
    applyPersonalScheduleForDate(student.id, date);
  });
}, [date, currentGroup]);

// ✅ 학교 목록 생성
const uniqueSchools = useMemo(() => {
  const studentList = currentGroup?.students || [];
  const schools = new Set(studentList.map((s: any) => s.school).filter(Boolean));
  return Array.from(schools).sort();
}, [currentGroup]);

  // PWA(로컬용)
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(()=>{});
      });
    }
  }, []);

  // 신규 학생 입력
  const [newStu, setNewStu] = useState<Partial<Student>>({
    name: "", grade: "", school: "", studentPhone: "", parentPhone: ""
  });

  // 저장
  useEffect(()=>saveStore(store), [store]);

  // 오늘 레코드
  const day = useMemo<Record<string, DayCell>>(
    () => store.records[date] || {}, [store.records, date]
  );
  const ensureCell = (sid: string): DayCell => day[sid] ?? { status: "P" };

  /** ===== 출결/시간 ===== */
  const setStatus = (sid: string, st: StatusKey) => {
    setStore(prev => {
      const records = { ...prev.records };
      const d0 = { ...(records[date] || {}) };
      const next: DayCell = { ...ensureCell(sid), status: st };
      if ((st === "P" || st === "L") && !next.time) next.time = nowHM();
      if (st === "A") { next.time = undefined; next.outTime = undefined; }
      d0[sid] = next; records[date] = d0; return { ...prev, records };
    });
  };
  const setTime = (sid: string, time: string) => {
    setStore(prev => {
      const records = { ...prev.records };
      const d0 = { ...(records[date] || {}) };
      const next: DayCell = { ...ensureCell(sid), time: time || undefined };
      d0[sid] = next; records[date] = d0; return { ...prev, records };
    });
  };
  const setTimeNow = (sid: string) => setTime(sid, nowHM());
  const setOutTime = (sid: string, out: string) => {
    setStore(prev => {
      const records = { ...prev.records };
      const d0 = { ...(records[date] || {}) };
      const next: DayCell = { ...ensureCell(sid), outTime: out || undefined };
      d0[sid] = next; records[date] = d0; return { ...prev, records };
    });
  };
  const setOutTimeNow = (sid: string) => setOutTime(sid, nowHM());


  /** ===== 과목 토글/시간 ===== */
  const toggleSubject = (sid: string, sub: AcademyType) => {
    setStore(prev => {
      const records = { ...prev.records };
      const d0 = { ...(records[date] || {}) };
      const base = ensureCell(sid);

      const enabled = new Set(base.enabledSubjects || []);
      if (enabled.has(sub)) enabled.delete(sub);
      else enabled.add(sub);

      d0[sid] = { ...base, enabledSubjects: Array.from(enabled) };
      records[date] = d0;
      return { ...prev, records };
    });
  };

  const setAcademyTime = (sid: string, subject: AcademyType, which: "from" | "to", v: string) => {
    setStore(prev => {
      const records = { ...prev.records };
      const d0 = { ...(records[date] || {}) };
      const base = ensureCell(sid);
  
      // ✅ abs 선언 추가
      const abs: Partial<Record<AcademyType, SubjectEntry>> = {
        ...(base.academyBySubject || {})
      };
  
      // ✅ 현재 과목 엔트리 수정
      const cur: SubjectEntry = { ...(abs[subject] || {}) };
      cur[which] = v || undefined;
  
      abs[subject] = cur;
  
      d0[sid] = { ...base, academyBySubject: abs };
      records[date] = d0;
      return { ...prev, records };
    });
  };

  // ⛏️ 과목 시간 X 버튼: 시간이 있으면 초기화, 이미 비었으면 토글 해제
  const smartClearOrDisable = (sid: string, subject: AcademyType) => {
    setStore(prev => {
      const records = { ...prev.records };
      const d0 = { ...(records[date] || {}) };
      const base = ensureCell(sid);
  
      // ✅ abs 선언 추가
      const abs: Partial<Record<AcademyType, SubjectEntry>> = {
        ...(base.academyBySubject || {})
      };
  
      const cur: SubjectEntry = abs[subject] || {};
      const hasTime = !!(cur.from || cur.to);
  
      if (hasTime) {
        abs[subject] = { ...cur, from: undefined, to: undefined };
        d0[sid] = { ...base, academyBySubject: abs };
      } else {
        const enabled = new Set(base.enabledSubjects || []);
        enabled.delete(subject);
        abs[subject] = { ...cur, from: undefined, to: undefined };
        d0[sid] = { ...base, enabledSubjects: Array.from(enabled), academyBySubject: abs };
      }
  
      records[date] = d0;
      return { ...prev, records };
    });
  };


  const carryOverIncompleteTasks = (sid: string, fromDate: string) => {
    setStore(prev => {
      const records = { ...prev.records };
      const from = { ...(records[fromDate] || {}) };
      const cellFrom: DayCell = { ...(from[sid] ?? { status:"P" }) };
  
      const remain = (cellFrom.tasks || []).filter(t => !t.done);
      if (remain.length === 0) return prev;
  
      const toDate = nextDateStr(fromDate);
      const toDay  = { ...(records[toDate] || {}) };
      const cellTo: DayCell = { ...(toDay[sid] ?? { status:"P" }) };
  
      const existed = cellTo.tasks || [];
      cellTo.tasks = [...existed, ...remain.map(t => ({ ...t, done:false }))];
  
      toDay[sid] = cellTo;
      records[toDate] = toDay;
      return { ...prev, records };
    });
    alert("⏭️ 미완료 과제를 내일로 이월했습니다.");
  };
  const addTask = (sid: string, ds: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    setStore(prev => {
      const records = { ...prev.records };
      const dayRec  = { ...(records[ds] || {}) };
      const cell: DayCell = { ...(dayRec[sid] ?? { status:"P" }) };
      const tasks = [...(cell.tasks || []), { id: uid(), title: t }];
      dayRec[sid] = { ...cell, tasks };
      records[ds]  = dayRec;
      return { ...prev, records };
    });
  };

  
  const toggleTask = (sid: string, ds: string, taskId: string) => {
    setStore(prev => {
      const records = { ...prev.records };
      const dayRec  = { ...(records[ds] || {}) };
      const cell: DayCell = { ...(dayRec[sid] ?? { status:"P" }) };
      const tasks = (cell.tasks || []).map(t => t.id===taskId ? { ...t, done: !t.done } : t);
      dayRec[sid] = { ...cell, tasks };
      records[ds]  = dayRec;
      return { ...prev, records };
    });
  };
  
  const removeTask = (sid: string, ds: string, taskId: string) => {
    setStore(prev => {
      const records = { ...prev.records };
      const dayRec  = { ...(records[ds] || {}) };
      const cell: DayCell = { ...(dayRec[sid] ?? { status:"P" }) };
      const tasks = (cell.tasks || []).filter(t => t.id !== taskId);
      dayRec[sid] = { ...cell, tasks };
      records[ds]  = dayRec;
      return { ...prev, records };
    });
  };
  
  const setTaskNote = (sid: string, ds: string, taskId: string, note: string) => {
    setStore(prev => {
      const records = { ...prev.records };
      const dayRec  = { ...(records[ds] || {}) };
      const cell: DayCell = { ...(dayRec[sid] ?? { status:"P" }) };
      const tasks = (cell.tasks || []).map(t => t.id===taskId ? { ...t, note: note || undefined } : t);
      dayRec[sid] = { ...cell, tasks };
      records[ds]  = dayRec;
      return { ...prev, records };
    });
  };
  const addTaskByFilter = (title: string, grade: string, school: string) => {
    const t = title.trim();
    if (!t) return;

    setStore(prev => {
        const records = { ...prev.records };
        const dayRec = { ...(records[date] || {}) };

        // 🎯 필터링된 학생 목록 생성
        const targetStudents = students.filter(st => {
            let match = true;
            if (grade && st.grade !== grade) match = false;
            if (school && st.school !== school) match = false;
            return match;
        });

        if (targetStudents.length === 0) {
            setTimeout(() => alert(`과제를 추가할 대상 학생이 없습니다. (조건: ${grade || '전체 학년'}, ${school || '전체 학교'})`), 0);
            return prev;
        }



        // 🎯 필터링된 학생들에게 과제 추가
        targetStudents.forEach(st => {
            const cell: DayCell = { ...(dayRec[st.id] ?? { status: "P" }) };

            const existingTitles = new Set((cell.tasks || []).map(task => task.title.trim().toLowerCase()));
            if (!existingTitles.has(t.toLowerCase())) {
                // uid()는 App 컴포넌트 외부에 정의된 고유 ID 생성 함수를 사용합니다.
                cell.tasks = [...(cell.tasks || []), { id: uid(), title: t }];
                dayRec[st.id] = cell;
            }
        });

        records[date] = dayRec;

        setTimeout(() => alert(`✅ ${title} 과제를 ${grade || '전체 학년'} / ${school || '전체 학교'} ${targetStudents.length}명에게 추가했습니다.`), 0);

        return { ...prev, records };
    });
    setBulkTitle(""); // 과제 추가 후 입력창 초기화
};
  // ----------------------------------------


  /** ===== 화장실/식사 (한 칸에 묶기) ===== */
  const setRestroomCount = (sid: string, count: number) => {
    const c = Math.max(0, Math.min(5, Math.floor(count)));
    setStore(prev => {
      const records = { ...prev.records }; const d0 = { ...(records[date] || {}) };
      const cell: DayCell = { ...(d0[sid] ?? { status: "P" }) };
      cell.restroomCount = c;
      cell.restroomMin = c * 7;
      d0[sid] = cell; records[date] = d0; return { ...prev, records };
    });
  };
  // 누를수록 0→1→…→5에서 멈추는 증가 버튼용
const incRestroom = (sid: string) => {
  setStore(prev => {
    const records = { ...prev.records };
    const d0 = { ...(records[date] || {}) };
    const cell: DayCell = { ...(d0[sid] ?? { status: "P" }) };

    const curr = cell.restroomCount || 0;
    const next = Math.min(5, curr + 1); // 최대 5회에서 멈춤

    cell.restroomCount = next;
    cell.restroomMin = next * 7; // 총 적용분(회당 7분 × 횟수)

    d0[sid] = cell; records[date] = d0;
    return { ...prev, records };
  });
};
   /** ===== 수면 패널티 ===== */
   const addSleepPenalty = (sid: string, delta = 1) => {
    setStore(prev => {
      const records = { ...prev.records };
      const d0 = { ...(records[date] || {}) };
      const cell: DayCell = { ...(d0[sid] ?? { status: "P" }) };

      // 누를 때마다 +1
      cell.sleepPenaltyCount = (cell.sleepPenaltyCount || 0) + Math.max(1, delta);

      d0[sid] = cell;
      records[date] = d0;
      return { ...prev, records };
    });
  };


  const addMealMinutes = (sid: string, minutes: number) => {
    const mm = Math.max(0, Math.floor(minutes) || 0);
    if (!mm) return;
    setStore(prev => {
      const records = { ...prev.records }; const d0 = { ...(records[date] || {}) };
      const cell: DayCell = { ...(d0[sid] ?? { status: "P" }) };
      cell.mealMin = (cell.mealMin || 0) + mm;
      d0[sid] = cell; records[date] = d0; return { ...prev, records };
    });
  };
  // ⏳ 식사시간 빼기 (감소)
   const subtractMealMinutes = (sid: string, minutes: number) => {
     const mm = Math.max(0, Math.floor(minutes) || 0);
     if (!mm) return;
  setStore(prev => {
    const records = { ...prev.records };
    const d0 = { ...(records[date] || {}) };
    const cell: DayCell = { ...(d0[sid] ?? { status: "P" }) };
    const current = cell.mealMin || 0;
    cell.mealMin = Math.max(0, current - mm); // ✅ 음수 방지
    d0[sid] = cell;
    records[date] = d0;
    return { ...prev, records };
  });
};

  const resetMeal = (sid: string) => {
    setStore(prev => {
      const records = { ...prev.records }; const d0 = { ...(records[date] || {}) };
      const cell: DayCell = { ...(d0[sid] ?? { status: "P" }) };
      cell.mealMin = 0;
      d0[sid] = cell; records[date] = d0; return { ...prev, records };
    });
  };

  const setMemo = (sid: string, v: string) => {
    setStore(prev => {
      const records = { ...prev.records }; const d0 = { ...(records[date] || {}) };
      const cell: DayCell = { ...(d0[sid] ?? { status: "P" }) };
      cell.memo = v || undefined;
      d0[sid] = cell; records[date] = d0; return { ...prev, records };
    });
  };

  /** ===== 일일 리포트 (My Daily용) ===== */
const printDailyReport = (sid: string) => {
  const s = students.find(x => x.id === sid);
  const c = day[sid];
  const name = s?.name || "학생";
  const dt = date;

  const totalGross = (c?.time && (c.outTime || c.time))
    ? spanMin(c.time, c.outTime || nowHM())
    : 0;
  const restTotal = (c ? outingTotalMin(c) : 0) + (c?.shortBreakMin || 0);
  const running = !!(c?.time && !c?.outTime);
  const studyNow = running ? netStudyMinLive(c) : netStudyMin(c);

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.open();
  w.document.write(`
    <html><head><meta charset="utf-8"/>
      <title>${name} - ${dt} 일일 리포트</title>
      <style>
        body{font-family:system-ui,-apple-system,"Noto Sans KR",Arial;margin:24px}
        h1{margin:0 0 6px;font-size:18px}
        table{border-collapse:collapse;margin-top:12px;width:100%}
        td,th{border:1px solid #ddd;padding:8px;font-size:13px;text-align:left}
        .small{color:#6b7280;font-size:12px}
      </style>
    </head><body>
      <h1>📄 일일 리포트 — ${name}</h1>
      <div class="small">${dt}${running ? " (진행중)" : ""}</div>
      <table>
        <tr><th>등원</th><td>${c?.time || "-"}</td><th>하원</th><td>${c?.outTime || (running ? "진행중" : "-")}</td></tr>
        <tr><th>총 체류</th><td>${minToHM(totalGross)}</td><th>학원/식사/화장실</th><td>${minToHM(outingTotalMin(c))}</td></tr>
        <tr><th>순공</th><td><b>${minToHM(studyNow)}</b></td><th>메모</th><td>${c?.memo || "-"}</td></tr>
      </table>
      <script>window.print()</script>
    </body></html>
  `);
  w.document.close();
};


/** ===== 집계 유틸 ===== */
const subjectOutingMin = (c?: DayCell) => {
  if (!c) return 0;

  // ✅ 새 구조 (EditStudentModal 기반) 먼저 찾고, 없으면 예전 구조로 대체
  const subjects =
    (c as any).personalSchedule?.current ||
    c.academyBySubject ||
    c.academyFrom ||
    {};

  // ✅ "학교" 제외 (순공시간엔 포함되지 않음)
  const studySubjects = Object.entries(subjects).filter(
    ([sub]) => sub !== "학교"
  );

  let total = 0;
  studySubjects.forEach(([_, data]) => {
    const slots = (data as any)?.slots || [];
    slots.forEach((s: any) => {
      if (!s.from || !s.to) return;
      const [fh, fm] = s.from.split(":").map(Number);
      const [th, tm] = s.to.split(":").map(Number);
      total += th * 60 + tm - (fh * 60 + fm);
    });
  });

  return total;
};

  const outingTotalMin = (c?: DayCell) => {
  if (!c) return 0;

  // ✅ personalSchedule.current 도 읽기 (EditStudentModal 저장 반영용)
  const subjects =
    (c as any).personalSchedule?.current ||
    c.academyBySubject ||
    c.academyFrom ||
    {};

  // 🟡 학교 과목은 계산에서 제외
  const filtered = Object.entries(subjects).filter(([key]) => key !== "학교");

  const legacy = spanMin(c.academyFrom, c.academyTo);
  let total = 0;

  filtered.forEach(([_, data]: any) => {
    const slots = data?.slots || [];
    slots.forEach((s: any) => {
      if (!s.from || !s.to) return;
      const [fh, fm] = s.from.split(":").map(Number);
      const [th, tm] = s.to.split(":").map(Number);
      total += th * 60 + tm - (fh * 60 + fm);
    });
  });

  return total + legacy + (c.restroomMin || 0) + (c.mealMin || 0);
};

/** 순공(하원 후 기준) 계산: 등원~하원 사이 - 외출시간 */
const netStudyMin = (c?: DayCell) => {
  if (!c?.time) return 0; // 등원 전이면 0
  const excludeSubjects = ["학교", "기타"];
  let total = 0;
Object.entries(c.academyBySubject || {}).forEach(([sub, data]) => {
  if (excludeSubjects.includes(sub)) return; // 🚫 학교·기타 제외

  (data.slots || []).forEach((s) => {
    total += spanMin(s.from, s.to);
  });
});

  // 등원~하원 구간 전체(분)
  const start = hmToMin(c.time);
  const end = c.outTime ? hmToMin(c.outTime) : hmToMin(nowHM());
  const gross = Math.max(0, end - start);

  // 외출시간(학원·식사·화장실 등)
  const outing = outingTotalMin(c);

  // 순공 = 전체시간 - 외출시간
  return Math.max(0, gross - outing);
};

// 🔹 3. 현재 시각 계산
  const nowTotalMinutes = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };

  // 🔹 4. 주간 범위 계산
const getWeekRange = (dateStr: string) => {
  const d = new Date(dateStr);
  const dow = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dow + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: fmtDate(monday), end: fmtDate(sunday) };
};
  
  // ✅ 특정 기간 패널티 합계(개인 sid)
//   key로 "sleepPenaltyCount" 또는 "latePenaltyCount"를 넣어 사용.
//   (latePenaltyCount 오타(latepenaltyCount)도 자동 케어)
const sumPenaltyForRange = (
  studentId: string,
  start: string,
  end: string,
  key: "sleepPenaltyCount" | "latePenaltyCount" = "sleepPenaltyCount"
) => {
  let sum = 0;
  Object.entries(store.records).forEach(([ds, bySid]) => {
    if (ds >= start && ds <= end) {
      const c = bySid[studentId];
      if (!c) return;
      // 기본 키
      const v = (c as any)[key] as number | undefined;
      // latePenaltyCount를 latepenaltyCount로 저장한 경우(오타)도 커버
      const legacyLate =
        key === "latePenaltyCount" ? ((c as any).latepenaltyCount as number | undefined) : undefined;

      const add = (typeof v === "number" ? v : 0) + (typeof legacyLate === "number" ? legacyLate : 0);
      if (add) sum += add;
    }
  });
  return sum;
};

  /** 진행 중 순공(분) 계산: 하원 전이면 현재시각을 to로 보고 계산 */
  const netStudyMinLive = (c?: DayCell) => {
    if (!c?.time) return 0; // 등원 전이면 0
    let total = 0;
    const excludeSubjects = ["학교", "기타"];

Object.entries(c.academyBySubject || {}).forEach(([sub, data]) => {
  if (excludeSubjects.includes(sub)) return; // 🚫 학교·기타 제외

  (data.slots || []).forEach((s) => {
    total += spanMin(s.from, s.to);
  });
})
    const start = hmToMin(c.time);
    const end = c.outTime ? hmToMin(c.outTime) : nowTotalMinutes(); // 하원 미입력 시 현재 시각
    const gross = Math.max(0, end - start);
    const outing = outingTotalMin(c);
    return Math.max(0, gross - outing);
  };



// ===================== 🧩 updateStudent 함수 =====================
// ✅ 기존 updateStudent 함수 아래쪽 교체
const updateStudent = (sid: string, patch: Partial<Student>) => {
  try {
    const safe = sanitize({
      id: sid,
      groupId: currentGroup?.id,
      ...patch,
      updatedAt: serverTimestamp(),
    });

    // 🔹 Firestore 저장
    setDoc(doc(db, "students", sid), safe, { merge: true })
      .then(() => console.log("✅ Firestore 학생 업데이트 성공"))
      .catch((e) => console.error("❌ Firestore 학생 업데이트 실패:", e));
  } catch (e) {
    console.error("⚠️ Firestore 저장 중 오류:", e);
  }

  // 🔹 로컬 업데이트
  setStore((prev) => ({
    ...prev,
    groups: prev.groups.map((g) =>
      g.id === currentGroup?.id
        ? {
            ...g,
            students: g.students.map((s) => {
              if (s.id !== sid) return s;
              const nextSchedule = patch.personalSchedule
                ? patch.personalSchedule
                : s.personalSchedule;
              return { ...s, ...patch, personalSchedule: nextSchedule };
            }),
          }
        : g
    ),
  }));

  setEditStudent(null);

  // ✅ personalSchedule.next가 있으면 내일부터 자동 반영
  const sched = patch.personalSchedule as any;
  if (sched?.next?.data) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const ds = tomorrow.toISOString().split("T")[0];
    setTimeout(() => applyPersonalScheduleForDate(sid, ds), 100);
  }

  // ✅ 오늘 날짜도 강제 재적용 (반영 누락 방지)
  applyPersonalScheduleForDate(sid, date);
};


  const removeStudent = async (sid: string) => {
  if (!confirm("이 학생을 목록에서 숨기겠습니까? (기록은 유지됩니다)")) return;

  setStore(prev => {
    const groups = prev.groups.map(g =>
      g.id === currentGroup.id
        ? {
            ...g,
            students: g.students.map(s =>
              s.id === sid ? { ...s, removed: true } : s
            ),
          }
        : g
    );
    return { ...prev, groups };
  });

  // ✅ Firestore에도 removed 상태 반영
  try {
    const ref = doc(db, "students", sid);
    await setDoc(ref, { removed: true }, { merge: true });
    console.log(`🗑️ 학생 ${sid} 숨김 처리 완료`);
  } catch (err) {
    console.error("❌ Firestore 숨김 실패:", err);
  }
};

  const setAll = (st: StatusKey) => {
    setStore(prev => {
      const records = { ...prev.records };
      const d0 = { ...(records[date] || {}) };
      students.forEach(s => {
        const cell: DayCell = { ...(d0[s.id] ?? { status: st }), status: st };
        if ((st === "P" || st === "L") && !cell.time) cell.time = nowHM();
        if (st === "A") { cell.time = undefined; cell.outTime = undefined; }
        d0[s.id] = cell;
      });
      records[date] = d0;
      return { ...prev, records };
    });
  };

  /** 오늘/월 출결 합계 */
  const todayTotals = useMemo(() => {
    const c: Record<StatusKey, number> = { P: 0, L: 0, A: 0, E: 0 };
    Object.values(day).forEach(cell => c[cell.status] += 1);
    return c;
  }, [day]);
  const monthTotals = useMemo(() => {
    const r = monthRange(date);
    const totals: Record<StatusKey, number> = { P: 0, L: 0, A: 0, E: 0 };
    if (!r) return totals;
    Object.entries(store.records)
      .filter(([d]) => d >= r.start && d <= r.end)
      .forEach(([, bySid]) => Object.values(bySid).forEach(cell => totals[cell.status] += 1));
    return totals;
  }, [store.records, date]);

  /** 순공 합계(오늘/이달) */
  const netTodaySumMin = useMemo(() => students.reduce((acc, s) => acc + netStudyMin(day[s.id]), 0), [students, day]);
  const netMonthSumMin = useMemo(() => {
    const r = monthRange(date); if (!r) return 0;
    let total = 0;
    Object.entries(store.records)
      .filter(([d]) => d >= r.start && d <= r.end)
      .forEach(([, bySid]) => { students.forEach(s => { total += netStudyMin(bySid[s.id]); }); });
    return total;
  }, [store.records, date, students]);

  /** ===== 스타일 공용 ===== */
  const wrap: React.CSSProperties = { minHeight:"100vh", background:"#f5f7fb", color:"#111", padding:20 };
  const row: React.CSSProperties = { display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" };
  const inp: React.CSSProperties = { padding:"6px 8px", border:"1px solid #dde1ea", borderRadius:10, background:"#fff", fontSize:13 };
  const btn: React.CSSProperties = { padding:"6px 8px", border:"1px solid #dde1ea", borderRadius:10, background:"#fff", cursor:"pointer", fontSize:12 };
  const btnD: React.CSSProperties = { padding:"6px 8px", border:"1px solid #111", borderRadius:10, background:"#111", color:"#fff", cursor:"pointer", fontSize:12 };
  const chip = (active?: boolean): React.CSSProperties => ({
    padding:"5px 9px", borderRadius:999, border: active ? "1px solid #111" : "1px solid #e5e7eb",
    background: active ? "#111" : "#fff", color: active ? "#fff" : "#111", cursor:"pointer", fontSize:12,
    lineHeight:1
  });
  const statusMenuStyle: React.CSSProperties = { position: "absolute", top: "100%", left: 0, marginTop: 6,  border: "1px solid #e5e7eb",    background: "#fff",    borderRadius: 8, boxShadow: "0 10px 25px rgba(0,0,0,.08)", overflow: "hidden",  zIndex: 9999,    };
  
  const statusItemStyle: React.CSSProperties = {
    padding: "8px 12px",
    fontSize: 13,
    cursor: "pointer",
    borderBottom: "1px solid #f2f4f7",
    whiteSpace: "nowrap",
  };
  
  const btnXS: React.CSSProperties = {
    border: "1px solid #e5e7eb",
    background: "#fff",
    borderRadius: 6,
    padding: "0 6px",
    height: 24,
    lineHeight: "22px",
    fontSize: 11,
    cursor: "pointer",
  };
  const sectionTitle: React.CSSProperties = { textAlign: "center", fontWeight: 800, color: "#2563eb", fontSize: 14 };
  const timeInp: React.CSSProperties = {
    ...inp, width: 120, padding: "6px 8px", fontSize: 12,
    height: 34, lineHeight: "32px", fontVariantNumeric: "tabular-nums",
  };
  const SHOW_STUDENT_COUNT = false;

  // 실시간 시계
const [nowStr, setNowStr] = useState<string>("");
useEffect(() => {
  const fmt = (n:number)=>String(n).padStart(2,"0");
  const tick = () => {
    const d = new Date();
    setNowStr(`${fmt(d.getHours())}:${fmt(d.getMinutes())}:${fmt(d.getSeconds())}`);
  };
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}, []);

// 요일 한글
const dayName = (d: Date) => ["일","월","화","수","목","금","토"][d.getDay()];

// 보기 좋은 날짜 문자열 (YYYY.MM.DD (요일))
const prettyDate = (ds: string) => {
  const d = new Date(ds);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${y}.${m}.${dd} (${dayName(d)})`;
};



   // 작은 시계박스 //
   const timeInpTight: React.CSSProperties = {
    appearance: "none",
    outline: "none",
    padding: "6px 8px",
    border: "none", // 테두리 제거
    borderRadius: 8,
    background: "rgba(226, 232, 240, 0.6)", // 💡 연그레이(파스텔톤)
    fontSize: 13,
    height: 30,
    color: "#1f2937",
    textAlign: "center",
    width: 90,
    transition: "background 0.25s, box-shadow 0.25s",
    boxSizing: "border-box",
  };
  
  const timeInpTightHover: React.CSSProperties = {
    ...timeInpTight,
    background: "rgba(203, 213, 225, 0.8)", // hover 시 살짝 진해짐
    boxShadow: "0 0 0 2px rgba(147, 197, 253, 0.3)", // 은은한 블루광
  };

const timeInpTightFocus: React.CSSProperties = {
  ...timeInpTight,
  borderBottom: "1.5px solid #60a5fa", // 💡 파스텔 블루 밑줄 강조
  color: "#111827",
};
  /** ===== 학생별 달력 모달 제어 ===== */
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const selectedStudent = students.find(s => s.id === selectedStudentId) ?? null;

  return (
   
    <div className="app-main-container" style={{ minHeight: "100vh", background: "#f5f7fb", color: "#111", padding: 20 }}>
      {/* 전역 스타일: time 숫자 잘림 방지 */}
      <style>{`
        input[type="time"]{
          height: 34px; line-height: 32px; font-size:12px; box-sizing:border-box;
        }
        input[type="time"]::-webkit-datetime-edit { padding: 0 2px; }
        input[type="time"]::-webkit-date-and-time-value { min-width: 7.6ch; }
      `}</style>

     <div className="app-main-container"> 
    

        {/* 헤더 */}
        <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap" }}>

          <div>
            <img style={{ height: 40, objectFit: "contain" }} />
            <h1 style={{ fontSize:24, fontWeight:800, margin:0, letterSpacing:"0.5px" }}>
              <span style={{ color: "#b71c1c", fontSize: 30 }}>O</span>
              <span style={{ color: "#000000", fontSize: 20 }}>PTIMUM</span>
              <span style={{ color: "#1e3a8a", fontSize: 30 }}>E</span>
              <span style={{ color: "#000000", fontSize: 20 }}>DUCORE</span>
              <span style={{color:"#b71c1c", fontSize:16, fontStyle:"italic", margin:20}}> -YOU MAKE YOUR STUDY- </span>
            </h1>
          </div>

          

                       
            
{/* 깔끔한 날짜+시계 위젯 */}

<div style={{

display:"flex", gap:20, alignItems:"center", flexWrap:"wrap",

background:"linear-gradient(135deg,#EEF2FF,#E0E7FF)",

border:"1px solid #e5e7eb", borderRadius:14, padding:"10px 50px",

boxShadow:"0 2px 8px rgba(0,0,0,.04)", width: "100%", // ✅ 전체 가로폭 채움

}}>

{/* TODAY */}

<div style={{display:"flex", alignItems:"baseline", gap:8}}>

  <span style={{fontSize:10, fontWeight:900, color:"#6b7280", letterSpacing:".6px"}}>TODAY</span>

  <span style={{fontSize:16, fontWeight:900, color:"#111"}}>{prettyDate(date)}</span>

</div>



{/* 구분점 */}

<span style={{width:1, height:20, background:"#e5e7eb"}} />



{/* NOW */}

<div style={{display:"flex", alignItems:"baseline", gap:8}}>

  <span style={{fontSize:10, fontWeight:900, color:"#1e3a8a", letterSpacing:".6px"}}>NOW</span>

  <span style={{fontSize:18, fontWeight:900, color:"#1e3a8a", fontVariantNumeric:"tabular-nums"}}>{nowStr}</span>

</div>



{/* 우측 액션들 */}

<div style={{display:"flex", gap:8, marginLeft:"auto"}}>

  {/* 날짜 변경 (아이콘 느낌 버튼) */}

  <button

    style={{

      padding:"6px 10px", border:"1px solid #cbd5e1", borderRadius:10,

      background:"#fff", cursor:"pointer", fontSize:12, fontWeight:700

    }}

    onClick={(e)=>{

      // 숨겨둔 input[type="date"]를 programmatic으로 열기

      const picker = document.getElementById("date-hidden-picker") as HTMLInputElement | null;

      picker?.showPicker?.();

    }}

    title="날짜 선택"

  >

    📅 날짜변경

  </button>



<div style={row}>
            <select style={{ ...inp, width:150
             }} value={currentGroup?.id || ""} onChange={(e)=>setStore(prev=>({ ...prev, currentGroupId: e.target.value }))}>
              {store.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button style={btn} onClick={()=>{
              const name = prompt("새 그룹(반) 이름을 입력하세요", "새 반");
              if (!name) return;
              const g: Group = { id: uid(), name, students: [] };
              setStore(prev => ({ ...prev, groups: [...prev.groups, g], currentGroupId: g.id }));
            }}>+ 그룹 추가</button>
            <button style={btn} onClick={()=>{
              const name = prompt("그룹(반) 새 이름", currentGroup?.name || "");
              if (!name || !currentGroup) return;
              setStore(prev => ({ ...prev, groups: prev.groups.map(g => g.id === currentGroup.id ? { ...g, name } : g) }));
            }}>이름 변경</button>
            <button style={btn} onClick={()=>{
              if (!currentGroup) return;
              if (!confirm(`"${currentGroup.name}" 그룹을 삭제할까요? (학생/기록은 유지되지 않습니다)`)) return;
              setStore(prev => {
                const groups = prev.groups.filter(g => g.id !== currentGroup.id);
                const toRemove = new Set(currentGroup.students.map(s => s.id));
                const records: Records = {};
                Object.entries(prev.records).forEach(([d, bySid]) => {
                  const left: Record<string, DayCell> = {};
                  Object.entries(bySid).forEach(([sid, cell]) => { if (!toRemove.has(sid)) left[sid] = cell; });
                  records[d] = left;
                });
                return {
                  groups: groups.length ? groups : [{ id: uid(), name: "에듀중등등", students: [] }],
                  currentGroupId: groups.length ? groups[0].id : null,
                  records,
                };
              });
            }}>그룹 삭제</button>

  {/* 프린트 */}

  <button

    style={{

      padding:"6px 10px", border:"1px solid #1e3a8a", borderRadius:10,

      background:"#1e3a8a", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700

    }}

    onClick={()=>window.print()}

  >

    🖨️ 프린트

  </button>

  {/* ▼ 관리자 모드 컨트롤 */}
{!isAdmin ? (
  <button
    style={{
      ...btn,
      background: "#ffe4ec",   // 파스텔 핑크
      border: "1px solid #f9c2d1",
      color: "#b71c1c",
      fontWeight: 700,
    }}
    onClick={enterAdmin}
  >
    관리자 ON
  </button>
) : (
  <>
    <button
      style={{     ...btn,   background: "#ffe4ec",   border: "1px solid #f9c2d1",    color: "#b71c1c",     fontWeight: 700,
      }}
      onClick={exitAdmin}
    >
      관리자 OFF
    </button>

    <button
      style={{
        ...btn,
        background: "#fff0f5",
        border: "1px solid #f9c2d1",
        color: "#c2185b",
        fontWeight: 700,
      }}
      onClick={changeAdminPin}
    >
      PIN 변경
    </button>
  </>
)}

</div>



  {/* 화면에 보이지 않는 date input (showPicker로만 엶) */}
  <input
    id="date-hidden-picker"
    type="date"
    value={date}
    onChange={(e)=>setDate(e.target.value)}
    style={{ position:"absolute", opacity:0, pointerEvents:"none", width:0, height:0 }}
  />
</div>

          </div>
        </div>


    
          
       

        {/* 학생 추가 */}
        <div style={{ marginTop:16 }}>
       
          <div style={{ marginBottom: 8 }}>
  <button
    style={{
      ...btn,
      background: showRemoved ? "#b91c1c" : "#e5e7eb",
      color: showRemoved ? "#fff" : "#111",
      fontWeight: 700
    }}
    onClick={() => setShowRemoved(!showRemoved)}
  >
    {showRemoved ? "숨김 해제" : "숨김 학생 보기"}
  </button>
</div>


          

          <div style={{ display:"grid", gridTemplateColumns:"180px 100px 180px 160px 160px 100px", gap:8, marginBottom:8 }}>
            <input style={inp} placeholder="이름" value={newStu.name||""} onChange={(e)=>setNewStu(s=>({...s, name:e.target.value}))} onKeyDown={(e)=>e.key==="Enter"&&addStudent()} />
            <select style={inp} value={newStu.grade || ""} onChange={(e)=>setNewStu(s=>({ ...s, grade:e.target.value }))}>
              <option value="">학년 선택</option>
              <option value="중1">중1</option><option value="중2">중2</option><option value="중3">중3</option>
              <option value="고1">고1</option><option value="고2">고2</option><option value="고3">고3</option>
            </select>
            <input style={inp} placeholder="학교" value={newStu.school||""} onChange={(e)=>setNewStu(s=>({...s, school:e.target.value}))} />
            <input style={inp} placeholder="학생 연락처" value={newStu.studentPhone||""} onChange={(e)=>setNewStu(s=>({...s, studentPhone:e.target.value}))} />
            <input style={inp} placeholder="부모님 연락처" value={newStu.parentPhone||""} onChange={(e)=>setNewStu(s=>({...s, parentPhone:e.target.value}))} />
            <button style={btnD} onClick={addStudent}>추가</button>
            {/*<button style={btn} onClick={()=>csvInputRef.current?.click()}>CSV 불러오기</button>
<input ref={csvInputRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={onCSVFileChange} />
*/}
          </div>


          

          <div style={{ 
    padding: "20px", 
    background: "#fff", 
    border: "1px solid #e5eeef", // 얇은 테두리 추가
    borderRadius: 8, // 모서리 둥글게
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)", // 은은한 그림자
    marginBottom: 16 
}}>
    <h3 style={{ 
        margin: "0 0 12px", 
        fontSize: 16, 
        fontWeight: 700,
        color: "#1e3a8a", // 제목 색상 변경
        paddingBottom: 8,
        borderBottom: "1px solid #f0f4f7" // 얇은 구분선
    }}>
        🎯 일괄과제 🎯
    </h3>
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        
        {/* 1. 과제명 입력 */}
        <input
            type="text"
            value={bulkTitle}
            onChange={(e) => setBulkTitle(e.target.value)}
            placeholder="📚 과제 제목 입력 (예: 수학 오답노트 10p)"
            style={{ 
                flexGrow: 2, // 입력창을 더 넓게
                padding: "10px 12px", 
                border: "1px solid #ccc", 
                borderRadius: 6,
                fontSize: 14 
            }}
        />
        
        {/* 2. 학년 선택 드롭다운 */}
        <select 
            value={bulkGrade} 
            onChange={(e) => setBulkGrade(e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
        >
            <option value="">전체 학년</option>
            {uniqueGrades.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        
        {/* 3. 학교 선택 드롭다운 */}
        <select
            value={bulkSchool}
            // 2. onChange를 학교 상태 설정 함수로 변경
            onChange={(e) => setBulkSchool(e.target.value)}
            style={{ 
                flexGrow: 1,
                padding: "8px 5px", 
               border: "1px solid #ccc",
                borderRadius: 6,
                fontSize: 14,
                minWidth: 50 
            }}
        >
            <option value="">🏫 학교 </option>
            {uniqueSchools.map(s => <option key={s} value={s}>{s}</option>)}

        </select>
        
        {/* 4. 추가 버튼 */}
        <button
            onClick={() => addTaskByFilter(bulkTitle, bulkGrade, bulkSchool)}
            disabled={!bulkTitle.trim()}
            style={{
                padding: "10px 18px", // 패딩 증가
                background: bulkTitle.trim() ? "#22c55e" : "#cbd5e1", // 밝은 초록색
                color: "white",
                border: "none",
                borderRadius: 6,
                fontWeight: 700,
                cursor: bulkTitle.trim() ? "pointer" : "not-allowed",
                transition: "background 0.2s",
                boxShadow: bulkTitle.trim() ? "0 2px 4px rgba(34,197,94,0.2)" : "none" // 그림자 효과
            }}
        >
            {bulkTitle.trim() ? "➕ 과제 추가" : "제목 입력 대기"}
        </button>
    </div>
</div>



          {/* 표 */}
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:1100 }}>
              <thead>
                <tr style={{ borderBottom:"1px solid #eee", background:"#f8fafc" }}>
                  <th style={{ padding:20, textAlign:"center" }}>순번</th>
                  <th style={{ padding:10, textAlign:"center" }}>이름</th>
                  <th style={{ padding:10 }}>학년</th>
                  <th style={{ padding:10 }}>학교</th>
                  <th style={{ padding:10, width:220 }}>시간<br/><span style={{ fontSize:11, color:"#6b7280" }}>(등원/하원 - 24H)</span></th>
                  <th style={{ padding:10, width:90 }}>상태</th>
                  <th style={{ padding:10, width:90 }}>순공</th>
                  <th style={{ padding:10, width:160 }}>연락처</th>
                  <th style={{ padding:10, width:140 }}>작업</th>
                  <th style={{ padding:10, width:160 }}>상세</th>
                </tr>
              </thead>

              <tbody>
                {students.length===0 && (
                  <tr><td colSpan={10} style={{ padding:18, textAlign:"center", color:"#888" }}>학생을 추가해 시작하세요.</td></tr>
                )}

{students
    .filter(s => showRemoved || !s.removed)   // 기본적으로 숨김 학생은 안보임
    .map((s, i) => {
      const cell = day[s.id] ?? { status: "P" as StatusKey };
                  const enabled = new Set(cell.enabledSubjects || []);
                  const running = !!(cell.time && !cell.outTime);

                  return (
                    <React.Fragment key={s.id}>
                      <tr style={{ borderTop:"1px solid #f3f4f6" }}>
                      <td style={{ padding:10, textAlign:"center" }}>
  <div
    style={{
      width: 28, height: 28, borderRadius: "50%",
      background: "#1e3a8a", color: "#fff",
      display: "flex", justifyContent: "center", alignItems: "center",
      fontSize: 13, fontWeight: 700,
      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
      margin: "0 auto"
    }}
    title={`${i + 1}번`}
  >
    {i + 1}
  </div>
</td>

<td
  onClick={() => setSelectedStudentId(s.id)}   // ✅ 여기만 고치면 됩니다
  style={{
    color: "#111",
    textDecoration: "none",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 15,
    letterSpacing: "0.2px",
  }}
>
  {s.name}
</td>
                        <td style={{ padding:10, textAlign:"center" }}>{s.grade || "-"}</td>
                        <td style={{ padding:10, textAlign:"center" }}>{s.school || "-"}</td>

                        {/* 등/하교 2줄 (반드시 TD 안에서 그리드 구성) */}
                        <td style={{ padding:10 }}>
                          {/* 등원 줄 */}
                          <div style={{display:"grid", gridTemplateColumns:"1fr auto auto", gap:6, alignItems:"center", marginBottom:6}}>
                            <input type="time" value={cell.time ?? ""} onChange={(e)=>setTime(s.id, e.target.value)} style={timeInp}/>
                            <button
  style={btn}
  onClick={() => {
    setTimeNow(s.id);              // 기존 로컬 동작 유지
    handleCheckIn(s.name);         // ✅ Firestore에 기록 추가
  }}
>
  등원
</button>
                            <button
                              style={btnXS}
                              title="등원 시간 지우기"
                              onClick={() => { if (confirm("이 학생의 등원 시간을 지울까요?")) setTime(s.id, ""); }}
                            >×</button>
                          </div>
                          {/* 하원 줄 */}
                          <div style={{display:"grid", gridTemplateColumns:"1fr auto auto", gap:6, alignItems:"center"}}>
                            <input type="time" value={cell.outTime ?? ""} onChange={(e)=>setOutTime(s.id, e.target.value)} style={timeInp}/>
                            <button
  style={btn}
  onClick={() => {
    setOutTimeNow(s.id);      // 기존 기능 유지
    handleCheckOut(s.name);   // Firestore에 하원 데이터 저장
  }}
>
  하원
</button>
                            <button
                              style={btnXS}
                              title="하원 시간 지우기"
                              onClick={() => { if (confirm("이 학생의 하원 시간을 지울까요?")) setOutTime(s.id, ""); }}
                            >×</button>
                          </div>
                        </td>

                        {/* 상태 팝업 */}
                        <td style={{ padding:10, position:"relative" }}>
                          <button
                            style={{ ...chip(true), background:"#fff", color:"#111", border:"1px solid #e5e7eb", fontWeight:700, width:"100%", display:"flex", justifyContent:"center" }}
                            onClick={() => setStatusPickerFor(prev => prev === s.id ? null : s.id)}
                            title="상태 변경"
                          >
                            {STATUS[cell.status].label}
                          </button>
                          {statusPickerFor === s.id && (
                            <div style={statusMenuStyle} onMouseLeave={()=>setStatusPickerFor(null)}>
                              {(["P","L","A","E"] as StatusKey[]).map(k => (
                                <div key={k}
                                  style={{ ...statusItemStyle, background: cell.status===k ? "#111" : "#fff", color: cell.status===k ? "#fff" : "#111", borderBottom: k==="E" ? "none" : "1px solid #f2f4f7" }}
                                  onClick={() => { setStatus(s.id, k); setStatusPickerFor(null); }}
                                >
                                  {STATUS[k].label}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* 순공 (자동 라이브) */}
                        <td style={{ padding:10, fontWeight:700, textAlign:"center", whiteSpace:"nowrap" }}>
                        {(() => {
  const _force = liveTick; // 실제 값으로 읽어서 React가 이 블록을 다시 계산하도록 보장
  const minutes = running ? netStudyMinLive(cell) : netStudyMin(cell);
  return (
    <>
      {minToHM(minutes)}
      {running && <span style={{ marginLeft:6, fontSize:11, color:"#16a34a" }}>●</span>}
    </>
  );
})()}
                        </td>

                        {/* 연락처 토글 */}
                        <td style={{ padding:10, textAlign:"center" }}>
                          <button style={btn} onClick={() => setShowContact(prev => ({ ...prev, [s.id]: !prev[s.id] }))}>
                            {showContact[s.id] ? "숨기기" : "연락처"}
                          </button>
                          {showContact[s.id] && (
                            <div style={{ fontSize:12, color:"#374151", marginTop:6, lineHeight:1.45, textAlign:"center" }}>
                              <div>학생: {s.studentPhone || "-"}</div>
                              <div>부모: {s.parentPhone || "-"}</div>
                            </div>
                          )}
                        </td>

                       {/* 작업 */}
<td style={{ padding:10 }}>
  <div style={{ display:"flex", gap:8, justifyContent:"center", alignItems:"center" }}>
    {/* 수정 */}
    <button style={btn} onClick={()=>setEditStudent(s.id)}>✏️ 정보 </button>

    {/* 숨김 / 복원 */}
    {!s.removed ? (
      <button
        style={{ ...btn, background:"#FCE7F3", color:"#9D174D", border:"1px solid #FBCFE8" }}
        onClick={() => {
          if (confirm(`"${s.name}" 학생을 목록에서 숨기겠습니까? (기록은 유지됩니다)`)) {
            removeStudent(s.id);
          }
        }}
      >
        🙈 숨김
      </button>
    ) : (
      <button
        style={{ ...btn, background:"#16a34a", color:"#fff", border:"1px solid #16a34a" }}
        onClick={() => {
          setStore(prev => {
            const groups = prev.groups.map(g =>
              g.id === currentGroup.id
                ? {
                    ...g,
                    students: g.students.map(x =>
                      x.id === s.id ? { ...x, removed: false } : x
                    ),
                  }
                : g
            );
            return { ...prev, groups };
          });
        }}
      >
        👀 복원
      </button>
    )}

    {/* 영구삭제 (작은 회색 버튼) */}
    <button
      aria-label="영구삭제"
      title="영구삭제 (모든 기록도 삭제)"
      onClick={() => {
  if (!confirm(`정말로 "${s.name}" 학생을 영구 삭제할까요?\n(모든 기록도 삭제됩니다)`)) return;

  // 1️⃣ 로컬 기록 삭제
  setStore(prev => {
    const records = { ...prev.records };
    Object.keys(records).forEach(dt => {
      if (records[dt]?.[s.id]) {
        const d0 = { ...records[dt] };
        delete d0[s.id];
        records[dt] = d0;
      }
    });
    const groups = prev.groups.map(g =>
      g.id === currentGroup.id
        ? { ...g, students: g.students.filter(x => x.id !== s.id) }
        : g
    );
    return { ...prev, groups, records };
  });

  // 2️⃣ Firestore에서도 완전 삭제
  deleteStudentFromFS(s.id);

  // 3️⃣ 안내
  alert(`🗑️ "${s.name}" 학생이 완전히 삭제되었습니다.`);
}}
      style={{
        width: 26,
        height: 60,
        borderRadius: 6,
        border: "1px solid #CBD5E1",
        background: "#F8FAFC",
        color: "#1E3A8A",
        fontSize: 13,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.7,
        transition: "all .2s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.opacity = "1";
        (e.currentTarget as HTMLButtonElement).style.background = "#e5e7eb";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.opacity = "0.7";
        (e.currentTarget as HTMLButtonElement).style.background = "#f3f4f6";
      }}
    >
      삭제🗑️
    </button>
  </div>
</td>
                        {/* 상세 버튼 */}
<td style={{ padding:10, textAlign:"center", verticalAlign:"middle" }}>
  <button
    style={{
      ...btn,
      margin: "0 auto",
      display: "block",
      width: 60,
      background: showDetail[s.id] ? "#1e3a8a" : "#fff",
      color: showDetail[s.id] ? "#fff" : "#111",
      border: showDetail[s.id] ? "1px solid #1e3a8a" : "1px solid #dde1ea",
      fontWeight: 600,
      transition: "0.2s",
    }}
    onClick={() => setShowDetail(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
  >
    {showDetail[s.id] ? "닫기" : "상세"}
  </button>
</td>
                      </tr>

                      {/* 상세 펼침 */}
                      {showDetail[s.id] && (
                        <tr>
                          <td colSpan={10} style={{ background:"#fcfcfd", borderTop:"1px dashed #374151", padding:8 }}>

                              {/* ✅ 반응형 그리드 레이아웃 / 4구역 공통 박스스 */}
                              <div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", // 👈 최소폭 기준으로 자동 줄바꿈
    gap: 12,
    alignItems: "stretch",
  }}
>
                        {/* 과목 토글 + 시간 입력 */}
<div style={{ background: "#fff", border: "2px solid #1e3a8a", borderRadius: 15, padding: 7 }}>
  <div style={sectionTitle}>ACADEMY SUBJECTS</div>

  {/* ✅ 과목 버튼들 */}
  <div
    style={{
      marginTop: 6,
      display: "grid",
      gridTemplateColumns: "repeat(6, 1fr)",
      gap: 6,
      justifyItems: "center",
    }}
  >
    {(["영어", "수학", "국어", "과학", "기타", "학교"] as AcademyType[]).map((sub) => {
      const on = enabled.has(sub);
      return (
        <button
          key={sub}
          style={{
            ...chip(on),
            width: "100%",
            fontWeight: 500,
            fontSize: 12,
            borderRadius: 8,
            height: 36,
            transition: "all 0.2s",
          }}
          onClick={() => toggleSubject(s.id, sub)}
        >
          {sub}
        </button>
      );
    })}
  </div>

  {/* ✅ 오늘 켠 과목들만 시간칸 표시 */}
  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
    {(cell.enabledSubjects || []).map((sub) => {
      const subjectData = cell.academyBySubject?.[sub] || {};
      const slots = (subjectData.slots || []) as TimeSlot[];
      const slot = slots[0] || {};
      const sumMin = getSubjectSumMin(cell, sub);

      return (
        <div key={sub} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={subjectLabel(sub)}>{sub}</span>

          <input
            type="time"
            value={slot.from ?? ""}
            onChange={(e) => setAcademyTime(s.id, sub, "from", e.target.value)}
            style={{
              ...timeInpTight,
              flex: "1 1 90px",
              fontWeight: 600,
              color: "#2b2b2b",
            }}
          />

          <span style={{ fontSize: 12, color: "#1f1f1f", fontWeight: 600 }}>~</span>

          <input
            type="time"
            value={slot.to ?? ""}
            onChange={(e) => setAcademyTime(s.id, sub, "to", e.target.value)}
            style={{
              ...timeInpTight,
              flex: "1 1 90px",
              fontWeight: 600,
              color: "#2b2b2b",
            }}
          />

          <div style={{ marginLeft: "auto", fontSize: 12, color: "#374151" }}>
            누적 <b>{minToHM(sumMin)}</b>
          </div>

          <button
            style={btnXS}
            title="시간이 있으면 초기화 / 없으면 과목 해제"
            onClick={() => smartClearOrDisable(s.id, sub)}
          >
            ×
          </button>
        </div>
      );
    })}
  </div>

  {/* ✅ 학원 보충/연장 등록 (카드 내부 통합) */}
<div style={{ marginTop: 15, paddingTop: 8, borderTop: "1px dashed #cbd5e1" }}>
  <div style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", marginBottom: 6 }}>
    🕓 보충 / 연장 등록
  </div>

  {/* 새 보충 입력줄 */}
  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
    <select id="supplement-subject" style={{ ...inp, width: 60, fontSize: 12 }} defaultValue="">
      <option value="">과목</option>
      {["영어", "수학", "국어", "과학", "기타", "학교"].map((sub) => (
        <option key={sub} value={sub}>{sub}</option>
      ))}
    </select>

    <input
  type="time"
  id="supplement-from"
  style={{
    ...inp,
    width: 165,           // ⬅️ 크기 늘림 (기존 85 → 110)
    height: 32,           // ⬅️ 버튼 안 잘리게 높이 추가
    background: "#e0f2fe",  // 🌤️ 파스텔 하늘색 (Tailwind sky-100 계열)
    border: "none",
    borderRadius: 6,
    fontWeight: 600,
    color: "#1e3a8a",       // 글자는 조금 진한 네이비톤
    textAlign: "center",
  }}
/>
<span style={{ fontSize: 12 }}>~</span>
<input
  type="time"
  id="supplement-to"
  style={{
    ...inp,
    width: 180,           // ⬅️ 동일하게
    height: 32,
    background: "#e0f2fe",  // 🌤️ 파스텔 하늘색 (Tailwind sky-100 계열)
    border: "none",
    borderRadius: 6,
    fontWeight: 600,
    color: "#1e3a8a",       // 글자는 조금 진한 네이비톤
    textAlign: "center",
  }}
/>

    <button
      style={{
        ...btn,
        background: "#93C5FD",
        color: "#fff",
        fontSize: 12,
        padding: "5px 10px",
        borderRadius: 8,
      }}
      onClick={() => {
        const sub = (document.getElementById("supplement-subject") as HTMLSelectElement)?.value;
        const from = (document.getElementById("supplement-from") as HTMLInputElement)?.value;
        const to = (document.getElementById("supplement-to") as HTMLInputElement)?.value;
        if (!sub || !from || !to) return alert("과목과 시간을 모두 입력하세요.");

        setStore((prev) => {
          const records = { ...prev.records };
          const d0 = { ...(records[date] || {}) };
          const cell = { ...(d0[s.id] ?? { status: "P" }) };
          cell.overrideAcademyTimes = cell.overrideAcademyTimes || {};
          cell.overrideAcademyTimes[sub] = {
  subject: sub,
  from,
  to,
  date, // 📅 오늘 날짜 변수 (이미 상단에 있음)
};
          d0[s.id] = cell;
          records[date] = d0;
          return { ...prev, records };
        });

        (document.getElementById("supplement-subject") as HTMLSelectElement).value = "";
        (document.getElementById("supplement-from") as HTMLInputElement).value = "";
        (document.getElementById("supplement-to") as HTMLInputElement).value = "";
      }}
    >
      등록
    </button>
  </div>

 {/* 등록된 보충 리스트 */}
<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
  {cell.overrideAcademyTimes && Object.entries(cell.overrideAcademyTimes).length > 0 ? (
    Object.entries(cell.overrideAcademyTimes).map(([key, t]) => (
      <div
        key={key}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#f0f9ff",  // 💎 연한 하늘색
          border: "1px solid #bae6fd",
          borderRadius: 8,
          padding: "4px 8px",
          fontSize: 12,
        }}
      >
        <div>
          <b style={{ color: "#1d4ed8" }}>{t.subject}</b> — {t.from} ~ {t.to}
          <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>
            ({t.date})
          </span>
        </div>

        <button
          style={{
            background: "#fee2e2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            fontWeight: 700,
            fontSize: 14,
            borderRadius: 8,
            width: 28,
            height: 28,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          title="삭제"
          onClick={() => {
            if (!confirm(`${t.subject} (${t.date}) 보충시간을 삭제할까요?`)) return;
            setStore((prev) => {
              const records = { ...prev.records };
              const d0 = { ...(records[date] || {}) };
              const cell = { ...(d0[s.id] ?? { status: "P" }) };
              if (cell.overrideAcademyTimes) delete cell.overrideAcademyTimes[key];
              d0[s.id] = cell;
              records[date] = d0;
              return { ...prev, records };
            });
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = "#fecaca")}
          onMouseOut={(e) => (e.currentTarget.style.background = "#fee2e2")}
        >
          ×
        </button>
      </div>
    ))
  ) : (
    <div style={{ fontSize: 12, color: "#6b7280" }}>등록된 보충이 없습니다.</div>
  )}
</div>
</div>
</div>
 
  

                             {/* 화장실/식사/Sleep — RESET ZONE */}
<div style={{ background:"#fff", border:"3px solid #b71c1c", borderRadius:10, padding:10, height:"100%", }}>
  <div style={sectionTitle}> RESET ZONE </div>

  <div style={{ display:"grid", gap:8, marginTop:8 }}>
    {/* 화장실 & 물 — 7분씩 가감 */}
<div>
  <div style={{ fontSize:12, color:"#059669", fontWeight:700, marginBottom:6 }}>
  ***   화장실 & 물
  </div>

  <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
    {/* -1 (최소 0회) */}
    <button
      style={{ ...btn, width:32 }}
      onClick={() => {
        const curr = cell.restroomCount || 0;
        const next = Math.max(0, curr - 1);
        setRestroomCount(s.id, next); // 내부에서 next*7분 반영
      }}
      title="한 번 누를 때마다 7분 차감"
    >
      −
    </button>

    {/* +1 (최대 5회에서 멈춤) */}
    <button
      style={{ ...btn }}
      onClick={() => {
        const curr = cell.restroomCount || 0;
        const next = Math.min(5, curr + 1);
        setRestroomCount(s.id, next); // 내부에서 next*7분 반영
      }}
      title="한 번 누를 때마다 7분 추가"
    >
      +1회 (+7분)
    </button>

    {/* 현재 합계 표시 */}
    <div style={{ fontSize:12, color:"#374151" }}>
      합계: <b>{cell.restroomCount || 0}회</b> / <b>{cell.restroomMin || 0}분</b>
    </div>
  </div>

  <div style={{ fontSize:11, color:"#6b7280", marginTop:4 }}>
    * 1회 = 7분, 최소 0회 · 최대 5회
  </div>

{/* 이동 / 통학 */}
<div>
  <div style={{ fontSize:12, color:"#2563eb", fontWeight:700, marginBottom:6 }}>
    🚍 이동 / 통학
  </div>

  <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
    {/* +30분 */}
    <button
      style={btn}
      onClick={() => {
        const curr = cell.commuteMin || 0;
        const next = curr + 30;
        setStore(prev => {
          const records = { ...prev.records };
          const d0 = { ...(records[date] || {}) };
          const newCell: DayCell = { ...(d0[s.id] ?? { status: "P" }) };
          (newCell as any).commuteMin = next;
          d0[s.id] = newCell;
          records[date] = d0;
          return { ...prev, records };
        });
      }}
    >
      +30분
    </button>

    {/* +60분 */}
    <button
      style={btn}
      onClick={() => {
        const curr = cell.commuteMin || 0;
        const next = curr + 60;
        setStore(prev => {
          const records = { ...prev.records };
          const d0 = { ...(records[date] || {}) };
          const newCell: DayCell = { ...(d0[s.id] ?? { status: "P" }) };
          (newCell as any).commuteMin = next;
          d0[s.id] = newCell;
          records[date] = d0;
          return { ...prev, records };
        });
      }}
    >
      +60분
    </button>

   

    {/* 직접입력 */}
    <span style={{ fontSize:12, color:"#6b7280" }}>직접:</span>
    <input
      type="number"
      min={0}
      placeholder="분"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const v = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(v) && v > 0) {
            setStore(prev => {
              const records = { ...prev.records };
              const d0 = { ...(records[date] || {}) };
              const newCell: DayCell = { ...(d0[s.id] ?? { status: "P" }) };
              (newCell as any).commuteMin = (newCell as any).commuteMin || 0;
              (newCell as any).commuteMin += v;
              d0[s.id] = newCell;
              records[date] = d0;
              return { ...prev, records };
            });
            (e.target as HTMLInputElement).value = "";
          }
        }
      }}
      style={{ ...inp, width:80, textAlign:"right" }}
    />

    {/* 합계 표시 */}
    <div style={{ fontSize:12, color:"#374151" }}>
      합계: <b>{cell.commuteMin || 0}분</b>
    </div>
  </div>
</div>
   


</div>
    {/* 식사 — 버튼 + 직접입력(Enter시 합계에 바로 반영) */}
<div>
  <div style={{ fontSize: 12, color: "#059669", fontWeight: 700, marginBottom: 6 }}>
    *** 식사
  </div>

  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
    {/* 단축 버튼 */}
    <button style={btn} onClick={() => addMealMinutes(s.id, 60)}>+60분</button>
    <button
      style={{ ...btn, background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FCA5A5" }}
      onClick={() => subtractMealMinutes(s.id, 30)}
    >
      −30분
    </button>

    <span style={{ fontSize: 12, color: "#6b7280" }}>직접:</span>

    <input
      type="number"
      min={0}
      placeholder="분"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const el = e.target as HTMLInputElement;
          const v = Number(el.value);
          if (Number.isFinite(v) && v > 0) {
            addMealMinutes(s.id, v); // 합계 즉시 반영
            el.value = "";
          }
        }
      }}
      onBlur={(e) => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v) && v > 0) {
          addMealMinutes(s.id, v);
          e.currentTarget.value = "";
        }
      }}
      style={{ ...inp, width: 80, textAlign: "right" }}
    />
  </div>

  <div style={{ fontSize: 12, color: "#374151" }}>
    합계: <b>{cell.mealMin || 0}분</b>
  </div>
</div>

   {/* ⚠️ Penalty Zone */}
<div
  style={{
    background:"#fff",
        borderRadius:10,
    padding:10,
    marginTop:10
  }}
>
  <div
    style={{
      fontSize:13,
      fontWeight:1000,
      color:"#b91c1c",
      textAlign:"center",
      background:"#fee2e2",
      borderRadius:9,
      padding:"9px 0",
      marginBottom:10,
      letterSpacing:"0.5px"
    }}
  >
     PENALTY ZONE
  </div>

    {/* 💤 Sleep Penalty */}
<div
  style={{
    display: "grid",
    gridTemplateColumns: "auto 28px 46px 28px", // 라벨 | − | 숫자 | +
    alignItems: "center",
    gap: 10,
    background: "#FFF5F5",
    borderRadius: 10,
    padding: "6px 12px",
  }}
>
  <span
    style={{
      gridColumn: "1 / 2",
      fontSize: 12,
      fontWeight: 700,
      color: "#B91C1C",
      textAlign: "center",
      whiteSpace: "nowrap",
    }}
  >
    Sleep penalty
  </span>

  <button
    style={{
      ...btn,
      gridColumn: "2 / 3",
      width: 28,
      height: 28,
      padding: 0,
      display: "grid",
      placeItems: "center",
      border: "3px solid #FAC5A5",
      background: "#FFF",
      color: "#B91C1C",
      fontWeight: 800,
    }}
    onClick={() => {
      setStore((prev) => {
        const records = { ...prev.records };
        const d0 = { ...(records[date] || {}) };
        const cell: DayCell = { ...(d0[s.id] ?? { status: "P" }) };
        const current = (cell as any).sleepPenaltyCount || 0;
        (cell as any).sleepPenaltyCount = Math.max(0, current - 1);
        d0[s.id] = cell;
        records[date] = d0;
        return { ...prev, records };
      });
    }}
  >
    −
  </button>

  <span
    style={{
      gridColumn: "3 / 4",
      width: 46,
      textAlign: "center",
      fontSize: 14,
      fontWeight: 800,
      color: "#B91C1C",
    }}
  >
    {cell.sleepPenaltyCount || 0}회
  </span>

  <button
    style={{
      ...btn,
      gridColumn: "4 / 5",
      width: 28,
      height: 28,
      padding: 0,
      display: "grid",
      placeItems: "center",
      background: "#FFF",
      border: "3px solid #FAC5A5",
      color: "#B91C1C",
      fontWeight: 800,
    }}
    onClick={() => addSleepPenalty(s.id, 1)}
  >
    +
  </button>
</div>

 {/* ⏰ Late Penalty */}
<div
  style={{
    display: "grid",
    gridTemplateColumns: "auto 28px 46px 28px", // 라벨 | − | 숫자 | +
    alignItems: "center",
    gap: 10,
    background: "#F5F3FF",
    borderRadius: 10,
    padding: "6px 12px",
    marginTop: 8,
  }}
>
  <span
    style={{
      gridColumn: "1 / 2",
      fontSize: 12,
      fontWeight: 700,
      color: "#6B21A8",
      textAlign: "center",
      whiteSpace: "nowrap",
    }}
  >
    Late penalty
  </span>

  <button
    style={{
      ...btn,
      gridColumn: "2 / 3",
      width: 28,
      height: 28,
      padding: 0,
      display: "grid",
      placeItems: "center",
      background: "#FFF",
      border: "3px solid #C7BFF5",
      color: "#6B21A8",
      fontWeight: 800,
    }}
    onClick={() => {
      setStore((prev) => {
        const records = { ...prev.records };
        const d0 = { ...(records[date] || {}) };
        const cell: DayCell = { ...(d0[s.id] ?? { status: "P" }) };
        const current = (cell as any).latePenaltyCount || 0;
        (cell as any).latePenaltyCount = Math.max(0, current - 1);

        d0[s.id] = cell;
        records[date] = d0;
        return { ...prev, records };
      });
    }}
  >
    −
  </button>

  <span
    style={{
      gridColumn: "3 / 4",
      width: 46,
      textAlign: "center",
      fontSize: 14,
      fontWeight: 800,
      color: "#6B21A8",
    }}
  >
    {(cell as any).latePenaltyCount || 0}회
  </span>

  <button
    style={{
      ...btn,
      gridColumn: "4 / 5",
      width: 28,
      height: 28,
      padding: 0,
      display: "grid",
      placeItems: "center",
      background: "#FFF",
      border: "3px solid #C7BFF5",
      color: "#6B21A8",
      fontWeight: 800,
    }}
    onClick={() => {
      setStore((prev) => {
        const records = { ...prev.records };
        const d0 = { ...(records[date] || {}) };
        const cell: DayCell = { ...(d0[s.id] ?? { status: "P" }) };
        const current = (cell as any).latePenaltyCount || 0;
        (cell as any).latePenaltyCount = current + 1;
        d0[s.id] = cell;
        records[date] = d0;
        return { ...prev, records };
      });
    }}
  >
    +
  </button>
</div>
</div>



    </div>

    </div>




                             {/* MY Daily */}
<div style={{ background:"#fff", border:"3px solid #1e3a8a", borderRadius:10, padding:10, height:"100%",
 textAlign:"left", position:"relative", minHeight:100 }}>
  <div style={sectionTitle}> My Daily </div>

  {(() => {
     // ===== 당일 집계 =====
    const baseAcademyMin = subjectOutingMin(cell);
const overrideMin =
  cell.overrideAcademyTimes
    ? Object.values(cell.overrideAcademyTimes).reduce((sum, t) => {
        if (t.from && t.to) return sum + spanMin(t.from, t.to);
        return sum;
      }, 0)
    : 0;

const academyMin = baseAcademyMin + overrideMin; // ✅ 보충 포함

const restBreakMin = (cell.restroomMin || 0) + (cell.mealMin || 0);
const running = !!(cell.time && !cell.outTime);
const netMin = running ? netStudyMinLive(cell) : netStudyMin(cell);
const gross = cell.time
  ? (running
      ? hmToMin(nowHM()) - hmToMin(cell.time)
      : spanMin(cell.time, cell.outTime))
  : 0;

const commute = cell.commuteMin || 0;
const rest = restBreakMin;
const other = Math.max(0, gross - (netMin + academyMin + rest));
    const segs = [
  { label: `순공 ${minToHM(netMin)}`, value: netMin, color: "#16a34a" },
  { label: `학원 ${minToHM(academyMin)}`, value: academyMin, color: "#1d4ed8" },
  { label: `이동 ${minToHM(commute)}`, value: commute, color: "#93C5FD" }, // 💎 파스텔 하늘색
  { label: `휴식 ${minToHM(rest)}`, value: rest, color: "#f59e0b" },
  { label: `기타 ${minToHM(other)}`, value: other, color: "#9CA3AF" },
];

    const sum = segs.reduce((a,b)=>a+b.value,0);
    const wk = getWeekRange(date);
    const wkPenalty = sumPenaltyForRange(s.id, wk.start, wk.end);
    const mr = monthRange(date);
    const moPenalty = mr ? sumPenaltyForRange(s.id, mr.start, mr.end) : 0;

    return (
      <div style={{ marginTop:6, fontSize:12, color:"#444", lineHeight:1.7 }}>
        {/* ===== 도넛(원형) 차트 ===== */}
        {sum > 0 ? (
          <div style={{ marginTop:10, display:"flex", justifyContent:"center" }}>
            <Donut size={120} stroke={18} segments={segs} />
          </div>
        ) : (
          <div style={{ marginTop:10, color:"#9ca3af" }}>아직 집계할 시간이 없어요.</div>
        )}

        <div>🏫 총 Academy Subjects: <b>{minToHM(academyMin)}</b></div>
        <div>🚌 이동 / 통학: <b>{minToHM(cell.commuteMin || 0)}</b></div>
        <div>⏰ 총 순공시간: <b>{minToHM(netMin)}</b>{running && <span style={{ marginLeft:6, fontSize:11, color:"#16a34a" }}>●</span>}</div>
        <div>🚰 총 외출(화장실·물·식사): <b>{minToHM(restBreakMin)}</b></div>
        

        <div
  style={{
    marginTop: 6,
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)", // 2열씩 자동 정렬
    gap: 8,
  }}
>
 {/* Sleep (주간) */}
 <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
    <div style={{ fontSize: 11, color: "#6b7280" }}>Sleep 패널티 (주간)</div>
    <div style={{ fontSize: 14, fontWeight: 800, color: "#b71c1c" }}>{wkPenalty}회</div>
  </div>

  {/* Sleep (월간) */}
  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
    <div style={{ fontSize: 11, color: "#6b7280" }}>Sleep 패널티 (월간)</div>
    <div style={{ fontSize: 14, fontWeight: 800, color: "#b71c1c" }}>{moPenalty}회</div>
  </div>

  {/* Late (주간) */}
  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
    <div style={{ fontSize: 11, color: "#6b7280" }}>Late 패널티 (주간)</div>
    <div style={{ fontSize: 14, fontWeight: 800, color: "#B45309" }}>
      {sumPenaltyForRange(s.id, wk.start, wk.end, "latePenaltyCount")}회
    </div>
  </div>

  {/* Late (월간) */}
  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
    <div style={{ fontSize: 13, color: "#6b7280" }}>Late 패널티 (월간)</div>
    <div style={{ fontSize: 14, fontWeight: 800, color: "#B45309" }}>
      {mr ? sumPenaltyForRange(s.id, mr.start, mr.end, "latePenaltyCount") : 0}회
    </div>
  </div>
  </div>
  </div>

    );
  })()}
  </div>                       
 {/* COMMENT (메모/학습) — 아웃박스 1개만 */}
 <div
  style={{
    background: "#fff",
    border: "2px solid #374151",
    borderRadius: 10,
    padding: 10,
    height: "100%", // 칸 전체 높이 채움
    display: "grid",
    gridTemplateRows: "auto 1fr 1fr auto", // 제목 + 코멘트칸 + 학습칸 + 여백
    gap: 10,
  }}
>

  <div style={sectionTitle}>COMMENT</div>

  {/* 🗒️ 오늘의 코멘트 */}
  <div
    style={{
      display:"flex", flexDirection:"column", gap:6, marginTop:8,
      border:"1px solid #e5e7eb", borderRadius:8, padding:"8px 10px", background:"#f9fafb"
    }}
  >
    <div style={{ fontWeight:700, fontSize:12, color:"#374151" }}>🗒️ 오늘의 코멘트</div>
    <textarea
      placeholder="오늘 태도/집중/컨디션 등 코멘트를 작성하세요."
      value={day[s.id]?.comment || ""}
      onChange={(e) => {
        const val = e.target.value;
        setStore(prev => {
          const recs = { ...prev.records };
          const d0 = { ...(recs[date] || {}) };
          const cell: DayCell = { ...(d0[s.id] ?? { status: "P" }) };
          (cell as any).comment = val;
          d0[s.id] = cell; recs[date] = d0;
          return { ...prev, records: recs };
        });
      }}
      style={{
        border:"1px solid #dde1ea", borderRadius:6, padding:"6px 8px",
        resize:"vertical", fontSize:12, minHeight:60, background:"#fff", width:"100%"
      }}
    />
  </div>

  {/* 📚 학습 내용 */}
  <div
    style={{
      display:"flex", flexDirection:"column", gap:6, marginTop:10,
      border:"1px solid #e5e7eb", borderRadius:8, padding:"8px 10px", background:"#f9fafb"
    }}
  >
    <div style={{ fontWeight:700, fontSize:12, color:"#374151" }}>📚 학습 내용</div>
    <textarea
      placeholder="오늘 수행한 학습(과목/범위/페이지 등)을 기록하세요."
      value={day[s.id]?.studyNote || ""}
      onChange={(e) => {
        const val = e.target.value;
        setStore(prev => {
          const recs = { ...prev.records };
          const d0 = { ...(recs[date] || {}) };
          const cell: DayCell = { ...(d0[s.id] ?? { status: "P" }) };
          (cell as any).studyNote = val;
          d0[s.id] = cell; recs[date] = d0;
          return { ...prev, records: recs };
        });
      }}
      style={{
        border:"1px solid #dde1ea", borderRadius:6, padding:"6px 8px",
        resize:"vertical", fontSize:12, minHeight:80, background:"#fff", width:"100%"
      }}
    />
  </div>

   {/* 📌 과제/수행 */}
<div style={{ background:"#fff", border:"2px solid #0ea5e9", borderRadius:12, padding:10 }}>
  <div style={{ textAlign:"center", fontWeight:800, color:"#0ea5e9", fontSize:14, marginBottom:8 }}>
    📌 과제 / 수행 체크
  </div>

  {/* 입력 + 추가 */}
  <div style={{ display:"flex", gap:6, marginBottom:8 }}>
    <input
      placeholder="과제명 입력 후 Enter"
      style={{ ...inp, flex:1 }}
      onKeyDown={(e)=>{
        if(e.key==="Enter"){
          const v=(e.target as HTMLInputElement).value;
          addTask(s.id, date, v);
          (e.target as HTMLInputElement).value="";
        }
      }}
    />
    <button
      style={btn}
      onClick={()=>{
        const v = prompt("과제명")?.trim();
        if (v) addTask(s.id, date, v);
      }}
    >추가</button>
  </div>

  {/* 리스트 */}
  <div style={{ display:"grid", gap:6 }}>
    {(cell.tasks || []).length===0 ? (
      <div style={{ fontSize:12, color:"#6b7280", textAlign:"center" }}>
        오늘 등록된 과제가 없습니다.
      </div>
    ) : (
      (cell.tasks || []).map(t=>(
            <div key={t.id} style={{  display:"grid",   gridTemplateColumns:"auto 1fr auto",   alignItems:"center", gap:8,  border:"1px solid #e5e7eb", borderRadius:8, padding:"6px 8px"
        }}>
          <input
            type="checkbox"    checked={!!t.done}
            onChange={()=>toggleTask(s.id, date, t.id)}
            style={{ width:16, height:16 }}
          />
          <div>
            <div style={{ fontSize:13, fontWeight:700, textDecoration: t.done?"line-through":"none" }}>
              {t.title}
            </div>
            <input
              placeholder="메모(선택)"
              defaultValue={t.note || ""}
              onBlur={(e)=>setTaskNote(s.id, date, t.id, e.currentTarget.value)}
              style={{ ...inp, width:"100%", marginTop:4 }}
            />
          </div>
          <button style={btnXS} onClick={()=>removeTask(s.id, date, t.id)}>삭제</button>
        </div>
      ))
    )}
  </div>

  {/* 이월 */}
  <div style={{ marginTop:10, textAlign:"right" }}>
    <button
      style={{ ...btn, borderColor:"#0ea5e9", color:"#0ea5e9" }}
      onClick={()=>carryOverIncompleteTasks(s.id, date)}
      title="미완료 과제를 내일 날짜로 복사"
    >
      ⏭️ 미완료 → 내일로 이월
    </button>
  </div>
</div>


  {/* Report 버튼 */}
  <div style={{ textAlign:"right", marginTop:10 }}>
    <button
      style={{ background:"#8a0f16", color:"#fff", border:"none", borderRadius:999, padding:"6px 14px", fontWeight:700, fontSize:10, cursor:"pointer", boxShadow:"0 2px 5px rgba(0,0,0,0.2)"
      }}
      onClick={()=>printDailyReport(s.id)}
      title="일일 리포트 열기"
    >
      Report
    </button>
  </div>
</div>
</div>

    </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
 {/* 오늘 요약 */}
 <div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))", // ✅ 4등분, 내용이 넘쳐도 균등 유지
    gap: 16,
    marginTop: 10,
    width: "100%",
    alignItems: "stretch",
  }}
>
  {(["P","L","A","E"] as StatusKey[]).map((k) => {
    const count = students.reduce((acc, s) => acc + ((day[s.id]?.status === k) ? 1 : 0), 0);

    const colors: Record<StatusKey, { bg: string; color: string; border: string }> = {
      P: { bg: "#EAF8ED", color: "#1B5E20", border: "#CFEAD5" }, // 출석
      L: { bg: "#FFF9E5", color: "#7A5A0B", border: "#F1E7BF" }, // 지각
      A: { bg: "#FCEBEC", color: "#C62828", border: "#F3C8CC" }, // 결석
      E: { bg: "#ECEEFC", color: "#283593", border: "#CCD3F6" }, // 조퇴
    };

    const isActive = focusStatus === k;

    return (
      <div
        key={k}
        role="button"
        onClick={() => {
          if (!students.length) return alert("등록된 학생이 없습니다.");
          setSelectedStudentId((prev) => prev ?? students[0].id);
          setFocusStatus(k);
        }}
        style={{
          // ✅ 카드 공통
          width: "100%",
          boxSizing: "border-box",
          minWidth: 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 18px",
          borderRadius: 14,
          cursor: "pointer",
          transition: "transform .1s ease, box-shadow .2s ease, border .2s ease",
          // ✅ 컬러/테두리
          background: colors[k].bg,
          border: isActive ? `2px solid ${colors[k].color}` : `1px solid ${colors[k].border}`,
          boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        }}
        onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.99)")}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "#4b5563" }}>
          {STATUS[k].label}
        </div>
        <div style={{ fontWeight: 900, fontSize: 18, color: colors[k].color, textAlign: "right" }}>
          {count}
        </div>
      </div>
    );
  })}
</div>

 </div>

          </div>

          
        </div>
  {/* 달력 모달 */}
{selectedStudent && (
  <StudentCalendarModal        
    student={selectedStudent}
    records={store.records}
    monthDate={date}
    onClose={() => { setSelectedStudentId(null); setFocusStatus(null);}}

    // 상태 변경
    onSetStatus={(sid, ds, st) => {
      setStore(prev => {
        const records = { ...prev.records };
        const dayRec  = { ...(records[ds] || {}) };
        const cell: DayCell = { ...(dayRec[sid] ?? { status: st }), status: st };

        // 출석/지각이면 등원시간 자동 입력(없을 때만)
        if ((st === "P" || st === "L") && !cell.time) cell.time = nowHM();
        // 결석이면 시간 초기화
        if (st === "A") { cell.time = undefined; cell.outTime = undefined; }

        dayRec[sid] = cell;
        records[ds]  = dayRec;
        return { ...prev, records };
      });
    }}

    // 기존 memo 필드 저장(유지)
    onSetMemo={(sid, ds, memo) => {
      setStore(prev => {
        const records = { ...prev.records };
        const dayRec  = { ...(records[ds] || {}) };
        const cell: DayCell = { ...(dayRec[sid] ?? { status: "P" as StatusKey }) };
        cell.memo = memo || undefined;
        dayRec[sid] = cell;
        records[ds]  = dayRec;
        return { ...prev, records };
      });
    }}

    // 새 코멘트/학습 저장 (comment, studyNote)
    onSaveNotes={(sid, ds, patch) => {
      setStore(prev => {
        const records = { ...prev.records };
        const dayRec  = { ...(records[ds] || {}) };
        const cell: DayCell = { ...(dayRec[sid] ?? { status: "P" as StatusKey }) };

        if (patch.comment !== undefined)   cell.comment   = patch.comment || undefined;
        if (patch.studyNote !== undefined) cell.studyNote = patch.studyNote || undefined;

        dayRec[sid] = cell;
        records[ds]  = dayRec;
        return { ...prev, records };
      });
    }}

    focusStatus={focusStatus}   // ← 이 줄 추가
  />
)}

       {/* 학생 정보 수정 모달 */}
{editStudent && (() => {
  const st = (currentGroup?.students || []).find(s => s.id === editStudent);
  if (!st) return null;
  return (
    <EditStudentModal
      student={st}
      onClose={() => setEditStudent(null)}
      onSave={(patch) => updateStudent(st.id, patch)}
    />
  );
})()}
  </div>
 
);
}



/** ================= 달력 모달 (요약·일정 표시 + 메모 팝업 + 프린트 지원) ================= */
type StudentCalendarModalProps = {
  student: Student;
  records: Records;
  monthDate: string; // 'YYYY-MM-DD' 아무 날이어도 해당 월을 인식
  onClose: () => void;
  onSetStatus: (sid: string, date: string, st: StatusKey) => void;
  onSetMemo: (sid: string, date: string, memo: string) => void;
  onSaveNotes: (sid: string,  date: string,  patch: { comment?: string; studyNote?: string }   ) => void;
  focusStatus?: StatusKey | null; // 추가
};

function StudentCalendarModal({
  student,
  records,
  monthDate,
  onClose,
  onSetStatus,
  onSetMemo,
  onSaveNotes,
  focusStatus
}: StudentCalendarModalProps) {
  const r = monthRange(monthDate);
  if (!r) return null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // ===== 유틸
  const yyyy = new Date(r.start).getFullYear();
  const mm = new Date(r.start).getMonth() + 1;

  const yyyymm = `${yyyy}-${String(mm).padStart(2, "0")}`;

  const fmtDayOnly = (ds: string) => ds.slice(8); // 'YYYY-MM-DD' -> 'DD'
  const isSat = (ds: string) => new Date(ds).getDay() === 6;
  const isSun = (ds: string) => new Date(ds).getDay() === 0;

  // ===== 공휴일: 양력 + (2024/2025 음력 주요일) 간단 테이블
  const getKoreanHolidays = (year: number) => {
    const set = new Set<string>();
    const add = (m: number, d: number) =>
      set.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

    // 양력 고정
    add(1, 1);   // 신정
    add(3, 1);   // 삼일절
    add(5, 5);   // 어린이날
    add(6, 6);   // 현충일
    add(8, 15);  // 광복절
    add(10, 3);  // 개천절
    add(10, 9);  // 한글날
    add(10, 8);  // 추석공휴일
    add(12, 25); // 성탄절

    // 음력 주요일(간편: 2024~2025 표만 제공)
    // 실제 서비스에선 API/달력라이브러리로 대체 권장
    const extra: Record<number, string[]> = {
      2024: [
        "2024-02-09", "2024-02-10", "2024-02-12", // 설연휴(대체 포함 예시)
        "2024-05-15", // 석가탄신일(2024 양력)
        "2024-09-16", "2024-09-17", "2024-09-18", // 추석연휴
      ],
      2025: [
        "2025-01-27", "2025-01-28", "2025-01-29", // 설연휴(대체/예시)
        "2025-05-05", // 석가탄신일(2025 양력: 5/5, 어린이날과 겹침)
        "2025-10-05", "2025-10-06", "2025-10-07", // 추석연휴(예시)
      ],
    };
    (extra[year] || []).forEach(ds => set.add(ds));
    return set;
  };
  const HOLIDAYS = getKoreanHolidays(yyyy);
  const isHoliday = (ds: string) => HOLIDAYS.has(ds);

  // ===== 해당 월 날짜 배열
  const days: string[] = [];
  for (let d = new Date(r.start); d <= new Date(r.end); d.setDate(d.getDate() + 1)) {
    days.push(fmtDate(d));
  }

  // ===== 패널티 월 합계 (Sleep/Late)
  const monthPenalty = (() => {
    let sleep = 0;
    let late = 0;
    const start = r.start, end = r.end;
    Object.entries(records).forEach(([ds, bySid]) => {
      if (ds >= start && ds <= end) {
        const c = bySid[student.id];
        if (!c) return;
        const s = (c as any).sleepPenaltyCount || 0;
        const l1 = (c as any).latePenaltyCount || 0;
        const l2 = (c as any).latepenaltyCount || 0; // 오타 호환
        sleep += s;
        late += l1 + l2;
      }
    });
    return { sleep, late };
  })();

  // ===== 메모 팝업 상태 (comment + studyNote 확장)
const [memoPopup, setMemoPopup] = React.useState<
null | { date: string; comment: string; studyNote: string }>(null);

  // ===== 스타일
  const badge: React.CSSProperties = {
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#fff",
  };
  const btn: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  };

  // 첫 주 앞 공백 필드
  const first = new Date(r.start);
  const lead = (first.getDay() + 6) % 7; // 월=0
  const slots: (string | "")[] = Array(lead).fill("");
  days.forEach((d) => slots.push(d));
  // 7일씩 줄바꿈
  const rows: (string | "")[][] = [];
  for (let i = 0; i < slots.length; i += 7) rows.push(slots.slice(i, i + 7));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 80,
      }}
      onClick={onClose}
    >
      {/* 프린트 전용 스타일 */}
      <style>{`
  @media print {
    /* 페이지 방향을 가로로 설정 */
    @page { size: A4 landscape; }

    /* 1) 달력만 보이게 */
    body * { visibility: hidden !important; }
    #calendar-print-root, #calendar-print-root * { visibility: visible !important; }

    /* 2) 위치와 스타일 */
    #calendar-print-root {
      position: absolute;
      left: 0; top: 0;
      width: 297mm;     /* 가로 A4 너비 */
      min-height: 210mm; /* 가로 A4 높이 */
      margin: 0;
      padding: 10mm;
      box-shadow: none !important;
      border: none !important;
      height: auto !important;
    }

    /* 3) 기타 */
    .no-print { display: none !important; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`}</style>

      <div
        id="calendar-print-root"
        style={{
          width: "95vw",
          height: "95vh",
          background: "#fff",
          borderRadius: 12,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 12px 32px rgba(0,0,0,.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더: 좌(버튼들) / 중앙(월 표시) / 우(학생정보) */}
<div
  style={{
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    marginBottom: 10,
  }}
>
  {/* 왼쪽: 버튼들 */}
  <div style={{ display: "flex", gap: 8 }}>
    <button className="no-print" style={btn} onClick={() => window.print()}>
      프린트
    </button>
    <button className="no-print" style={btn} onClick={onClose}>
      닫기
    </button>
  </div>

  {/* 중앙: 월 표기 */}
  <div style={{ textAlign: "center" }}>
    <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: ".5px" }}>
      {yyyy}년 {mm}월
    </div>
  </div>

  {/* 오른쪽: 학생 이름/학교 */}
  <div style={{ textAlign: "right" }}>
    <div
      style={{
        fontSize: 20,         // ✅ 이름 크게
        fontWeight: 900,
        color: "#111",
        lineHeight: 1.1,
      }}
    >
      {student.name}
    </div>
    <div
      style={{
        fontSize: 15,         // ✅ 학교 작게, 연한 회색
        color: "#6b7280",
        marginTop: 2,
      }}
    >
      {student.school || "학교 미지정"}
    </div>
  </div>
</div>

        {/* 패널티 월 합계 배지 */}
        <div style={{ display: "flex", justifyContent: "center", gap: 12, margin: "4px 0 10px" }}>
          <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>
            💤 Sleep: {monthPenalty.sleep}회
          </div>
          <div style={{ background: "#fef3c7", color: "#92400e", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>
            ⏰ Late: {monthPenalty.late}회
          </div>
        </div>

        {/* ✅ 상태 하이라이트 표시 */}
{focusStatus && (
  <div
    className="no-print"
    style={{
      textAlign: "right",
      fontSize: 12,
      fontWeight: 800,
      color: "#1e3a8a",
      marginBottom: 8,
    }}
  >
    상태 하이라이트: {STATUS[focusStatus].label}
  </div>
)}



        {/* 요일 헤더 + 달력 */}
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                {["월", "화", "수", "목", "금", "토", "일"].map((w) => (
                  <th key={w} style={{ padding: 8, fontSize: 12, textAlign: "left" }}>
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            
            <tbody>
  {rows.map((row, idx) => (
    <tr key={idx}>
      {row.map((ds, i2) => { if (!ds) {   return (
            <td
              key={i2}
              style={{ borderBottom: "1px solid #eee", padding: 8 }}
            />
          );
        }

        // 날짜, 요일, 상태 관련 계산
        const dt = new Date(ds);
        const dow = dt.getDay(); // 0=일~6=토
        const isSun = dow === 0;
        const isSat = dow === 6;
        const isHol = isHoliday(ds);
        const c = records[ds]?.[student.id];
        const status: StatusKey = c?.status || "P";
        const isFocused = focusStatus && status === focusStatus;
        const todayStr = fmtDate(new Date());
         const isFuture = ds > todayStr;
         const isToday = ds === todayStr;
         const isLate  = status === "L";
         const isAbs   = status === "A";
         const isEarly = status === "E";

// 캘린더 셀 배경색 (상태가 우선, 그다음 휴일/주말)
// 상태에 따른 배경색 (토·일·공휴일은 흰색 유지)
const cellBg =
  isLate  ? "#FFF6E5" :
  isAbs   ? "#FEECEC" :
  isEarly ? "#EAF6FF" :
  "#FFFFFF";

// 요일·공휴일에 따른 글자색만 강조
const textColor =
  isHol ? "#DC2626" :        // 공휴일: 빨강
  isSun ? "#DC2626" :        // 일요일: 빨강
  isSat ? "#2563EB" :        // 토요일: 파랑
  "#111";                    // 기본 검정
        

        // ===== 날짜 영역 색상 =====
        const bg = isHol
          ? "#fee2e2"
          : isSun
          ? "#fee2e2"
          : isSat
          ? "#e0e7ff"
          : "#f9fafb";

        const fg = isHol || isSun ? "#b91c1c" : isSat ? "#1e3a8a" : "#111";

        return (
          <td
  key={ds}
  style={{
    borderBottom: "1px solid #eee",
    padding: 8,
    verticalAlign: "top",
    background: cellBg,                    // ← 상태별 배경
    boxShadow: isLate ? "inset 0 0 0 2px #FDBA74" : "none" // ← 지각이면 테두리 강조(주황)
   
  }}
>
            {/* 상단 라인: 날짜 + 상태 */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 6,
                alignItems: "center",
                gap: 6,
              }}
                       >
              
              {/* 날짜 동그라미 */}
              <div
  style={{
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontWeight: 800,
    fontSize: 13,
    background: bg,
    color: fg,
    boxShadow: isFocused ? "0 0 0 3px rgba(30,58,138,.35)" : "inset 0 1px 2px rgba(0,0,0,0.05)", // ✅ 강조
    border: isToday ? "2px solid #1e3a8a" : "none",
  }}
>
  {Number(ds.slice(8))}
</div>
{isLate  && <span style={{ marginLeft: 4, fontSize: 11, color:"#B45309" }}>⏰</span>}
  {isAbs   && <span style={{ marginLeft: 4, fontSize: 11, color:"#DC2626" }}>✖</span>}
  {isEarly && <span style={{ marginLeft: 4, fontSize: 11, color:"#2563EB" }}>↘</span>}

              {/* 상태 뱃지 */}
              <span
                style={{
                  ...badge,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontWeight: 700,
                }}
              >
                {(() => {
                  if (isFuture) {
                    return (
                      <>
                        <span style={{ width:10, height:10, borderRadius:"50%", background:"#e5e7eb", display:"inline-block" }} />
                      </>
                    );
                  }

                  // 과거 및 오늘
                  const color =
                    status === "P"
                      ? "#16a34a" // 출석 초록
                      : status === "L"
                      ? "#eab308" // 지각 노랑
                      : status === "A"
                      ? "#dc2626" // 결석 빨강
                      : "#6d28d9"; // 조퇴 보라

                  return (
                    <>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: color,
                          display: "inline-block",
                        }}
                      />
                      {STATUS[status].short}
                    </>
                  );
                })()}
              </span>
            </div>

            {/* 메모 / 학습 미리보기 */}
            <div style={{ display: "grid", gap: 6 }}>
            {c?.comment && (
  <div
    style={{
      fontSize: 11,
      color: "#374151",
      background: "transparent",   // ✅ 배경 제거
      borderRadius: 0,
      padding: 0,
      lineHeight: 1.4,
      fontWeight: 500,
    }}
  >
    🗒️{" "}
    {c.comment.length > 36      
      ? c.comment.slice(0, 28) + "…"
      : c.comment}
  </div>
)}
{c?.studyNote && (
  <div
    style={{
      fontSize: 11,
      color: "#374151",
      background: "transparent",   // ✅ 배경 제거
      borderRadius: 0,
      padding: 0,
      lineHeight: 1.4,
      fontWeight: 500,
    }}
  >
    📚{" "}
    {c.studyNote.length > 28
      ? c.studyNote.slice(0, 28) + "…"
      : c.studyNote}
  </div>
)}

              {/* 팝업 버튼 */}
              <button
                className="no-print"
                onClick={() =>
                  setMemoPopup({
                    date: ds,
                    comment: c?.comment || "",
                    studyNote: c?.studyNote || "",
                  })
                }
                style={{
                  padding: "2px 6px",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {c?.comment || c?.studyNote
                  ? "메모/학습 수정"
                  : "메모/학습 추가"}
              </button>
            </div>
          </td>
        );
      })}
    </tr>
  ))}
</tbody>
          </table>
        </div>

        {memoPopup && (
  <div className="no-print" onClick={() => setMemoPopup(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
    <div onClick={(e)=>e.stopPropagation()} style={{ width:420, maxWidth:"95vw", background:"#fff", borderRadius:10, padding:14, boxShadow:"0 10px 30px rgba(0,0,0,.2)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ fontWeight:800, fontSize:14 }}>🗓️ {memoPopup.date}</div>
        <button style={{ padding:"4px 8px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }} onClick={() => setMemoPopup(null)}>닫기</button>
      </div>

      {/* 코멘트 */}
      <div style={{ fontWeight:700, fontSize:12, color:"#374151", marginBottom:6 }}>🗒️ 오늘의 코멘트</div>
      <textarea
        value={memoPopup.comment}
        onChange={(e)=>setMemoPopup({ ...memoPopup, comment: e.target.value })}
        placeholder="오늘 태도/집중/컨디션 등"
        style={{ width:"100%", minHeight:80, border:"1px solid #dde1ea", borderRadius:8, padding:"8px 10px", resize:"vertical", fontSize:12, marginBottom:10 }}
      />

      {/* 학습 내용 */}
      <div style={{ fontWeight:700, fontSize:12, color:"#374151", marginBottom:6 }}>📚 학습 내용</div>
      <textarea
        value={memoPopup.studyNote}
        onChange={(e)=>setMemoPopup({ ...memoPopup, studyNote: e.target.value })}
        placeholder="과목/범위/페이지 등"
        style={{ width:"100%", minHeight:100, border:"1px solid #dde1ea", borderRadius:8, padding:"8px 10px", resize:"vertical", fontSize:12 }}
      />

      <div style={{ textAlign:"right", marginTop:10 }}>
        <button
          onClick={()=>{
            onSaveNotes(student.id, memoPopup.date, {
              comment: memoPopup.comment,
              studyNote: memoPopup.studyNote
            });
            setMemoPopup(null);
          }}
          style={{ border:"1px solid #111", background:"#111", color:"#fff", padding:"6px 10px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:800 }}
        >
          저장
        </button>
      </div>
    </div>
  </div>
)}
        
      </div>
    </div>
  );
}
