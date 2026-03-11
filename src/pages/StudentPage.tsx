// src/pages/StudentPage.tsx
import { useEffect, useState, useRef, useMemo } from "react";
import { db } from "../firebase";
import { collection, doc, getDocs, getDoc, setDoc } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import { calcNetStudyMin } from "../utils/studyCalc";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { arrayUnion } from "firebase/firestore";
import { ensureCheckInOnOpen } from "../utils/ensureCheckInOnOpen";


// 🔥 학생 기록을 두 구조(records + students/logs)에서 모두 읽어서 합치기
async function loadStudentRecords(studentId: string) {
  const results: any[] = [];

  // -----------------------------
  // ① 날짜 기반 records/<date> 구조 읽기
  // -----------------------------
  for (let i = 0; i < 60; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    const ref = doc(db, "records", dateStr);
    const snap = await getDoc(ref);

    if (!snap.exists()) continue;

    const data = snap.data() as any;
    if (!data[studentId]) continue;

    results.push({
      date: dateStr,
      ...data[studentId],
    });

  }



  // -----------------------------
  // ② 기존 students/<id>/logs 배열도 읽기
  // -----------------------------
  const studentRef = doc(db, "students", studentId);
const studentSnap = await getDoc(studentRef);

if (studentSnap.exists()) {
  const data = studentSnap.data() as any;

  // 🔒 그만둔 학생 차단
  if (data?.removed === true) {
    alert("현재 이용할 수 없는 학생 계정입니다.");
    return [];
  }

  if (Array.isArray(data.logs)) {
    data.logs.forEach((log: any) => {
      if (!results.some((r) => r.date === log.date)) {
        results.push(log);
      }
    });
  }
}

  // 🔥 아이폰 포함 전체 디바이스에서 내부망 체크 (무료, 안정적)
  results.sort((a, b) => (a.date > b.date ? 1 : -1));
  return results;
}

async function getPublicIP() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return data.ip;
  } catch (e) {

    return null;
  }
}

const allowedPublicIPs = [
  "175.215.126.",
];

async function isLocalNetwork() {
  const ip = await getPublicIP();
  if (!ip) return false;

  return allowedPublicIPs.some(prefix => ip.startsWith(prefix));
}

type SegmentType =
  | "MATH"
  | "ENGLISH"
  | "KOREAN"
  | "SCIENCE"
  | "OTHER_ACADEMY"
  | "MEAL"
  | "OUTING";

type Segment = {
  type: SegmentType;
  start: string;
  end?: string | null;

  meta?: {
    kind?: "ACADEMY" | "OUTING";
    expectedEnd?: string;
    academyName?: string;
  };

  createdAt?: any;   // ✅ meta 밖에 둘 거면 여기
};

const toMin = (hhmm?: string | null) => {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return h * 60 + mm;
};

const safeHM = (v: string) => {
  // 혹시 ISO가 섞이면 HH:MM로 변환
  if (v?.includes?.("T")) {
    const d = new Date(v);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return v;
};
function toDateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function getMonthStartKeyByEntry(
  viewYear: number,
  viewMonth: number,
  entryDate?: string | null
) {
  const monthStart = new Date(viewYear, viewMonth, 1);
  const entry = entryDate ? new Date(entryDate) : null;

  if (!entry || isNaN(entry.getTime())) {
    return toDateKey(monthStart);
  }

  const start = entry > monthStart ? entry : monthStart;
  return toDateKey(start);
}
// -----------------------------
// ③ 날짜 기준으로 정렬
// -----------------------------

export default function StudentPage() {

const formatHM = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;

  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
};
  const isMobile = window.innerWidth <= 480;

  const [students, setStudents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [verified, setVerified] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [passwordInput, setPasswordInput] = useState("");
  const [showSegModal, setShowSegModal] = useState(false);
const [activeSegType, setActiveSegType] = useState<SegmentType>("OTHER_ACADEMY");
const [segMemo, setSegMemo] = useState("");
const [dayDetail, setDayDetail] = useState<any | null>(null);
const [showDayModal, setShowDayModal] = useState(false);
const [todayRec, setTodayRec] = useState<any>(null);
const [toast, setToast] = useState<string | null>(null);
const loadTodayRec = async (studentId: string) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  const ref = doc(db, "records", dateStr);
  const snap = await getDoc(ref);
  const all = (snap.exists() ? snap.data() : {}) as any;
  setTodayRec(all?.[studentId] || null);
};

const CLOSE_HM = "23:00";

const hmToMin = (hm: string) => {
const [h, m] = hm.split(":").map(Number);
return h * 60 + m;
};
const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
};

const autoCloseAt2300 = async () => {
if (!selected?.id) return;

const n = nowHM();
if (hmToMin(n) < hmToMin(CLOSE_HM)) return;

// 오늘 기록 다시 읽어서 outTime 없으면 23:00 종료
const dateStr = new Date().toISOString().slice(0, 10);
const ref = doc(db, "records", dateStr);
const snap = await getDoc(ref);
const all = (snap.exists() ? snap.data() : {}) as any;
const cur = all?.[selected.id] || null;

if (!cur?.time || cur?.outTime) return;

await setDoc(ref, { [selected.id]: { ...cur, outTime: CLOSE_HM } }, { merge: true });
setTodayRec({ ...cur, outTime: CLOSE_HM }); // UI도 즉시 반영
};

  const [monthStats, setMonthStats] = useState<
    Record<string, { days: number; total: number }>
  >({});
  const [todayInTime, setTodayInTime] = useState<string | null>(null);
  const isTeacher = verified;
const EDU = {
  modalBg: "linear-gradient(180deg, #F8FBFF 0%, #EEF3FA 100%)",
  panel: "linear-gradient(180deg, #FFFFFF 0%, #F8FBFF 100%)",

  line: "rgba(15,23,42,0.08)",
  text: "#0F172A",
  sub: "#64748B",

  skySoft: "#DCEBFF",
  skyBorder: "#9CC3FF",

  primaryGrad: "linear-gradient(135deg, #6D83FF 0%, #7A6CFF 100%)",
  primaryShadow: "0 10px 22px rgba(109,131,255,0.22)",

  lavender: "#FFE4EC",

  neutralBg: "#F3F6FB",
  neutralText: "#1F2A44",
};
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const autoId = params.get("id");
  // 🔹 학생 전체 목록 로드
 useEffect(() => {
  const loadStudents = async () => {
    const snap = await getDocs(collection(db, "students"));

    const list = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((s: any) => !s.removed); // ✅ 숨김 학생 제외

    setStudents(list);
  };

  loadStudents();
}, []);

useEffect(() => {
  const savedSid = localStorage.getItem("educore_student_sid");
  if (!savedSid) return;
  if (!students?.length) return;

  const found = students.find((s:any)=>s.id===savedSid);

  if(found){
    setSelected(found);
  }

},[students])

useEffect(() => {
  if (autoId && students.length > 0) {
    const target = students.find((s) => s.id === autoId && !s.removed);
    if (target) handleSelectStudent(target);
  }
}, [students, autoId]);

  useEffect(() => {
  if (!verified || !selected?.id) return;

  autoCloseAt2300(); // 들어오자마자 1회
  const t = setInterval(autoCloseAt2300, 60 * 1000);
  return () => clearInterval(t);
}, [verified, selected?.id]);

const navigate = useNavigate();
  // 🔹 월간 통계 계산
  const calculateMonthlyStats = (logs: any[]) => {
    const map: Record<string, { days: number; total: number }> = {};
    logs.forEach((r) => {
      if (!r.date) return;
      const month = r.date.slice(0, 7);
      const study = calcNetStudyMin(r);
      if (!map[month]) map[month] = { days: 0, total: 0 };
      map[month].days += 1;
      map[month].total += study;
    });
    setMonthStats(map);
  };
const segLabelMap: Record<string, string> = {
  MATH: "수학",
  ENGLISH: "영어",
  KOREAN: "국어",
  SCIENCE: "과학",
  OTHER_ACADEMY: "기타학원",
  MEAL: "식사",
  OUTING: "외출",
};

// 날짜칸에서 쓰던 HH:MM / ISO 둘 다 안전하게 표시
const safeHM = (v: any) => {
  if (!v || typeof v !== "string") return null;
  if (v.includes("T")) {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  if (v.includes(":")) return v.slice(0, 5);
  return null;
};

  const getMonthSummary = (year: number, month: number) => {
    const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
    const list = records.filter(r => r.date.startsWith(ym));

    let P = 0, L = 0, A = 0;
    list.forEach(r => {

    });

    return { P, L, A, total: list.length };
  };


  // 🔥 학생 선택 시 Firestore에서 출결 로그 로드 (날짜 기반)
  const handleSelectStudent = async (student: any) => {
  if (student?.removed) {
    alert("현재 이용할 수 없는 학생 계정입니다.");
    return;
  }

  setSelected(student);
  setVerified(false);
  setPasswordInput("");
  setTodayInTime(null);

    // 1) 기록 불러오기
    let logs = await loadStudentRecords(student.id);

    // 🔥 입학일 있으면 그 이후만 (여기 추가)
    if (student.entryDate) {
      logs = logs.filter(r => r.date >= student.entryDate);
    }

    // 🔥 정렬 오름차순
    logs.sort((a, b) => (a.date > b.date ? 1 : -1));

    // 3) 달력에 전달
    setRecords(logs);

    calculateMonthlyStats(logs);

    // 시험기간 로드
    const testSnap = await getDocs(
      collection(db, "studyPlans", student.id, "tests")
    );
    setTestList(testSnap.docs.map((d) => d.data()));

    // 포커스
    setTimeout(() => {
      const el = document.getElementById("pw-input");
      el?.focus();
    }, 50);
  };


  // 🔥 StudentPage 전용 순공 계산 (HH:MM만 사용)
  // 🔥 StudentPage 전용 순공 계산 (HH:MM만 사용 + 학원 외출 시간 차감)
 
/*
const calcNetStudyMin_SP = (rec: any) => {
  const t1 = rec.time;
  const t2 = rec.outTime;
  if (!t1 || !t2) return 0;

  const toHM = (v: string) => {
    if (typeof v !== "string") return "";
    if (v.includes("T")) {
      const d = new Date(v);
      const hh = d.getHours();
      const mm = d.getMinutes();
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
    return v;
  };

  const toMin = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
  };

  const safeHM = (v: string) => toHM(v);

  const inHM = toHM(t1);
  const outHM = toHM(t2);

  let total = toMin(outHM) - toMin(inHM);
  if (total <= 0) return 0;

  const segs = Array.isArray(rec.segments) ? rec.segments : null;

  if (segs && segs.length > 0) {
    let external = 0;
    for (const s of segs) {
      if (!s?.start || !s?.end) continue;
      try {
        const st = toMin(safeHM(s.start));
        const en = toMin(safeHM(s.end));
        if (en > st) external += (en - st);
      } catch (e) {

      }
    }
    total -= external;
  } else {
    if (rec.academyIn && rec.academyOut) {
      try {
        const aIn = toMin(safeHM(rec.academyIn));
        const aOut = toMin(safeHM(rec.academyOut));
        if (aOut > aIn) total -= (aOut - aIn);
      } catch (e) {

      }
    }
  }

  return Math.max(0, total);
};
*/

// 🔹 비밀번호 인증
const verifyPassword = async () => {
  if (!selected?.id) return;

  const key = `pw_${selected.id}`;
  const saved = localStorage.getItem(key);

  // 1) 신규 비밀번호 등록
  if (!saved) {
    if (passwordInput.trim().length < 3) {
      alert("비밀번호를 3자리 이상 입력하세요.");
      return;
    }

    localStorage.setItem(key, passwordInput);
    alert("🔐 비밀번호가 설정되었습니다.");

    await loadTodayRec(selected.id);
    setVerified(true);
    return;
  }

  // 2) 기존 비밀번호 검증
  if (passwordInput !== saved) {
    alert("❌ 비밀번호가 올바르지 않습니다.");
    return;
  }

  await loadTodayRec(selected.id);
  setVerified(true);
};

const resetPassword = () => {
  if (!selected) return;

  const key = `pw_${selected.id}`;
  localStorage.removeItem(key);

  alert("🔄 비밀번호가 초기화되었습니다.");
  setPasswordInput("");
  setVerified(false);
};

  const year = new Date().getFullYear();
  const month = new Date().getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
const [viewMonth, setViewMonth] = useState(new Date().getMonth());

const monthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;

const monthStartKey = getMonthStartKeyByEntry(
  viewYear,
  viewMonth,
  selected?.entryDate
);

const monthRecords = useMemo(() => {
  return records.filter((r) => {
    if (!r.date?.startsWith(monthStr)) return false;
    return r.date >= monthStartKey;
  });
}, [records, monthStr, monthStartKey]);

  
const summary = useMemo(() => {
  let total = 0;
  monthRecords.forEach((r) => {
    total += calcNetStudyMin(r);
  });
  return { total, days: monthRecords.length };
}, [monthRecords]);

const avgPerDay =
  summary.days > 0 ? Math.round(summary.total / summary.days) : 0;

const alreadyIn = !!todayRec?.time && !todayRec?.outTime;

const yearlyMonthlyTotals = useMemo(() => {
  if (!records.length) return [];

  const year = viewYear; // ✅ 보고있는 연도 기준(원하면 now.getFullYear()로 바꿔도 됨)
  const entryKey = selected?.entryDate || null;

  const result: { month: number; total: number }[] = [];

  for (let m = 1; m <= 12; m++) {
    const mStr = `${year}-${String(m).padStart(2, "0")}`;
    const startKey = getMonthStartKeyByEntry(year, m - 1, entryKey);

    const list = records.filter((r) => {
      if (!r.date?.startsWith(mStr)) return false;
      return r.date >= startKey;
    });

    let total = 0;
    list.forEach((r) => {
      total += calcNetStudyMin(r);
    
    });

    result.push({ month: m, total });
  }

  return result;
}, [records, selected?.entryDate, viewYear]);

const entryMonth = selected?.entryDate
  ? new Date(selected.entryDate).getMonth() + 1
  : null;



// ✅ 여기(바로 아래) 붙여넣어


  const [showTestModal, setShowTestModal] = useState(false);
  const [testTitle, setTestTitle] = useState("");
  const [testStart, setTestStart] = useState("");
  const [testEnd, setTestEnd] = useState("");
  const [testMemo, setTestMemo] = useState("");

  const [testList, setTestList] = useState<any[]>([]);

  const saveTestPeriod = async () => {
    if (!selected) return;

    const ref = doc(collection(db, "studyPlans", selected.id, "tests"));
    await setDoc(ref, {
      title: testTitle,
      start: testStart,
      end: testEnd,
      memo: testMemo,
    });

    alert("시험기간이 저장되었습니다!");
    setShowTestModal(false);

    // 저장 후 다시 불러오기
    const testSnap = await getDocs(
      collection(db, "studyPlans", selected.id, "tests")
    );
    setTestList(testSnap.docs.map((d) => d.data()));
  };

  const goStudyPlan = () => {
  if (!selected) return alert("학생을 먼저 선택하세요.");
  window.open(`/study-plan/${selected.id}`, "_blank");
};

  // 🔥 학생용 checkIn: App 구조로 저장

  const checkIn = async () => {
    const ok = await isLocalNetwork();
    if (!ok) {
      alert("⚠️ 학원 Wi-Fi 연결 후 체크해주세요!");
      return;
    }

    if (!selected) return;

    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);
    const today = new Date().toISOString().slice(0, 10);

    await saveAppStyleCheckIn(selected.id, hhmm);

    setRecords((prev) => {
      const withoutToday = prev.filter((r) => r.date !== today);
      const existing = prev.find((r) => r.date === today) || {};
      return [
        ...withoutToday,
        {
          ...existing,
          date: today,
          time: hhmm,
        },
      ];
    });

    setTodayInTime(now.toISOString());
    alert("✅ 등원 처리 완료");
  };

  // 🔥 App 스타일 등원 저장
  async function saveAppStyleCheckIn(studentId: string, time: string) {
    const date = new Date().toISOString().slice(0, 10);
    const ref = doc(db, "records", date);

    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() as any) : {};
    const prev = data[studentId] || {};

    const ip = await getPublicIP(); // 🔥 IP 가져오기

    await setDoc(
      ref,
      {
        [studentId]: {
          ...prev,
          time,
          outTime: prev.outTime ?? null,
          ip: ip || null,              // 🔥 IP 저장
          device: navigator.userAgent, // 🔥 기기 정보 저장
        },
      },
      { merge: true }
    );
  }

const startSegment = async (type: SegmentType) => {
  const ok = await isLocalNetwork();
  if (!ok) return alert("⚠️ 학원 Wi-Fi 연결 후 체크해주세요!");
  if (!selected) return;

  const hhmm = new Date().toTimeString().slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);

  const segs = await toggleSegment(selected.id, type, hhmm);

  setRecords((prev) => {
    const exists = prev.find((r) => r.date === today) || {};
    const withoutToday = prev.filter((r) => r.date !== today);
    return [...withoutToday, { ...exists, date: today, segments: segs }];
  });

  setShowSegModal(false);
};

  // 🔹 학생용 하원 처리 
  const checkOut = async () => {
    const ok = await isLocalNetwork();
    if (!ok) {
      alert("⚠️ 학원 Wi-Fi 연결 후 체크해주세요!");
      return;
    }

    if (!selected) return;

    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);
    const today = new Date().toISOString().slice(0, 10);

    const todayLog = records.find((r) => r.date === today);

    if (!todayLog || !todayLog.time) {
      alert("등원 기록이 없습니다.");
      return;
    }
    if (todayLog.outTime) {
      alert("이미 하원한 학생입니다.");
      return;
    }

    await saveAppStyleCheckOut(selected.id, hhmm);

    setRecords((prev) =>
      prev.map((r) =>
        r.date === today ? { ...r, outTime: hhmm } : r
      )
    );

    alert("👋 하원 처리 완료!");
  };
const startAcademyOuting = async (academyName: string, expectedEnd: string) => {
  const ok = await isLocalNetwork();
  if (!ok) return alert("⚠️ 학원 Wi-Fi 연결 후 체크해주세요!");
  if (!selected) return;

  const hhmm = new Date().toTimeString().slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);

  const segs = await toggleSegment(
    selected.id,
    "OUTING",
    hhmm,
    { kind: "ACADEMY", academyName, expectedEnd }
  );

  setRecords((prev) => {
    const exists = prev.find((r) => r.date === today) || {};
    const withoutToday = prev.filter((r) => r.date !== today);
    return [...withoutToday, { ...exists, date: today, segments: segs }];
  });
};

const endSegment = async () => {
  const ok = await isLocalNetwork();
  if (!ok) return alert("⚠️ 학원 Wi-Fi 연결 후 체크해주세요!");
  if (!selected) return;

  const hhmm = new Date().toTimeString().slice(0, 5);
  const date = new Date().toISOString().slice(0, 10);
  const ref = doc(db, "records", date);

  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : {};
  const prev = data[selected.id] || {};
  const segments: any[] = Array.isArray(prev.segments) ? [...prev.segments] : [];

  if (segments.length === 0) {
    alert("종료할 활동이 없습니다.");
    return;
  }

  const last = segments[segments.length - 1];
  if (!last || last.end) {
    alert("이미 종료된 상태입니다.");
    return;
  }

  if (last.start === hhmm) {
    alert("너무 빠르게 눌렀어요. 잠시 후 다시 시도해 주세요.");
    return;
  }

  segments[segments.length - 1] = { ...last, end: hhmm };
  // ✅ 세그먼트 닫은 직후
const closed = segments[segments.length - 1]; // 닫힌 세그먼트(=last의 end가 채워진 버전)

let returnLate = false;
let returnLateMin = 0;
let lastReturnExpected: string | null = null;

// ✅ "학원 외출(OUTING)" 세그먼트 + meta.kind === "ACADEMY" 일 때만 판정
if (closed?.type === "OUTING" && closed?.meta?.kind === "ACADEMY") {
  const expected = closed?.meta?.expectedEnd ?? null;
  lastReturnExpected = expected;

  const a = toMin(hhmm);
  const e = toMin(expected);

  if (a != null && e != null) {
    const diff = a - e;
    returnLate = diff > 15;
    returnLateMin = Math.max(0, diff);
  }
}

  const ip = await getPublicIP();

 await setDoc(
  ref,
  {
    [selected.id]: {
      ...prev,
      segments,
      segUpdatedAt: new Date().toISOString(),
      segUpdatedIP: ip || null,
      segUpdatedDevice: navigator.userAgent,

      // ✅ 복귀지각 기록
      returnLate: returnLate ? true : prev.returnLate ?? false,
      returnLateMin: returnLate ? returnLateMin : prev.returnLateMin ?? 0,
      lastReturnExpected: lastReturnExpected ?? prev.lastReturnExpected ?? null,
    },
  },
  { merge: true }
);

  // 화면 state 반영
  const today = date;
  setRecords((prevState) => {
    const exists = prevState.find((r) => r.date === today) || {};
    const withoutToday = prevState.filter((r) => r.date !== today);
    return [...withoutToday, { ...exists, date: today, segments }];
  });

  setShowSegModal(false);
  alert("✅ 활동 종료 기록 완료");
};

  // 🔹 학원등원  (학원 가기)
  const academyIn = async () => {
  const ok = await isLocalNetwork();
  if (!ok) return alert("⚠️ 학원 Wi-Fi 연결 후 체크해주세요!");
  if (!selected) return;

  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);

  // ✅ segments 토글 저장 (이전 활동 자동 종료 + 새 활동 시작)
  const segs = await toggleSegment(selected.id, "OTHER_ACADEMY", hhmm);

  // (선택) 호환용 기존 필드도 남겨두고 싶으면 주석 해제
  // await saveAcademyIn(selected.id, hhmm);

  // 화면 state도 segments로 반영
  setRecords((prev) => {
    const exists = prev.find((r) => r.date === today) || {};
    const withoutToday = prev.filter((r) => r.date !== today);
    return [...withoutToday, { ...exists, date: today, segments: segs }];
  });

  alert("✅ 활동 시작 기록 완료");
};
  // 🔹 학원 하원 (학원 끝나고 복귀)
  const academyOut = async () => {
  const ok = await isLocalNetwork();
  if (!ok) return alert("⚠️ 학원 Wi-Fi 연결 후 체크해주세요!");
  if (!selected) return;

  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);

  // 오늘 등원/세션이 없으면 막기 (원하면 유지)
  const todayLog = records.find((r) => r.date === today);
  if (!todayLog || !todayLog.time) {
    alert("등원 기록이 없습니다.");
    return;
  }

  // ✅ '열려있는 세그먼트'를 hhmm으로 닫기만
  const date = new Date().toISOString().slice(0, 10);
  const ref = doc(db, "records", date);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : {};
  const prev = data[selected.id] || {};
  const segments: any[] = Array.isArray(prev.segments) ? [...prev.segments] : [];

  if (segments.length === 0) {
    alert("종료할 활동이 없습니다.");
    return;
  }

  const last = segments[segments.length - 1];
  if (!last || last.end) {
    alert("이미 종료된 상태입니다.");
    return;
  }

  if (last.start === hhmm) {
    alert("너무 빠르게 눌렀어요. 잠시 후 다시 시도해 주세요.");
    return;
  }

  segments[segments.length - 1] = { ...last, end: hhmm };

 const ip = await getPublicIP();

await setDoc(
  ref,
  {
    [selected.id]: {
      ...prev,
      segments,
      segUpdatedAt: new Date().toISOString(),
      segUpdatedIP: ip || null,
      segUpdatedDevice: navigator.userAgent,
    },
  },
  { merge: true }
);

  // (선택) 호환용 기존 필드도 저장하려면 주석 해제
  // await saveAcademyOut(selected.id, hhmm);

  setRecords((prevState) => {
    const exists = prevState.find((r) => r.date === today) || {};
    const withoutToday = prevState.filter((r) => r.date !== today);
    return [...withoutToday, { ...exists, date: today, segments }];
  });

  alert("✅ 활동 종료 기록 완료");
};

  async function saveAppStyleCheckOut(studentId: string, time: string) {
  const date = new Date().toISOString().slice(0, 10);
  const ref = doc(db, "records", date);

  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : {};
  const prev = data[studentId] || {};

  const ip = await getPublicIP();

  // ✅ 열린 세그먼트가 있으면 하원 시간으로 닫기
  const segments: Segment[] = Array.isArray(prev.segments) ? [...prev.segments] : [];
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last && !last.end && last.start !== time) {
      segments[segments.length - 1] = { ...last, end: time };
    }
  }

  await setDoc(
    ref,
    {
      [studentId]: {
        ...prev,
        time: prev.time ?? null,
        outTime: time,
        segments, // ✅ 같이 저장
        outIP: ip || null,
        outDevice: navigator.userAgent,
      },
    },
    { merge: true }
  );
}


  // 🔥 학원 등원 저장
 async function toggleSegment(
  studentId: string,
  type: SegmentType,
  nowHM: string,
  meta?: Segment["meta"]
) {
  const date = new Date().toISOString().slice(0, 10);
  const ref = doc(db, "records", date);

  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : {};
  const prev = data[studentId] || {};

  const segments: Segment[] = Array.isArray(prev.segments) ? [...prev.segments] : [];

  // 1) 열려있는 세그먼트(끝이 없는 것) 있으면 종료
  const lastIdx = [...segments].reverse().findIndex((s) => !s.end);
  if (lastIdx !== -1) {
    const realIdx = segments.length - 1 - lastIdx;
    // 같은 시간으로 시작/종료 되면 무시(연타 방지)
    if (segments[realIdx].start !== nowHM) {
      segments[realIdx] = { ...segments[realIdx], end: nowHM };
    }
  }

  // 2) 새 세그먼트 시작 (연타 방지: 마지막이 동일 타입+동일 start면 추가 안함)
  const last = segments[segments.length - 1];
    if (!(last && last.type === type && last.start === nowHM)) {
    segments.push({ type, start: nowHM, end: null });
  }

  const ip = await getPublicIP();
try {
  await setDoc(
    ref,
    {
      [studentId]: {
        ...prev,
        segments,
        segUpdatedAt: new Date().toISOString(),
        segUpdatedIP: ip || null,
        segUpdatedDevice: navigator.userAgent,
      },
    },
    { merge: true }
  );
} catch(e){

}
  return segments;
}

  // 🔹 그래프 데이터
  const chartData = records
    .slice()
    .reverse()
    .map((r) => ({
      date: r.date,
      study: Math.round(calcNetStudyMin(r))
    }));

  const avgStudy =
    chartData.length > 0
      ? chartData.reduce((acc, cur) => acc + cur.study, 0) / chartData.length
      : 0;

  // ⚡ 이번 달 실제 결석일 계산 (일요일 제외)  
  // ⚡ 이번 달 실제 결석일 계산 (일요일 제외 + 20일부터)
  const realAbsences = (() => {
    const y = viewYear;
    const m = viewMonth + 1;

    const monthStr = `${y}-${String(m).padStart(2, "0")}`;

    const presentDays = new Set(
      records.filter(r => r.date.startsWith(monthStr) && (r.time ?? r.inTime))
        .map(r => r.date)
    );

    const today = new Date().getDate();
    let count = 0;

    // 🔥 이번 달은 20일부터 결석 카운팅
    for (let day = 20; day <= today; day++) {
      const dateStr = `${monthStr}-${String(day).padStart(2, "0")}`;
      const dow = new Date(dateStr).getDay();

      if (dow === 0) continue;          // ❌ 일요일 제외  
      if (presentDays.has(dateStr)) continue; // ❌ 출석한 날 제외  

      count++;
    }

    return count;
  })();


  const filteredRecordsThisMonth = monthRecords;
  const calendarRef = useRef<HTMLDivElement | null>(null);

  // 📅 프리미엄 달력 컴포넌트 (전체 교체)
  const renderCalendar = () => {
    if (!records.length)
      return <p style={{ color: "#aaa" }}>출결 데이터 없음</p>;

    const year = viewYear;
    const month = viewMonth;

    const lastDay = new Date(year, month + 1, 0).getDate();

    // 🟦 추가: 이번 달 1일의 요일 (0=일요일)
    const firstDayOfWeek = new Date(year, month, 1).getDay();

    // 🟦 추가: 앞쪽 빈칸 생성
    const blanks = Array(firstDayOfWeek).fill(null);

    return (
      <div style={{ animation: "fadeIn 0.3s ease" }}>

        {/* ===== 헤더 ===== */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 14,
            gap: 16,
          }}
        >
          <button
            onClick={() => {
              if (month === 0) {
                setViewMonth(11);
                setViewYear(year - 1);
              } else setViewMonth(month - 1);
            }}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              cursor: "pointer",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: 16,
              transition: "0.2s",
            }}
          >
            ←
          </button>

          <h4
            style={{
              margin: 0,
              color: "#1e3a8a",
              fontWeight: 800,
              fontSize: 16,
              textAlign: "center",
              minWidth: 140,
            }}
          >
            📅 {year}-{String(month + 1).padStart(2, "0")}
          </h4>

          <button
            onClick={() => {
              if (month === 11) {
                setViewMonth(0);
                setViewYear(year + 1);
              } else setViewMonth(month + 1);
            }}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              cursor: "pointer",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: 16,
              transition: "0.2s",
            }}
          >
            →
          </button>
        </div>

        {/* 🟦 추가: 요일 헤더 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            textAlign: "center",
            marginBottom: 8,
            color: "#555",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>

        {/* ===== 날짜 박스 ===== */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
          }}
        >

          {/* 🟦 추가: 빈칸 먼저 채우기 */}
          {blanks.map((_, i) => (
            <div key={"blank" + i}></div>
          ))}

          {/* 기존 날짜 렌더링 */}
          {[...Array(lastDay)].map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(
              2,
              "0"
            )}-${String(day).padStart(2, "0")}`;

            const dow = new Date(dateStr).getDay();
            const log = records.find((r) => r.date === dateStr);
            const isTestDay = testList.some(
              (t) => dateStr >= t.start && dateStr <= t.end
            );

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


            // 날짜 박스 안 inTime 표시
            let inTimeLabel = null;

            if (log) {
              const raw = log.time ?? log.inTime;   // ★★★ 반드시 이렇게
              if (typeof raw === "string") {
                if (raw.includes("T")) {
                  const d = new Date(raw);
                  if (!isNaN(d.getTime())) {
                    inTimeLabel = d.toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  }
                } else if (raw.includes(":")) {
                  inTimeLabel = raw;
                }
              }
            }

            // 날짜 박스 안 outTime 표시
            let outTimeLabel = null;

            if (log) {
              const rawOut = log.outTime;
              if (typeof rawOut === "string") {
                if (rawOut.includes("T")) {
                  const d = new Date(rawOut);
                  if (!isNaN(d.getTime())) {
                    outTimeLabel = d.toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  }
                } else if (rawOut.includes(":")) {
                  outTimeLabel = rawOut;
                }
              }
            }

            // 학원 등하원 라벨
            let academyLabel = null;
            if (log && log.academyIn && log.academyOut) {
              academyLabel = `${log.academyIn}~${log.academyOut}`;
            }
          
// ✅ segments 과목+시간 라벨
let segmentsLabel: string | null = null;

if (log && Array.isArray(log.segments) && log.segments.length > 0) {
  const labelMap: Record<string, string> = {
    MATH: "수학",
    ENGLISH: "영어",
    KOREAN: "국어",
    SCIENCE: "과학",
    OTHER_ACADEMY: "기타",
    MEAL: "식사",
    OUTING: "외출",
  };

  // ✅ 우선순위: 진행중(open) 1개 → 없으면 완료(done) 1개
  const openOne = log.segments.find((s: any) => s?.start && !s?.end);
  const doneOne = log.segments.find((s: any) => s?.start && s?.end);

  const pick = openOne ?? doneOne;

  if (pick) {
    const label = labelMap[pick.type] ?? pick.type;
    segmentsLabel = label;
  }
}


           return (
  <div
    key={dateStr}
    onClick={() => {
      if (!log) return;
      setDayDetail({ date: dateStr, ...log });
      setShowDayModal(true);
    }}
    style={{
      height: "auto",
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
      transition: "0.2s",
      cursor: log ? "pointer" : "default",
      opacity: log ? 1 : 0.9,
    }}
  >
                <div>{day}</div>

                {inTimeLabel && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 10,
                      color: "#1d4ed8",
                      fontWeight: 700,
                      width: "100%",
                      textAlign: "center",
                      lineHeight: "1.1",
                    }}
                  >
                    {inTimeLabel}
                  </div>
                )}

                {outTimeLabel && (
                  <div
                    style={{
                      marginTop: 1,
                      fontSize: 10,
                      color: "#b91c1c",
                      fontWeight: 700,
                      width: "100%",
                      textAlign: "center",
                      lineHeight: "1.1",
                    }}
                  >
                    {outTimeLabel}
                  </div>
                )}

                {/* 🔥 여기 추가! */}
                {academyLabel && (
                  <div
                    style={{
                      marginTop: 1,
                      fontSize: 9,
                      color: "#4b5563",
                      width: "100%",
                      textAlign: "center",
                      lineHeight: "1.1",
                    }}
                  >
                    {academyLabel}
                  </div>
                )}
               {segmentsLabel && (
  <div
    style={{
      marginTop: 4,
      fontSize: 10,
      color: "#0d2350",
      fontWeight: 800,
      width: "100%",
      textAlign: "center",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      background: "rgba(174,214,233,0.55)", // 너 쓰는 톤
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
  return (
    <div
      style={{
        maxWidth: isMobile ? "100%" : 860,
        margin: isMobile ? "20px auto" : "40px auto",
        padding: isMobile ? "20px 16px" : "40px 32px",
        background: "#fff",
        borderRadius: 20,
        boxShadow: "0 8px 22px rgba(15,23,42,0.12)",
        fontFamily: "Pretendard, 'Noto Sans KR', system-ui",
      }}
      
    >
        {showSegModal && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(15,23,42,0.28)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
      padding: 16,
    }}
    onClick={() => setShowSegModal(false)}
  >
    <div
      style={{
        width: "min(560px, 100%)",
        background: EDU.modalBg,
        borderRadius: 20,
        border: `1px solid ${EDU.line}`,
        boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
        padding: 20,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 내부 패널 */}
      <div
        style={{
          background: EDU.panel,
          borderRadius: 18,
          border: `1px solid ${EDU.line}`,
          boxShadow: "0 14px 32px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.04)",
          padding: 18,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 900, color: EDU.text }}>
          나의 루틴 기록
        </div>

        <div style={{ fontSize: 12, color: EDU.sub, marginTop: 6 }}>
          버튼을 눌러 자신의 루틴을 관리하세요.
        </div>

        {/* 과목/활동 선택 */}
        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 10,
          }}
        >
          {[
            ["ENGLISH", "영어"],
            ["MATH", "수학"],
            ["KOREAN", "국어"],
            ["SCIENCE", "과학"],
            ["OTHER_ACADEMY", "기타"],
            ["MEAL", "식사"],
            ["OUTING", "외출"],
          ].map(([key, label]) => (
            <button
  key={key}
  onClick={() => setActiveSegType(key as SegmentType)}
  style={{
    padding: "12px 10px",
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.06)",
    background:
      activeSegType === key
        ? "#D6E6FF"
        : "#F7F9FD",
    color: "#0F172A",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow:
      activeSegType === key
        ? "0 10px 22px rgba(92,140,255,0.22)"
        : "0 4px 10px rgba(15,23,42,0.05)",
    transition: "all 0.15s ease",
  }}
>
  {label}
</button>
          ))}
        </div>

        {/* 메모 */}
        <textarea
          value={segMemo}
          onChange={(e) => setSegMemo(e.target.value)}
          placeholder="메모 (선택)"
          style={{
            marginTop: 16,
            width: "100%",
            minHeight: 70,
            borderRadius: 14,
            border: `1px solid ${EDU.line}`,
            padding: 12,
            fontSize: 13,
            outline: "none",
            background: "#F9FBFF",
          }}
        />

        {/* 하단 버튼 */}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          {/* 학원 가기 = 시작 기록 */}
          <button
  onClick={() => startSegment(activeSegType)}
  style={{
    flex: 1,
    height: 46,
    borderRadius: 16,
    border: "none",
    background: "#CFE4FF",
    color: "#092a56",
    fontWeight: 900,
    boxShadow: "0 10px 24px rgba(80,120,255,0.20)",
    cursor: "pointer",
  }}
>
  학원 출발
</button>

          {/* 에듀코어 복귀 = 종료 기록 */}
          <button
            onClick={academyOut} // ✅ 너 코드에 있는 종료 함수(복귀)
            style={{
              flex: 1,
              height: 46,
              borderRadius: 16,
              border: "none",
              background: EDU.lavender,
              color: "#7A1D3E",
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: "0 8px 18px rgba(214, 51, 108, 0.18)",
            }}
          >
            에듀코어 복귀
          </button>

          <button
  onClick={() => setShowSegModal(false)}
  style={{
    flex: 1,
    height: 46,
    borderRadius: 16,
    border: "none",
    background: "#E3E8F1",
    color: "#1F2A44",
    fontWeight: 900,
    boxShadow: "0 6px 16px rgba(15,23,42,0.08)",
    cursor: "pointer",
  }}
>
  닫기
</button>
        </div>
      </div>
    </div>
  </div>
)}
  {showDayModal && dayDetail && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10000, // segModal보다 위/아래는 취향 (지금은 더 위)
      padding: 16,
    }}
    onClick={() => setShowDayModal(false)}
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
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#111827" }}>
            📅 {dayDetail.date}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            등원/하원 + 활동 기록
          </div>
        </div>

        <button
          onClick={() => setShowDayModal(false)}
          style={{
            border: "1px solid #e5e7eb",
            background: "#ccc9c9",
            borderRadius: 10,
            padding: "8px 10px",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          닫기
        </button>
      </div>

      {/* 등원/하원 */}
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
          <div style={{ fontSize: 12, color: "#1e3a8a", fontWeight: 900 }}>등원</div>
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
          <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 900 }}>하원</div>
          <div style={{ fontSize: 14, fontWeight: 900, marginTop: 4 }}>
            {safeHM(dayDetail.outTime) ?? "-"}
          </div>
        </div>
      </div>

      {/* 활동 목록 */}
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
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
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
                  <div style={{ fontWeight: 900, color: "#111827" }}>{label}</div>
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
    </div>
  </div>
)}
    
      
    {/* ===== PREMIUM BRAND HEADER (Signature Wine Red) ===== */}
<div
  style={{
    textAlign: "center",
    paddingBottom: isMobile ? 18 : 26,
    borderBottom: "1px solid rgba(15,23,42,0.08)",
    marginBottom: isMobile ? 22 : 32,
  }}
>
  {/* 로고 라인 */}
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "baseline",
      gap: 8,
      flexWrap: "wrap",
    }}
  >
    <span
      style={{
        fontSize: isMobile ? 30 : 44,
        fontWeight: 900,
        letterSpacing: 2,
        color: "#8B1E1E", // 🔥 와인톤 (기존보다 고급)
      }}
    >
      OPTIMUM
    </span>

    <span
      style={{
        fontSize: isMobile ? 30 : 44,
        fontWeight: 900,
        letterSpacing: 2,
        color: "#1d3d86", // 딥네이비
      }}
    >
      EDUCORE
    </span>
  </div>

  {/* 슬로건 */}
<span
  style={{
    marginTop: isMobile ? 4 : 0,
    marginLeft: isMobile ? 0 : 10,
    color: "#B8962E",          // 고급 골드 유지
    fontSize: isMobile ? 12 : 18,
    fontStyle: "normal",       // ✅ italic 제거
    fontWeight: 700,           // 600→700 살짝 힘 주면 고급
    textAlign: "center",
    lineHeight: 1.2,
    letterSpacing: 0.4,        // ✅ 약간만 주면 더 프리미엄
  }}
>
  Design the Routine, Own the Result
</span>
<div
  style={{
    width: isMobile ? 120 : 240,
    height: 1,
    margin: "10px auto 6px",
    background: "linear-gradient(90deg, rgba(184,150,46,0.1), rgba(184,150,46,0.6), rgba(184,150,46,0.1))",
  }}
/>
  {/* 서브 설명 */}
  <div
    style={{
      marginTop: 12,
      fontSize: isMobile ? 10 : 12,
      fontWeight: 600,
      letterSpacing: 1.8,
      color: "#64748B",
    }}
  >
    ROUTINE & STUDY MANAGEMENT
  </div>
</div>
      {/* ===== 검색 입력 ===== */}
      <input
        type="text"
        placeholder="이름을 입력하세요"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setSelected(null);
          setVerified(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const list = students.filter((s) =>
  !s.removed &&
  (s?.name ?? "")
    .toLowerCase()
    .includes(search.toLowerCase())
);

            if (list.length > 0) {
              handleSelectStudent(list[0]); // 🔥 첫 번째 검색 결과 자동 선택
            }
          }
        }}
        style={{
          width: "100%",
          padding: "13px 14px",
          borderRadius: 10,
          border: "1px solid #d1d5db",
          fontSize: 15,
          outline: "none",
          background: "#f9fafb",
          marginBottom: 18,
        }}
      />

      {/* 검색 안내 문구 */}
      {!selected && !search && (
        <p
          style={{
            textAlign: "center",
            color: "#9ca3af",
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          🔍 이름을 입력하면 본인 출결·순공 현황을 확인할 수 있습니다.
        </p>
      )}


      {/* ===== 검색 결과 리스트 ===== */}
      {!selected && search && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
         {students
  .filter((s) =>
    !s.removed &&
    (s?.name ?? "")
      .toString()
      .toLowerCase()
      .includes(search.toLowerCase())
  )
            .map((s) => (
              <div
                key={s.id}
                onClick={() => handleSelectStudent(s)}
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  transition: "background 0.15s, transform 0.1s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#eff6ff";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#f9fafb";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div>
                  <strong style={{ color: "#111827" }}>{s.name}</strong>
                  <span
                    style={{
                      color: "#6b7280",
                      fontSize: 13,
                      marginLeft: 6,
                    }}
                  >
                    {s.grade}
                    {s.school ? ` · ${s.school}` : ""}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: "#2563eb",
                    fontWeight: 600,
                  }}
                >
                  상세보기 →
                </span>
              </div>
            ))}
        </div>
      )}


      {/* ===== 비밀번호 인증 단계 ===== */}
      {selected && !verified && (
        <div
          style={{
            marginTop: 26,
            padding: "22px 20px",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            background:
              "linear-gradient(135deg, rgba(239,246,255,0.9), rgba(248,250,252,0.95))",
          }}
        >

          <h3
            style={{
              margin: "0 0 6px 0",
              fontSize: 18,
              color: "#1e3a8a",
            }}
          >
            {selected.name} 학생
          </h3>
          <p
            style={{
              margin: "0 0 14px 0",
              fontSize: 13,
              color: "#6b7280",
            }}
          >
            처음 접속하는 경우, 입력한 비밀번호가 이 기기의 개인 비밀번호로
            저장됩니다.
          </p>

          <input
            id="pw-input"
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                verifyPassword();   // 🔥 엔터 → 인증 실행
              }
            }}
            placeholder="비밀번호를 입력하세요"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              marginBottom: 10,
              fontSize: 14,
              outline: "none",
            }}
          />
          <div
            style={{
              display: "flex",
              gap: 6,
              marginTop: 16,
              width: "100%",
            }}
          >
            {/* 확인 */}
            <button
              onClick={verifyPassword}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 8,
                border: "1px solid #2563eb",
                background: "#ffffff",
                color: "#1e40af",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              확인
            </button>

            {/* 취소 */}
            <button
              onClick={() => {
                setSelected(null);
                setVerified(false);
                setPasswordInput("");
              }}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#ffffff",
                color: "#374151",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              취소
            </button>

            {/* 초기화 */}
            <button
              onClick={resetPassword}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 8,
                border: "1px solid #ef4444",
                background: "#ffffff",
                color: "#b91c1c",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              초기화
            </button>

          </div>
        </div>
      )}

      {/* ===== 인증 후 메인 대시보드 ===== */}
      {selected && verified && (
        <>
         {/*} {isTeacher && (
            <button
              onClick={() => setShowTestModal(true)}
              style={{
                marginBottom: 16,
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid #CBD5E1",
                background: "#EEF2FF",
                fontSize: 13,
                fontWeight: 700,
                color: "#1E3A8A",
                cursor: "pointer",
                display: "block",
                marginLeft: "auto",
              }}
            >
              📘 시험기간 추가
            </button>
          )} /*}
          {/* 상단: 학생 정보 + 오늘 등원 정보 + 등/하원 버튼 */}
          <div
            style={{
              marginTop: 26,
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "minmax(0, 1fr) minmax(0, 1fr)",
              gap: isMobile ? 12 : 16,
              alignItems: "stretch",
            }}
          >
           {/* 학생 기본 정보 카드 */}
 <div
              style={{
                padding: "16px 16px",
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                height: "100%",
              }}
            >
  <h3
    style={{
      margin: "0 0 6px 0",
      fontSize: 18,
      color: "#1e3a8a",
    }}
  >
    {selected.name} 학생
  </h3>

  <p
    style={{
      margin: "0 0 4px 0",
      fontSize: 14,
      color: "#374151",
    }}
  >
    학년: {selected.grade || "-"}
  </p>

  {selected.school && (
    <p
      style={{
        margin: "0 0 4px 0",
        fontSize: 14,
        color: "#374151",
      }}
    >
      학교: {selected.school}
    </p>
  )}

  
 {/* 상단 문구 */}
  <div style={{ textAlign: "center", marginBottom: 14 }}>
    <div
      style={{
        fontSize: 14,
        color: "#505156",
        letterSpacing: 0.3,
      }}
    >
      오늘의 시작은 [등원], 마무리는 [하원]입니다.
    </div>
  </div>

  {/* 등원 / 하원 버튼 */}
  <div
    style={{
      display: "flex",
      gap: 12,
      marginBottom: 18,
    }}
  >
 <button
  disabled={alreadyIn}   // 🔥 여기 추가
  onClick={checkIn}
  style={{
    flex: 1,
    height: 50,
    borderRadius: 16,
    border: "1px solid #E8EDFF",
    background: alreadyIn ? "#ccc" : "#E8EDFF",   // 🔥 회색 처리
    color: "#1E3A8A",
    fontWeight: 900,
    fontSize: 15,
    cursor: alreadyIn ? "not-allowed" : "pointer",  // 🔥 커서 변경
    transition: "all 0.2s ease",
  }}
>
  에듀코어등원
</button>
{toast && (
  <div style={{
    position: "fixed",
    left: "50%",
    bottom: 24,
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.75)",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: 13,
    zIndex: 9999,
  }}>
    {toast}
  </div>
)}
    <button
      onClick={checkOut}
      style={{
        flex: 1,
        height: 50,
        borderRadius: 16,
        border: "1px solid #FFE8EA",
        background: "#FFE8EA",
        color: "#9F1239",
        fontWeight: 900,
        fontSize: 15,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
    >
      에듀코어하원
    </button>
  </div>

  {/* 중간 안내 */}
  <div style={{ textAlign: "center", marginBottom: 12 }}>
    <div
      style={{
        fontSize: 13,
        color: "#505156",
        letterSpacing: 0.3,
      }}
    >
      [나의루틴기록]에서 학원,식사,외출을 기록합니다.
    </div>
  </div>

  {/* 루틴 버튼 */}
 
   <button
  onClick={() => setShowSegModal(true)}
  style={{
    width: "100%",
    height: 50,
    borderRadius: 16,
    border: "none",
    background: "linear-gradient(135deg, #dbeafe 0%, #c7ddff 100%)",
    color: "#0b1f3a",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: 0.5,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(59,130,246,0.18)",
    marginBottom: 18,
    transition: "all 0.2s ease",
  }}
>
  나의 루틴 기록
</button>
  
{/* 중간 안내 */}
  <div style={{ textAlign: "center", marginBottom: 12 }}>
    <div
      style={{
        fontSize: 13,
        color: "#505156",
        letterSpacing: 0.3,
      }}
    >
    [오늘의 과제]에서 선생님의 과제를 확인합니다.
    </div>
  </div>
  {/* 데일리 스터디 버튼 */}
  <button
    onClick={goStudyPlan}
    style={{
      width: "100%",
      height: 50,
      borderRadius: 16,
      border: "1px solid #E8EDFF",
     background: "linear-gradient(135deg, #f7e9c4 0%, #f1dcaa 100%)",
      color: "#5c4712",
      boxShadow: "0 10px 22px rgba(190,160,90,0.18)",
      fontSize: 15,
      fontWeight: 900,
      letterSpacing: 0.5,
      cursor: "pointer",
    }}
  >
    오늘의 과제
  </button>


</div>

    {/* 등원/하원 버튼 & 요약 */}
 <div
              style={{
                padding: "16px 16px",
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                height: "100%",
              }}
            >
 
 {/* ✅✅✅ 여기! 카드 안에 넣기 */}
  <div
    style={{
      marginTop: 18,
      padding: "12px",
      borderRadius: 12,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
    }}
  >
       <p
    style={{
      margin: 0,
      fontSize: 15,
      fontWeight: 800,
      color: "#3d3f44",
      textAlign: "center",
    }}
  >
    OPTIMUM EDUCORE
  </p>
    <div
      style={{
        fontWeight: 700,
        marginBottom: 8,
        color: "#51a4db",
        fontSize: 14,
         textAlign: "center",
      }}
    >
      2026년 학습 누적 현황
    </div>

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8,
      }}
    >
      {yearlyMonthlyTotals.map((m) => {
        const isBeforeEntry = entryMonth ? m.month < entryMonth : false;

        return (
          <div
            key={m.month}
            style={{
              padding: "8px 6px",
              borderRadius: 8,
              textAlign: "center",
              background: isBeforeEntry ? "#f3f4f6" : "#eff6ff",
              color: isBeforeEntry ? "#9ca3af" : "#15255f",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <div>{m.month}월</div>
            <div
  style={{
    marginTop: 4,
    color: isBeforeEntry ? "#9ca3af" : "#8e2a2a",
    fontWeight: isBeforeEntry ? 500 : 800,        // 강조
  }}
>
  
 {isBeforeEntry ? "-" : formatHM(m.total)}
</div>

          </div>
          
        );
      })}
    </div>
  </div>
 
</div>


</div>
          {/* 월별 요약 + 달력 */}
          <div
            style={{
              marginTop: 30,
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "minmax(0, 1.1fr) minmax(0, 1.1fr)",
              gap: isMobile ? 12 : 18,
            }}
          >
            {/* 월별 순공 요약 카드 */}
            <div
              style={{
                padding: "16px 16px",
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
              }}
            >


              <h4
                style={{
                  margin: "0 0 10px 0",
                  fontSize: 15,
                   color: "#1E3A8A",
                  fontWeight: 700,
                }}
              >
                월별 순공 요약
              </h4>


              {/* ========= A. 상단 배지 2개 ========= */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    background: "#E8EDFF",
                    padding: "10px 12px",
                    borderRadius: 10,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 14, color: "#1E3A8A" }}>총 누적 순공</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#0c4a6e" }}>
                    {formatHM(summary.total)}
                  </div>
                </div>

                <div
                  style={{
                    flex: 1,
                    border: "1px solid #FFE8EA",
        background: "#FFE8EA",
                    padding: "10px 12px",
                    borderRadius: 10,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 14, color: "#be185d" }}>
  이번 달 평균
</div>

<div style={{ fontSize: 18, fontWeight: 700, color: "#831843" }}>
  {formatHM(avgPerDay)}
</div>
                </div>
              </div>

              {/* ========= D. 이번 달 출석 요약 (출석/결석) ========= */}
              <div
                style={{
                  background: "#fff",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  marginBottom: 14,
                  fontSize: 13,
                  color: "#374151",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6, color: "#1e3a8a" }}>
                  이번 달 루틴 현황
                </div>
                <div>출석: {summary.days}회</div>
                <div>결석: {realAbsences}회</div>
                <div>
                  평균 순공:{" "}
                  <b>
                    {summary.days > 0
                      ? formatHM(summary.days > 0 
  ? Math.round(summary.total / summary.days) 
  : 0
)
                      : 0}
                    
                  </b>
                </div>
              </div>

              {/* ========= C. 최장 순공 Top 3 ========= */}

              <div
                style={{
                  background: "#fff",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  fontSize: 13,
                  color: "#374151",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6, color: "#1e3a8a" }}>
                  🏆 최장 순공 기록 TOP 3
                </div>



                {filteredRecordsThisMonth.length === 0 ? (
                  <div style={{ color: "#9ca3af" }}>데이터 없음</div>
                ) : (
                  filteredRecordsThisMonth
                    .map((r) => ({
                      date: r.date,
                      study: Math.round(calcNetStudyMin(r))
                    }))
                    .sort((a, b) => b.study - a.study)
                    .slice(0, 3)
                    .map((item, i) => (
                      <div key={i} style={{ marginBottom: 4 }}>
                        {i + 1}위: {item.study}분 (
                        {item.date.replace(/-/g, ".")})
                      </div>
                    ))
                )}


              </div>

            </div>

            {/* 이번 달 출결 달력 */}
            <div
              ref={calendarRef}
              style={{
                padding: "16px 16px",
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
              }}
            >

              <h4
                style={{
                  margin: "0 0 10px 0",
                  fontSize: 15,
                  color: "#1e3a8a",
                }}
              >
                이번 달 출결 현황
              </h4>
              {renderCalendar()}
            </div>
          </div>

          {/* 순공 그래프 */}
          <div
            style={{
              marginTop: 32,
              padding: "16px 18px",
              borderRadius: 14,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
            }}
          >
            <h4
              style={{
                margin: "0 0 10px 0",
                fontSize: 15,
                color: "#1e3a8a",
              }}
            >
              📈 최근 순공 변화
            </h4>

            {chartData.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 13 }}>
                순공 데이터가 아직 없습니다.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <ReferenceLine
                    y={avgStudy}
                    stroke="#b91c1c"
                    strokeDasharray="4 4"
                    label={{
                      value: `평균 ${avgStudy.toFixed(0)}분`,
                      position: "insideTopRight",
                      fill: "#b91c1c",
                      fontSize: 11,
                    }}
                  />
                  <defs>
                    <linearGradient id="colorStudy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#93c5fd" stopOpacity={0.9} />
                      <stop offset="95%" stopColor="#bfdbfe" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="study"
                    stroke="#2563eb"
                    strokeWidth={2}
                    fill="url(#colorStudy)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* 돌아가기 */}

        </>
      )}
    </div>
  );
  <style>{`
  @media (max-width: 480px) {
    .brand-title span {
      font-size: 16px !important;
    }
    .brand-title .big {
      font-size: 26px !important;
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
`}</style>
}