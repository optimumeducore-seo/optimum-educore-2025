// src/pages/StudentPage.tsx
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, doc, getDocs, getDoc, setDoc } from "firebase/firestore";
import { calcNetStudyMin as netStudyMin } from "../App";
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

export default function StudentPage() {
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

  // 🔹 학생 전체 목록 로드
  useEffect(() => {
    const loadStudents = async () => {
      const snap = await getDocs(collection(db, "students"));
      setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    };
    loadStudents();
  }, []);

  // 🔹 월간 통계 계산
  const calculateMonthlyStats = (logs: any[]) => {
    const map: Record<string, { days: number; total: number }> = {};
    logs.forEach((r) => {
      if (!r.date) return;
      const month = r.date.slice(0, 7);
      const study = netStudyMin(r);
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
    const st = getStatus(r);
    if (st === "P") P++;
    else if (st === "L") L++;
    else A++;
  });

  return { P, L, A, total: list.length };
};



  // 🔹 학생 선택 시 Firestore에서 출결 로그 로드
  const handleSelectStudent = async (student: any) => {
  setSelected(student);
  setVerified(false);
  setPasswordInput("");
  setTodayInTime(null);

  // 자동 포커스
  setTimeout(() => {
    const el = document.getElementById("pw-input");
    el?.focus();
  }, 50);

  const snap = await getDoc(doc(db, "records", student.id));
  if (!snap.exists()) {
    setRecords([]);
    setMonthStats({});
    return;
  }

  const data = snap.data() as any;

  // 🔥 DayCell 기반으로 변환
  const logs: any[] = Object.entries(data).map(([date, cell]: any) => ({
    date,
    ...cell,
  }));

  setRecords(logs);
  calculateMonthlyStats(logs);

  setTimeout(() => {
    const el = document.getElementById("pw-input");
    el?.focus();
  }, 10);
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

  // 이번 달(특히 11월)만 15일 이후로 제한
  const filtered = records.filter((r) => {
    const [yy, mm, dd] = r.date.split("-").map(Number);

    // 이번 달 + 날짜 14일 이상만 포함
    if (yy === y && mm === m) {
      return dd >= 14;
    }

    // 다른 달은 전체 포함
    return true;
  });

  let total = 0;
  filtered.forEach((r) => (total += netStudyMin(r)));

  return { total, days: filtered.length };
})();

  const getStatus = (rec: any) => {
  if (!rec.time) return "A"; // 결석

  const [h, m] = rec.time.split(":").map(Number);
  const inHM = h * 60 + m;

  const cutoff = 16 * 60 + 30;
  if (inHM > cutoff) return "L";
  return "P";
};


  const [viewYear, setViewYear] = useState(new Date().getFullYear());
const [viewMonth, setViewMonth] = useState(new Date().getMonth()); 

  // 🔹 학생용 등원 처리 (logs 기반)
// 🔥 학생용 checkIn: App 구조로 저장
const checkIn = async () => {
  if (!selected) return;

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5); // HH:MM

  const ref = doc(db, "records", selected.id);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};

  const prev = data[today] || {};

  if (prev.time) {
    alert("이미 등원 처리되었습니다.");
    return;
  }

  const next = {
    ...prev,
    time: hhmm,
    status: "P",
    outTime: undefined,
  };

  await setDoc(ref, { [today]: next }, { merge: true });

  setTodayInTime(now.toISOString());
  alert("✅ 등원 처리 완료");
};

  // 🔹 학생용 하원 처리 (logs 기반)
  const checkOut = async () => {
  if (!selected) return;

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);

  const ref = doc(db, "records", selected.id);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};

  const prev = data[today];

  if (!prev?.time) {
    alert("등원 기록이 없습니다.");
    return;
  }

  if (prev.outTime) {
    alert("이미 하원 처리되었습니다.");
    return;
  }

  const next = {
    ...prev,
    outTime: hhmm,
  };

  await setDoc(ref, { [today]: next }, { merge: true });

  alert("👋 하원 처리 완료");
};

  

  // 🔹 그래프 데이터
  const chartData = records
    .slice()
    .reverse()
    .map((r) => ({
      date: r.date,
      study: Math.round(netStudyMin(r)),
    }));

  const avgStudy =
    chartData.length > 0
      ? chartData.reduce((acc, cur) => acc + cur.study, 0) / chartData.length
      : 0;

      // ⚡ 이번 달 실제 결석일 계산 (일요일 제외)  
// ⚡ 이번 달 실제 결석일 계산 (일요일 제외 + 14일부터)
const realAbsences = (() => {  
  const y = viewYear;  
  const m = viewMonth + 1;  
  
  const monthStr = `${y}-${String(m).padStart(2, "0")}`;  
  
  const presentDays = new Set(  
    records.filter(r => r.date.startsWith(monthStr) && r.time)
      .map(r => r.date)  
  );  
  
  const today = new Date().getDate();  
  let count = 0;  
  
  // 🔥 이번 달은 14일부터 결석 카운팅
  for (let day = 14; day <= today; day++) {  
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

          let bg = "#f3f4f6";
          if (dow === 6) bg = "#dbeafe";
          if (dow === 0) bg = "#ffe4e6";

          if (log) {
            if (log.inTime) bg = "#dcfce7";
            else bg = "#fee2e2";
          }

          const inTimeLabel =
            log?.time && log.time.toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            });

          return (
            <div
              key={dateStr}
              style={{
                height: 48,
                borderRadius: 10,
                background: bg,
                color: "#374151",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                fontWeight: 600,
                fontSize: 13,
                paddingTop: 4,
                paddingBottom: 3,
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
                  }}
                >
                  {inTimeLabel}
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
        maxWidth: 860,
        margin: "40px auto",
        padding: "40px 32px",
        background: "#ffffff",
        borderRadius: 20,
        boxShadow: "0 8px 22px rgba(15,23,42,0.12)",
        fontFamily: "Pretendard, 'Noto Sans KR', system-ui",
      }}
    >
      {/* ===== 브랜드 헤더 ===== */}
      <div
        style={{
          textAlign: "center",
          paddingBottom: 20,
          borderBottom: "1px solid #e5e7eb",
          marginBottom: 26,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 4,
            userSelect: "none",
          }}
        >
          <span style={{ color: "#b71c1c", fontSize: 40, fontWeight: 900 }}>O</span>
          <span style={{ color: "#000000", fontSize: 24, fontWeight: 800 }}>
            PTIMUM
          </span>
          <span style={{ color: "#1e3a8a", fontSize: 40, fontWeight: 900 }}>E</span>
          <span style={{ color: "#000000", fontSize: 24, fontWeight: 800 }}>
            DUCORE
          </span>
          <span
            style={{
              marginLeft: 10,
              color: "#b91c1c",
              fontSize: 13,
              fontStyle: "italic",
              fontWeight: 600,
            }}
          >
            - YOU MAKE YOUR STUDY -
          </span>
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
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
          </div>
        </div>
      )}

      {/* ===== 인증 후 메인 대시보드 ===== */}
      {selected && verified && (
        <>
          {/* 상단: 학생 정보 + 오늘 등원 정보 + 등/하원 버튼 */}
          <div
            style={{
              marginTop: 26,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
              gap: 16,
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
    오늘 학습을 시작할 때 <b>등원</b>, 마칠 때 <b>하원</b> 버튼을 눌러주세요.
  </p>

  <div
    style={{
      display: "flex",
      gap: 10,
      marginTop: 10,
    }}
  >
    <button
      onClick={checkIn}
      style={{
        flex: 1,
        padding: "11px 0",
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
        flex: 1,
        padding: "11px 0",
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

  {/* 🔥 추가된 부분: 카드 안 아래로 이동 */}
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
              gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.1fr)",
              gap: 18,
            }}
          >
            {/* 월별 순공 요약 카드 */}
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
        study: Math.round(netStudyMin(r)),
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
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
`}</style>
}