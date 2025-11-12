import { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
} from "firebase/firestore";
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
  const [records, setRecords] = useState<any[]>([]);
  const [monthStats, setMonthStats] = useState<{ [key: string]: any }>({});
  const [passwordInput, setPasswordInput] = useState("");
  const [verified, setVerified] = useState(false);
  const [todayInTime, setTodayInTime] = useState<string | null>(null);

  // === 학생 목록 불러오기 ===
  useEffect(() => {
    const fetchStudents = async () => {
      const snap = await getDocs(collection(db, "students"));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setStudents(list);
    };
    fetchStudents();
  }, []);

  // === 검색 ===
  const handleSearch = (e: any) => {
    const value = e.target.value.trim();
    setSearch(value);
    setSelected(null);
    setVerified(false);
  };

  // === 학생 선택 ===
  const handleSelectStudent = async (student: any) => {
    setSelected(student);
    setVerified(false);
    setPasswordInput("");
  };

  // === 비밀번호 검증 ===
  const handleVerifyPassword = async () => {
    if (!selected) return;

    const key = `pw_${selected.id}`;
    const savedPw = localStorage.getItem(key);

    if (!savedPw) {
      if (passwordInput.trim().length < 3) {
        alert("비밀번호를 3자리 이상 입력하세요.");
        return;
      }
      localStorage.setItem(key, passwordInput);
      alert("✅ 비밀번호가 설정되었습니다! 다음부터 이 비밀번호로 로그인하세요.");
      setVerified(true);
    } else if (savedPw === passwordInput) {
      setVerified(true);
    } else {
      alert("❌ 비밀번호가 올바르지 않습니다.");
    }
  };

  // === 월별 출결 요약 ===
  const calcMonthlyStats = (records: any[]) => {
    const monthMap: { [key: string]: { count: number; study: number } } = {};
    records.forEach((r) => {
      if (!r.date) return;
      const month = r.date.slice(0, 7);
      const study = netStudyMin(r);
      if (!monthMap[month]) monthMap[month] = { count: 0, study: 0 };
      monthMap[month].count += 1;
      monthMap[month].study += study;
    });
    setMonthStats(monthMap);
  };

  const summary = (() => {
    if (!records.length) return { total: 0, days: 0 };
    let total = 0;
    records.forEach((r) => (total += netStudyMin(r)));
    return { total, days: records.length };
  })();

  // === 등원 ===
  const handleCheckIn = async (studentId: string) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    await setDoc(
      doc(db, "records", studentId),
      { date: todayStr, inTime: now, outTime: null },
      { merge: true }
    );

    setTodayInTime(now);
    alert("✅ 등원 처리 완료!");
    setSelected(null);
    setVerified(false);
  };

  // === 하원 ===
  const handleCheckOut = async (studentId: string) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    await setDoc(
      doc(db, "records", studentId),
      { date: todayStr, outTime: now },
      { merge: true }
    );

    alert("👋 하원 처리 완료!");
    setSelected(null);
    setVerified(false);
  };

  // === 그래프 데이터 ===
  const chartData = records
    .slice()
    .reverse()
    .map((r) => ({
      date: r.date,
      study: parseFloat(netStudyMin(r).toFixed(0)),
    }));

  const avg =
    chartData.length > 0
      ? chartData.reduce((a, b) => a + b.study, 0) / chartData.length
      : 0;

  // === 달력형 출결 ===
  const renderCalendar = () => {
    if (!records.length) return <p style={{ color: "#aaa" }}>출결 데이터 없음</p>;
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const last = new Date(year, month + 1, 0);
    const days: any[] = [];

    const recordDates = records.map((r) => r.date);

    for (let i = 1; i <= last.getDate(); i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      const studied = recordDates.includes(dateStr);
      days.push(
        <div
          key={i}
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: studied ? "#90caf9" : "#e0e0e0",
            color: studied ? "#0d47a1" : "#777",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontWeight: studied ? 700 : 400,
          }}
        >
          {i}
        </div>
      );
    }

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 6,
          marginTop: 10,
        }}
      >
        {days}
      </div>
    );
  };

  return (
    <div
      style={{
        maxWidth: 820,
        margin: "50px auto",
        padding: "40px 30px",
        fontFamily: "Pretendard, 'Noto Sans KR', sans-serif",
        background: "#ffffff",
        borderRadius: 20,
        boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
      }}
    >
      {/* ===== 로고 ===== */}
      <div style={{ textAlign: "center", marginBottom: 30 }}>
        <div style={{ display: "inline-block", userSelect: "none" }}>
          <span style={{ color: "#b71c1c", fontSize: 34, fontWeight: 900 }}>O</span>
          <span style={{ color: "#000", fontSize: 22, fontWeight: 700 }}>PTIMUM</span>
          <span style={{ color: "#1e3a8a", fontSize: 34, fontWeight: 900 }}> E</span>
          <span style={{ color: "#000", fontSize: 22, fontWeight: 700 }}>DUCORE</span>
          <span style={{ color: "#555", fontSize: 20, fontWeight: 800, marginLeft: 4 }}>
            STUDENT
          </span>
        </div>
        <div style={{ color: "#b71c1c", fontSize: 14, fontStyle: "italic", marginTop: 6 }}>
          - YOU MAKE YOUR STUDY -
        </div>
      </div>

      {/* ===== 검색 ===== */}
      <input
        type="text"
        placeholder="이름을 입력하세요"
        value={search}
        onChange={handleSearch}
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: 10,
          border: "1px solid #ccc",
          marginBottom: 20,
          fontSize: 15,
          outline: "none",
          background: "#fafafa",
        }}
      />

      {/* ===== 검색 결과 ===== */}
      {!selected && search && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {students
            .filter((s) => s.name.includes(search))
            .map((s) => (
              <div
                key={s.id}
                onClick={() => handleSelectStudent(s)}
                style={{
                  padding: "14px 18px",
                  background: "#f9fafb",
                  borderRadius: 12,
                  border: "1px solid #eee",
                  cursor: "pointer",
                }}
              >
                <strong style={{ color: "#333" }}>{s.name}</strong>
                <span style={{ color: "#777", marginLeft: 8 }}>({s.grade})</span>
              </div>
            ))}
        </div>
      )}

      {/* ===== 비밀번호 입력 ===== */}
      {selected && !verified && (
        <div style={{ marginTop: 30, textAlign: "center" }}>
          <h3 style={{ color: "#1e3a8a", marginBottom: 12 }}>{selected.name} 학생</h3>
          <p style={{ color: "#777", marginBottom: 8 }}>비밀번호를 입력하세요</p>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            style={{
              padding: "10px",
              borderRadius: 8,
              border: "1px solid #ccc",
              width: "70%",
              marginBottom: 10,
            }}
          />
          <div>
            <button
              onClick={handleVerifyPassword}
              style={{
                background: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              확인
            </button>
            <button
              onClick={() => setSelected(null)}
              style={{
                marginLeft: 8,
                background: "#eee",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                cursor: "pointer",
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 비밀번호 초기화 버튼 */}
      <button
        onClick={() => {
          if (!selected) return;
          const key = `pw_${selected.id}`;
          localStorage.removeItem(key);
          alert("🔄 비밀번호가 초기화되었습니다. 새 비밀번호를 등록하세요!");
        }}
        style={{
          marginTop: 10,
          background: "#fce7e7",
          color: "#b71c1c",
          border: "1px solid #f8bdbd",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        비밀번호 초기화
      </button>

      {/* ===== 본인 확인 후 상세 ===== */}
      {selected && verified && (
        <>
          {/* 학생 카드 */}
          <div
            style={{
              marginTop: 30,
              background: "#f9fafb",
              borderRadius: 16,
              padding: 24,
              border: "1px solid #eee",
              boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
            }}
          >
            <h3 style={{ color: "#1e3a8a", marginBottom: 8 }}>{selected.name} 학생</h3>
            <p>학년: {selected.grade}</p>
            {todayInTime && (
              <p style={{ color: "#0d47a1" }}>
                오늘 등원시간: {new Date(todayInTime).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
            <p>
              최근 {summary.days}일 순공:{" "}
              <strong style={{ color: "#b71c1c" }}>{summary.total.toFixed(0)}분</strong>
            </p>
          </div>

          {/* 등원 / 하원 버튼 */}
          <div
            style={{
              marginTop: 25,
              display: "flex",
              justifyContent: "center",
              gap: "12px",
            }}
          >
            <button
              onClick={() => handleCheckIn(selected.id)}
              style={{
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "12px 20px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              등원
            </button>
            <button
              onClick={() => handleCheckOut(selected.id)}
              style={{
                background: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "12px 20px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              하원
            </button>
          </div>

          {/* 달력 */}
          <div style={{ marginTop: 30 }}>
            <h4 style={{ color: "#1e3a8a", marginBottom: 10 }}>📅 이번 달 출결 현황</h4>
            {renderCalendar()}
          </div>

          {/* 월별 순공 요약 */}
          <div style={{ marginTop: 40 }}>
            <h4 style={{ color: "#1e3a8a", marginBottom: 10 }}>📊 월별 순공 요약</h4>
            {Object.keys(monthStats).length ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 12,
                }}
              >
                {Object.entries(monthStats).map(([m, data]) => (
                  <div
                    key={m}
                    style={{
                      background: "#f9fafb",
                      borderRadius: 10,
                      padding: 12,
                      border: "1px solid #eee",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                    }}
                  >
                    <strong style={{ color: "#1e3a8a" }}>{m}</strong>
                    <p style={{ fontSize: 13, margin: "4px 0", color: "#444" }}>
                      출석일수: {data.count}일
                    </p>
                    <p style={{ fontSize: 13, margin: "0", color: "#b71c1c" }}>
                      총 순공: {Math.round(data.study)}분
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "#aaa" }}>아직 통계 데이터가 없습니다.</p>
            )}
          </div>

          {/* 그래프 */}
          <div style={{ marginTop: 40 }}>
            <h4 style={{ color: "#1e3a8a", marginBottom: 10 }}>📈 최근 순공 변화</h4>
            {chartData.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <ReferenceLine
                    y={avg}
                    stroke="#b71c1c"
                    strokeDasharray="4 4"
                    label={{
                      value: `평균 ${avg.toFixed(0)}분`,
                      position: "insideTopRight",
                      fill: "#b71c1c",
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="study"
                    stroke="#1976d2"
                    strokeWidth={2}
                    fill="url(#colorStudy)"
                  />
                  <defs>
                    <linearGradient id="colorStudy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#90caf9" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#bbdefb" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ color: "#aaa" }}>순공 데이터가 없습니다.</p>
            )}
          </div>

          <button
            onClick={() => {
              setSelected(null);
              setVerified(false);
            }}
            style={{
              marginTop: 30,
              background: "#f1f5f9",
              color: "#333",
              border: "none",
              borderRadius: 8,
              padding: "10px 14px",
              cursor: "pointer",
              display: "block",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            ← 돌아가기
          </button>
        </>
      )}
    </div>
  );
}