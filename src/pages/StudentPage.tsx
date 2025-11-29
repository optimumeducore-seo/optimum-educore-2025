// src/pages/StudentPage.tsx
import { useEffect, useState, useRef } from "react";
import { db } from "../firebase";
import { collection, doc, getDocs, getDoc, setDoc } from "firebase/firestore";

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
import { useLocation } from "react-router-dom";

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
    if (Array.isArray(data.logs)) {
      data.logs.forEach((log: any) => {
        if (!results.some((r) => r.date === log.date)) {
          results.push(log);
        }
      });
    }
  }


  // -----------------------------
  // ③ 날짜 기준으로 정렬
  // -----------------------------
  results.sort((a, b) => (a.date > b.date ? 1 : -1));
  return results;
}
export default function StudentPage() {
   const checkIP = async () => {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const { ip } = await res.json();

    const allowedIP = "175.215.126.3";  // ← 여기에 너 IP 적용됨

    console.log("현재 접속 IP:", ip);

    return ip === allowedIP;
  } catch (err) {
    console.error("IP 확인 실패:", err);
    return false; // 실패하면 차단
  }
};

const isMobile = window.innerWidth <= 480;

  const [students, setStudents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [verified, setVerified] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [passwordInput, setPasswordInput] = useState("");
  const [monthStats, setMonthStats] = useState<
    Record<string, { days: number; total: number }>
  >({});
  const [todayInTime, setTodayInTime] = useState<string | null>(null);
  const isTeacher = false;

    const location = useLocation();  
const params = new URLSearchParams(location.search);
const autoId = params.get("id");
  // 🔹 학생 전체 목록 로드
  useEffect(() => {
    const loadStudents = async () => {
      const snap = await getDocs(collection(db, "students"));
      setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    };
    loadStudents();
  }, []);

  useEffect(() => {
  if (autoId && students.length > 0) {
    const target = students.find((s) => s.id === autoId);
    if (target) handleSelectStudent(target);
  }
}, [students, autoId]);

  // 🔹 월간 통계 계산
  const calculateMonthlyStats = (logs: any[]) => {
    const map: Record<string, { days: number; total: number }> = {};
    logs.forEach((r) => {
      if (!r.date) return;
      const month = r.date.slice(0, 7);
      const study = calcNetStudyMin_SP(r);
      if (!map[month]) map[month] = { days: 0, total: 0 };
      map[month].days += 1;
      map[month].total += study;
    });
    setMonthStats(map);
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
const calcNetStudyMin_SP = (rec: any) => {
  const t1 = rec.time;      // 등원
  const t2 = rec.outTime;   // 하원

  if (!t1 || !t2) return 0; // 둘 다 있어야 순공 계산

  const toHM = (v: string) => {
    // ISO 형태 처리 (혹시 남아있을 수도 있어서)
    if (v.includes("T")) {
      const d = new Date(v);
      const hh = d.getHours();
      const mm = d.getMinutes();
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
    return v; // HH:MM
  };

  const toMin = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
  };

  const inHM = toHM(t1);
  const outHM = toHM(t2);

  let total = toMin(outHM) - toMin(inHM);
  if (total <= 0) return 0;

  // 🔹 학원 다녀온 시간(academyIn ~ academyOut) 빼기
  if (rec.academyIn && rec.academyOut) {
    try {
      const aIn = toMin(toHM(rec.academyIn));
      const aOut = toMin(toHM(rec.academyOut));
      if (aOut > aIn) {
        total -= (aOut - aIn);
      }
    } catch (e) {
      console.warn("academy time parse error", e);
    }
  }

  return Math.max(0, total);
};

  // 🔹 비밀번호 인증
const verifyPassword = () => {
  const key = `pw_${selected.id}`;
  const saved = localStorage.getItem(key);

  // 신규 비번 생성
  if (!saved) {
    if (passwordInput.trim().length < 3) {
      alert("비밀번호를 3자리 이상 입력하세요.");
      return;
    }

    localStorage.setItem(key, passwordInput);
    alert("🔐 비밀번호가 설정되었습니다.");
    setVerified(true);
    return;
  }

  // 기존 비밀번호 검증
  if (passwordInput !== saved) {
    alert("❌ 비밀번호가 올바르지 않습니다.");
    return; // ⭐ 실패 시 즉시 종료
  }

  // 성공
  setVerified(true);
};

  // 🔹 비밀번호 초기화
  const resetPassword = () => {
    if (!selected) return;
    const key = `pw_${selected.id}`;
    localStorage.removeItem(key);
    alert("🔄 비밀번호가 초기화되었습니다. 새 비밀번호를 등록하세요.");
    setPasswordInput("");
    setVerified(false);
  };


  const year = new Date().getFullYear();
const month = new Date().getMonth();
const lastDay = new Date(year, month + 1, 0).getDate();

  // 🔹 순공 요약
  // 🔹 순공 요약 (11월은 15일부터만 계산)
const summary = (() => {
  if (!records.length) return { total: 0, days: 0 };

  // 오늘 기준 연/월
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1; // 1~12

  // 이번 달(특히 11월)만 20일 이후로 제한
  const filtered = records.filter((r) => {
    const [yy, mm, dd] = r.date.split("-").map(Number);

    // 이번 달 + 날짜 20일 이상만 포함
    if (yy === y && mm === m) {
      return dd >= 20;
    }

    // 다른 달은 전체 포함
    return true;
  });

  let total = 0;
  filtered.forEach((r) => (total += calcNetStudyMin_SP(r)));

  return { total, days: filtered.length };
})();




  const [viewYear, setViewYear] = useState(new Date().getFullYear());
const [viewMonth, setViewMonth] = useState(new Date().getMonth()); 
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
 
// 🔥 학생용 checkIn: App 구조로 저장

const checkIn = async () => {
   const allowedIP = "175.215.126.3";  // ← 여기에 너 IP 적용됨
   const res = await fetch("https://api.ipify.org?format=json");
    const { ip } = await res.json();
  // 🚫 외부 접속 차단
  if (ip !== allowedIP) {
    alert("⚠️ 외부에서는 체크아웃이 불가능합니다.");
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

  await setDoc(
    ref,
    {
      [studentId]: {
        ...prev,
        time,                 // 첫 등원
        outTime: prev.outTime ?? null, // 하원은 건드리지 않음
      },
    },
    { merge: true }
  );
}



// 🔹 학생용 하원 처리 
const checkOut = async () => {
   const allowedIP = "175.215.126.3";  // ← 여기에 너 IP 적용됨
   const res = await fetch("https://api.ipify.org?format=json");
    const { ip } = await res.json();
  // 🚫 외부 접속 차단
  if (ip !== allowedIP) {
    alert("⚠️ 외부에서는 체크아웃이 불가능합니다.");
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

// 🔹 학원 등원 (학원 가기)
const academyIn = async () => {
  const allowedIP = "175.215.126.3";  // ← 여기에 너 IP 적용됨
   const res = await fetch("https://api.ipify.org?format=json");
    const { ip } = await res.json();
  // 🚫 외부 접속 차단
  if (ip !== allowedIP) {
    alert("⚠️ 외부에서는 체크아웃이 불가능합니다.");
    return;
  }

  if (!selected) return;

  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);

  await saveAcademyIn(selected.id, hhmm);

  setRecords((prev) => {
    const exists = prev.find((r) => r.date === today);
    if (!exists) {
      return [...prev, { date: today, academyIn: hhmm }];
    }
    return prev.map((r) =>
      r.date === today ? { ...r, academyIn: hhmm } : r
    );
  });

  alert("📚 학원 등원 시간 기록 완료");
};

// 🔹 학원 하원 (학원 끝나고 복귀)
const academyOut = async () => {
   const allowedIP = "175.215.126.3";  // ← 여기에 너 IP 적용됨
   const res = await fetch("https://api.ipify.org?format=json");
    const { ip } = await res.json();
  // 🚫 외부 접속 차단
  if (ip !== allowedIP) {
    alert("⚠️ 외부에서는 체크아웃이 불가능합니다.");
    return;
  }

  if (!selected) return;

  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);

  const todayLog = records.find((r) => r.date === today);
  if (!todayLog || !todayLog.academyIn) {
    alert("학원 등원 기록이 없습니다.");
    return;
  }

  await saveAcademyOut(selected.id, hhmm);

  setRecords((prev) =>
    prev.map((r) =>
      r.date === today ? { ...r, academyOut: hhmm } : r
    )
  );

  alert("🏫 학원 하원 시간 기록 완료");
};

async function saveAppStyleCheckOut(studentId: string, time: string) {
  const date = new Date().toISOString().slice(0, 10);
  const ref = doc(db, "records", date);

  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : {};
  const prev = data[studentId] || {};

  await setDoc(
    ref,
    {
      [studentId]: {
        ...prev,
        time: prev.time ?? null, // 등원은 있으면 유지
        outTime: time,           // 마지막 하원
      },
    },
    { merge: true }
  );
}

// 🔥 학원 등원 저장
async function saveAcademyIn(studentId: string, time: string) {
  const date = new Date().toISOString().slice(0, 10);
  const ref = doc(db, "records", date);

  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : {};
  const prev = data[studentId] || {};

  await setDoc(
    ref,
    {
      [studentId]: {
        ...prev,
        academyIn: time,          // 학원 등원
      },
    },
    { merge: true }
  );
}

// 🔥 학원 하원 저장
async function saveAcademyOut(studentId: string, time: string) {
  const date = new Date().toISOString().slice(0, 10);
  const ref = doc(db, "records", date);

  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : {};
  const prev = data[studentId] || {};

  await setDoc(
    ref,
    {
      [studentId]: {
        ...prev,
        academyOut: time,         // 학원 하원
      },
    },
    { merge: true }
  );
}

  // 🔹 그래프 데이터
  const chartData = records
    .slice()
    .reverse()
    .map((r) => ({
      date: r.date,
      study: Math.round(calcNetStudyMin_SP(r))
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


const filteredRecordsThisMonth = (() => {
  const y = viewYear;
  const m = viewMonth + 1;

  const monthStr = `${y}-${String(m).padStart(2, "0")}`;

  return records.filter((r) => {
    if (!r.date.startsWith(monthStr)) return false;
    const dd = Number(r.date.slice(8, 10));
    return dd >= 14; // 🔥 이번 달 14일부터만
  });
})();
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

let bg = "#f3f4f6"; // 기본

if (dow === 6) bg = "#dbeafe";   // 토요일
if (dow === 0) bg = "#ffe4e6";   // 일요일

if (log) {
  if (log.time || log.inTime) bg = "#dcfce7";  // 출석
  else bg = "#fee2e2";                         // 결석
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


          return (
            <div
  key={dateStr}
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
        background: "#ffffff",
        borderRadius: 20,
        boxShadow: "0 8px 22px rgba(15,23,42,0.12)",
        fontFamily: "Pretendard, 'Noto Sans KR', system-ui",
      }}
    >
      {/* ===== 브랜드 헤더 ===== */}
      {/* ===== 브랜드 헤더 ===== */}
<div
  style={{
    textAlign: "center",
    paddingBottom: isMobile ? 16 : 20,
    borderBottom: "1px solid #e5e7eb",
    marginBottom: isMobile ? 20 : 26,
  }}
>
  <div
    style={{
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      alignItems: "center",
      justifyContent: "center",
      gap: isMobile ? 2 : 4,
      userSelect: "none",
    }}
  >
    <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
      <span
        style={{
          color: "#b71c1c",
          fontSize: isMobile ? 26 : 40,
          fontWeight: 900,
        }}
      >
        O
      </span>

      <span
        style={{
          color: "#000000",
          fontSize: isMobile ? 18 : 24,
          fontWeight: 800,
        }}
      >
        PTIMUM
      </span>

      <span
        style={{
          color: "#1e3a8a",
          fontSize: isMobile ? 26 : 40,
          fontWeight: 900,
        }}
      >
        E
      </span>

      <span
        style={{
          color: "#000000",
          fontSize: isMobile ? 18 : 24,
          fontWeight: 800,
        }}
      >
        DUCORE
      </span>
    </div>

    {/* 슬로건 */}
    <span
      style={{
        marginTop: isMobile ? 4 : 0,
        marginLeft: isMobile ? 0 : 10,
        color: "#1aa368ff",
        fontSize: isMobile ? 12 : 20,
        fontStyle: "italic",
        fontWeight: 600,
        textAlign: "center",
        lineHeight: 1.2,
      }}
    >
      - Design Your Routine · Own the Result -
    </span>
  </div>

  {/* 아래 작은 텍스트 */}
  <div
    style={{
      marginTop: isMobile ? 6 : 4,
      fontSize: isMobile ? 10 : 12,
      color: "#6b7280",
      letterSpacing: 1,
    }}
  >
    OPTIMUM EDUCORE STUDENT PORTAL
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
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={verifyPassword}
              style={{
                flex: 1,
                padding: "10px 0",
                border: "none",
                borderRadius: 8,
                background: "#2563eb",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              확인
            </button>
            <button
              onClick={() => {
                setSelected(null);
                setVerified(false);
                setPasswordInput("");
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              취소
            </button>
            <button
              onClick={resetPassword}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #fecaca",
                background: "#fef2f2",
                fontSize: 12,
                color: "#b91c1c",
                cursor: "pointer",
              }}
            >
              비밀번호 초기화
            </button>
                    
      <button
  onClick={() => {
    window.open(`/parent-report/${selected.id}`, "_blank");
  }}
  style={{
    
    padding: "10px 0",
    borderRadius: 10,
    border: "1px solid #2563eb",
    background: "#eff6ff",
    color: "#1e3a8a",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  }}
>
  📄P
</button>
          </div>
        </div>
      )}

      {/* ===== 인증 후 메인 대시보드 ===== */}
      {selected && verified && (
        <>
        {isTeacher && (
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
)}
          {/* 상단: 학생 정보 + 오늘 등원 정보 + 등/하원 버튼 */}
          <div
  style={{
    marginTop: 26,
    display: "grid",
    gridTemplateColumns: isMobile
      ? "1fr"
      : "minmax(0, 1.4fr) minmax(0, 1fr)",
    gap: isMobile ? 12 : 16,
  }}
>
            {/* 학생 기본 정보 카드 */}
            <div
              style={{
                padding: "18px 18px",
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
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
             
              {todayInTime && (
  <p
    style={{
      marginTop: 8,
      fontSize: 13,
      color: "#1d4ed8",
    }}
  >
    오늘 등원시간:{" "}
    {new Date(todayInTime).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    })}
  </p>
)}

              <p
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  color: "#6b7280",
                }}
              >
                최근 {summary.days}일 기준 순공 누적:
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#b91c1c",
                }}
              >
                {summary.total.toFixed(0)}분
              </p>
            </div>


            {/* 등원/하원 버튼 & 요약 */}
           {/* 등원/하원 버튼 & 요약 */}
<div
  style={{
    padding: "18px 18px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#eff6ff", // 파스텔 블루
  }}
>
  <p
    style={{
      margin: "0 0 8px 0",
      fontSize: 13,
      color: "#6b7280",
    }}
  >
    오늘 학습 시작할 때 <b>등원</b>, 마칠 때 <b>하원</b>을 눌러 주세요.
    <br />
    학원에 다녀올 때는 <b>학원 등원 / 학원 하원</b>으로 기록합니다.
  </p>

  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      marginTop: 10,
    }}
  >
    <button
      onClick={checkIn}
      style={{
        padding: "10px 0",
        borderRadius: 10,
        border: "none",
        background: "#2563eb",
        color: "#fff",
        fontWeight: 700,
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      등원
    </button>

    <button
      onClick={checkOut}
      style={{
        padding: "10px 0",
        borderRadius: 10,
        border: "none",
        background: "#ef4444",
        color: "#fff",
        fontWeight: 700,
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      하원
    </button>

    <button
      onClick={academyIn}
      style={{
        padding: "10px 0",
        borderRadius: 10,
        border: "1px solid #22c55e",
        background: "#ecfdf5",
        color: "#166534",
        fontWeight: 700,
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      학원 등원
    </button>

    <button
      onClick={academyOut}
      style={{
        padding: "10px 0",
        borderRadius: 10,
        border: "1px solid #22c55e",
        background: "#f0fdf4",
        color: "#15803d",
        fontWeight: 700,
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      학원 하원
    </button>
  </div>

  <div
    style={{
      marginTop: 14,
      paddingTop: 10,
      borderTop: "1px dashed #e5e7eb",
      fontSize: 12,
      color: "#6b7280",
    }}
  >
    <div>
      출석 일수: <b>{summary.days ? `${summary.days}일` : "기록 없음"}</b>
    </div>
    {summary.days > 0 && (
      <div style={{ marginTop: 2 }}>
        1회 평균 순공: <b>{Math.round(summary.total / summary.days)}분</b>
      </div>
    )}
  </div>

  <button
    onClick={() => {
      setSelected(null);
      setVerified(false);
      setPasswordInput("");
      setSearch("");
    }}
    style={{
      marginTop: 18,
      width: "100%",
      padding: "10px 0",
      borderRadius: 10,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
      fontSize: 13,
      cursor: "pointer",
      color: "#374151",
      fontWeight: 600,
    }}
  >
    ← 다른 학생 검색하기
  </button>
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
      color: "#1e3a8a",
      fontWeight: 700,
    }}
  >
    📊 월별 순공 요약
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
        background: "#e0f2fe",
        padding: "10px 12px",
        borderRadius: 10,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 12, color: "#0369a1" }}>총 누적 순공</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#0c4a6e" }}>
        {summary.total.toFixed(0)}분
      </div>
    </div>

    <div
      style={{
        flex: 1,
        background: "#fce7f3",
        padding: "10px 12px",
        borderRadius: 10,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 12, color: "#be185d" }}>이번 달 평균</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#831843" }}>
        {summary.days > 0
          ? Math.round(summary.total / summary.days)
          : 0}
        분
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
      이번 달 출석 요약
    </div>
    <div>출석: {summary.days}회</div>
    <div>결석: {realAbsences}회</div>
    <div>
      평균 순공:{" "}
      <b>
        {summary.days > 0
          ? Math.round(summary.total / summary.days)
          : 0}
        분
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
        study: Math.round(calcNetStudyMin_SP(r))
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

  <button
  onClick={() => window.open(`/study-plan/${selected.id}`, "_blank")}
  style={{
    marginTop: 12,
    width: "100%",
    padding: "10px 0",
    borderRadius: 10,
    border: "1px solid #059669",
    background: "#ecfdf5",
    color: "#065f46",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  }}
>
  📘 학습과제·계획 보기
</button>

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
                📅 이번 달 출결 현황
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