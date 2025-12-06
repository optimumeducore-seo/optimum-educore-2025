// src/pages/StudyPlanDashboardPage.tsx
import React, { useEffect, useState, useMemo } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

/* -------------------------------------------------- */
/* 타입 정의 (간단 버전)                              */
/* -------------------------------------------------- */

type Student = {
  id: string;
  name: string;
  grade?: string;
  school?: string;
  removed?: boolean;
};

type TaskItem = { text: string; done: boolean };

type SubjectPlan = {
  teacherTasks: TaskItem[];
  studentPlans: TaskItem[];
  memo?: string;
  done?: boolean;
  updatedAt?: any;

  // 🔥 집공 인증용
  proofImages?: string[];
  proofMemo?: string;

  // 🔥 추가! 단어 시험 기록
  wordTest?: {
    correct?: number;
    total?: number;
  };
};

type DayPlan = {
  date: string;
  subjects: Record<string, SubjectPlan>;
};

type RecordsForDate = Record<string, any>;

const SUBJECTS = [
  { key: "kor", label: "국어" },
  { key: "math", label: "수학" },
  { key: "eng", label: "영어" },
  { key: "sci", label: "과학" },
  { key: "soc", label: "사회" },
  { key: "hist1", label: "역사1" },
  { key: "hist2", label: "역사2" },
  { key: "tech", label: "기술가정" },
  { key: "hanja", label: "한자" },
  { key: "jp", label: "일본어" },
];

/* -------------------------------------------------- */
/* 유틸 함수                                          */
/* -------------------------------------------------- */

// ✅ 순공 계산 (StudentPage에서 쓰던 버전이랑 같은 로직)
const calcNetStudyMin = (record: any): number => {
  if (!record) return 0;

  // ① 등원 시간 후보 (옛 버전 + 새 버전 + 모바일 버전 통합)
  const rawIn =
    record.time ||
    record.inTime ||
    record.academyIn ||
    record.academyInTime ||
    record.academyBySubject?.in ||
    null;

  if (!rawIn) return 0;

  // 문자열 → Date 변환
  const today = new Date().toISOString().slice(0, 10);
  const inTime = new Date(`${today}T${rawIn}:00`);

  // ② 하원 시간 후보
  const rawOut =
    record.outTime ||
    record.academyOut ||
    record.academyOutTime ||
    record.academyBySubject?.out ||
    null;

  const outTime = rawOut
    ? new Date(`${today}T${rawOut}:00`)
    : new Date(); // 아직 안 나갔으면 현재시간

  // ③ 순공 계산
  let diff = (outTime.getTime() - inTime.getTime()) / 60000;
  if (isNaN(diff) || diff < 0) diff = 0;

  // ④ 휴식 / 이동 시간 차감
  const commute = record.commuteMin || 0;
  const rest = record.restroomMin || 0;

  return Math.max(0, diff - commute - rest);
};

const minToHM = (m: number) => {
  const mm = Math.max(0, Math.round(m));
  const h = Math.floor(mm / 60);
  const r = mm % 60;
  if (h <= 0) return `${r}분`;
  if (r === 0) return `${h}시간`;
  return `${h}시간 ${r}분`;
};

const normalizeTasks = (v: any): TaskItem[] => {
  if (!v || !Array.isArray(v)) return [];
  if (typeof v[0] === "string") {
    return v.map((x: string) => ({ text: x, done: false }));
  }
  if (typeof v[0] === "object") {
    return v.map((x: any) => ({
      text: x.text || "",
      done: !!x.done,
    }));
  }
  return [];
};

const cleanForFirestore = (obj: any) => {
  const res: any = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined) res[k] = v;
  });
  return res;
};


/* -------------------------------------------------- */
/* 메인 컴포넌트: StudyPlanDashboardPage              */
/* -------------------------------------------------- */

export default function StudyPlanDashboardPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [dateStr, setDateStr] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  const [records, setRecords] = useState<RecordsForDate>({});
  const [dayPlans, setDayPlans] = useState<Record<string, DayPlan>>({});
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null
  );
  const [selectedSubject, setSelectedSubject] = useState<string>("kor");

  // 상세 입력 상태 (우측 하단)
  const [teacherInput, setTeacherInput] = useState("");
  const [studentInput, setStudentInput] = useState("");
  const [memo, setMemo] = useState("");
  const [done, setDone] = useState(false);

  const [loading, setLoading] = useState(false);

  /* ---------------- 학생 목록 로드 ---------------- */

  useEffect(() => {
    const loadStudents = async () => {
      const snap = await getDocs(collection(db, "students"));
      const list: Student[] = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((s) => !s.removed);

      // 학년 → 이름 순 정렬
      list.sort((a, b) => {
        const g1 = parseInt(a.grade?.replace(/[^0-9]/g, "") || "0");
        const g2 = parseInt(b.grade?.replace(/[^0-9]/g, "") || "0");
        if (g1 !== g2) return g2 - g1;
        return (a.name || "").localeCompare(b.name || "", "ko");
      });

      setStudents(list);
      if (!selectedStudentId && list[0]) {
        setSelectedStudentId(list[0].id);
      }
    };

    loadStudents();
  }, []);

  /* ---------------- 출결 / 플래너 로드 (날짜별) ----- */

  useEffect(() => {
    if (!dateStr || students.length === 0) return;

    const load = async () => {
      setLoading(true);
      try {
        // 1) 출결 records/<dateStr>
        const recSnap = await getDoc(doc(db, "records", dateStr));
        setRecords((recSnap.data() as any) || {});

        // 2) 각 학생의 플래너 studyPlans/<sid>/days/<dateStr>
        const planMap: Record<string, DayPlan> = {};

        await Promise.all(
          students.map(async (s) => {
            const ref = doc(db, "studyPlans", s.id, "days", dateStr);
            const snap = await getDoc(ref);
            if (!snap.exists()) return;

            const raw = snap.data() as any;
            const subjects: Record<string, SubjectPlan> = {};

            SUBJECTS.forEach(({ key }) => {
              const sRaw = raw[key];
              if (!sRaw) return;
              subjects[key] = {
  teacherTasks: normalizeTasks(sRaw.teacherTasks),
  studentPlans: normalizeTasks(sRaw.studentPlans),
  memo: sRaw.memo || "",
  done: !!sRaw.done,
  updatedAt: sRaw.updatedAt,
  proofImages: sRaw.proofImages || [],
  proofMemo: sRaw.proofMemo || "",
    wordTest: sRaw.wordTest || { correct: 0, total: 0 },
};
            });

            planMap[s.id] = {
              date: dateStr,
              subjects,
            };
          })
        );

        setDayPlans(planMap);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [dateStr, students]);

  /* ---------------- 우측 하단 상세 입력 동기화 ------- */

  useEffect(() => {
    if (!selectedStudentId || !dateStr) {
      setTeacherInput("");
      setStudentInput("");
      setMemo("");
      setDone(false);
      return;
    }

    const day = dayPlans[selectedStudentId];
    const subj = day?.subjects?.[selectedSubject];

    setTeacherInput((subj?.teacherTasks || []).map((t) => t.text).join("\n"));
    setStudentInput((subj?.studentPlans || []).map((t) => t.text).join("\n"));
    setMemo(subj?.memo || "");
    setDone(!!subj?.done);
  }, [selectedStudentId, selectedSubject, dayPlans, dateStr]);

  const currentStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) || null,
    [students, selectedStudentId]
  );

const [wordCorrect, setWordCorrect] = useState<number>(0);
const [wordTotal, setWordTotal] = useState<number>(0);
  useEffect(() => {
  if (!selectedStudentId || !dateStr) {
    setTeacherInput("");
    setStudentInput("");
    setMemo("");
    setDone(false);
    return;
  }

  const day = dayPlans[selectedStudentId];
  const subj = day?.subjects?.[selectedSubject];

  setTeacherInput((subj?.teacherTasks || []).map((t) => t.text).join("\n"));
  setStudentInput((subj?.studentPlans || []).map((t) => t.text).join("\n"));
  setMemo(subj?.memo || "");
  setDone(!!subj?.done);

  // 🔥 추가: 단어 시험 불러오기
  setWordCorrect(subj?.wordTest?.correct ?? 0);
  setWordTotal(subj?.wordTest?.total ?? 0);
}, [selectedStudentId, selectedSubject, dayPlans, dateStr]);
  /* ---------------- 저장 (선생님/학생 계획 통합) ---- */

  const handleSave = async () => {
  if (!selectedStudentId || !dateStr) return;
  const sid = selectedStudentId;
    const prevDay = dayPlans[sid];
  const prevSubj = prevDay?.subjects?.[selectedSubject];

  const ref = doc(db, "studyPlans", sid, "days", dateStr);

  // 🔥 기존 데이터를 완전 무시하고 새로 구성 (덮어쓰기)
  const teacherTasks: TaskItem[] = teacherInput
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      done: false, // 선생님 체크는 학생 페이지에서만 가능하게
    }));

  const studentPlans: TaskItem[] = studentInput
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      done: false,
    }));

  const mergedSubject: SubjectPlan = {
  teacherTasks,
  studentPlans: prevSubj?.studentPlans || [],
  memo: memo.trim(),
  done: prevSubj?.done ?? done,
  updatedAt: serverTimestamp(),
  proofImages: prevSubj?.proofImages || [],
  proofMemo: prevSubj?.proofMemo || "",
  wordTest: {
    correct: wordCorrect ?? prevSubj?.wordTest?.correct ?? 0,
    total: wordTotal ?? prevSubj?.wordTest?.total ?? 0,
  },
};

  // 🔥 기존 문서 항목과 병합하지 않고, 해당 과목 필드만 깔끔하게 덮어씀
  await setDoc(
    ref,
    {
      date: dateStr,
      [selectedSubject]: mergedSubject,
    },
    { merge: true }
  );

  // 로컬 state 업데이트
  setDayPlans((prev) => ({
    ...prev,
    [sid]: {
      date: dateStr,
      subjects: {
        ...(prev[sid]?.subjects || {}),
        [selectedSubject]: mergedSubject,
      },
    },
  }));

  alert("저장 완료! (선생님 대시보드)");
};

  /* ---------------- 요약 테이블 계산 ---------------- */

  const summaryRows = useMemo(() => {
  return students.map((s) => {
    const rec = records[s.id] || {};
    const netMin = calcNetStudyMin(rec);

    const day = dayPlans[s.id];
    const subj = day?.subjects?.[selectedSubject];

    let tDone = 0,
      tTotal = 0,
      stDone = 0,
      stTotal = 0;

    if (day?.subjects) {
      Object.values(day.subjects).forEach((sub) => {
        tDone += sub.teacherTasks.filter((t) => t.done).length;
        tTotal += sub.teacherTasks.length;
        stDone += sub.studentPlans.filter((t) => t.done).length;
        stTotal += sub.studentPlans.length;
      });
    }

    return {
      student: s,
      inTime: rec.time || rec.academyIn || "",
      outTime: rec.outTime || rec.academyOut || "",
      netMin,

      teacherDone: tDone,
      teacherTotal: tTotal,
      studentDone: stDone,
      studentTotal: stTotal,

      // 🔵 학생 개인의 선택된 과목 wordTest
      wordCorrect: subj?.wordTest?.correct ?? null,
      wordTotal: subj?.wordTest?.total ?? null,
    };
  });
}, [students, records, dayPlans, selectedSubject]);

  /* ---------------- 렌더 ---------------- */

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "24px auto",
        padding: "20px 18px 40px",
        background: "#F9FAFB",
        borderRadius: 18,
        boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
        fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, system-ui",
      }}
    >
      {/* 상단 헤더 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 900,
              color: "#1E3A8A",
              marginBottom: 4,
            }}
          >
            📘 학습 플래너 — 선생님 대시보드
          </div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>
            한 화면에서 오늘 모든 학생의 출결 · 순공 · 과제 진행도를 확인하고
            바로 수정할 수 있습니다.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 13, color: "#4B5563" }}>날짜</span>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            style={{
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid #CBD5E1",
              fontSize: 13,
              background: "#FFFFFF",
            }}
          />
        </div>
      </div>

      {/* 2컬럼 레이아웃 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          gap: 16,
        }}
      >
        {/* 좌측: 학생 리스트 */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 14,
            border: "1px solid #E5E7EB",
            padding: 12,
            maxHeight: 600,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#111827",
              marginBottom: 8,
            }}
          >
            👥 학생 목록
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#6B7280",
              marginBottom: 8,
            }}
          >
            클릭하면 오른쪽 상세 플래너가 전환됩니다.
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {students.map((s) => {
              const active = s.id === selectedStudentId;
              const rec = records[s.id] || {};
              const net = calcNetStudyMin(rec);

              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedStudentId(s.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: active
                      ? "1px solid #1E3A8A"
                      : "1px solid transparent",
                    background: active ? "#EEF2FF" : "#F9FAFB",
                    marginBottom: 6,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: "#111827",
                      }}
                    >
                      {s.name}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#6B7280",
                      }}
                    >
                      {s.school} {s.grade}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#6B7280" }}>
                    순공:{" "}
                    <b style={{ color: "#16A34A" }}>{minToHM(net)}</b>
                    {rec.time && (
                      <>
                        {" · "}등원 {rec.time}
                        {rec.outTime && ` / 하원 ${rec.outTime}`}
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 우측: 요약 테이블 + 상세 플래너 */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: "minmax(220px, auto) minmax(260px, auto)",
            gap: 14,
          }}
        >
          {/* 요약 테이블 */}
          <div
            style={{
              background: "#FFFFFF",
              borderRadius: 14,
              border: "1px solid #E5E7EB",
              padding: 12,
              overflowX: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#111827",
                }}
              >
                📊 오늘 전체 학생 요약
              </div>
              {loading && (
                <div style={{ fontSize: 11, color: "#6B7280" }}>
                  불러오는 중…
                </div>
              )}
            </div>

            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#F3F4F6",
                    borderBottom: "1px solid #E5E7EB",
                  }}
                >
                  <th style={thCell}>학생</th>
                  <th style={thCell}>학교/학년</th>
                  <th style={thCell}>등원</th>
                  <th style={thCell}>하원</th>
                  <th style={thCell}>순공</th>
                  <th style={thCell}>선생님 과제</th>
                  <th style={thCell}>학생 계획</th>
                  <th style={thCell}>단어 시험</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row) => (
                  <tr
                    key={row.student.id}
                    style={{
                      borderBottom: "1px solid #F3F4F6",
                      background:
                        row.student.id === selectedStudentId
                          ? "#EEF2FF"
                          : "transparent",
                    }}
                    onClick={() => setSelectedStudentId(row.student.id)}
                  >
                    <td style={tdCell}>{row.student.name}</td>
                    <td style={tdCell}>
                      {row.student.school} {row.student.grade}
                    </td>
                    <td style={tdCell}>{row.inTime || "-"}</td>
                    <td style={tdCell}>{row.outTime || "-"}</td>
                    <td style={tdCell}>
                      <b style={{ color: "#16A34A" }}>
                        {minToHM(row.netMin)}
                      </b>
                    </td>
                    <td style={tdCell}>
                      {row.teacherTotal > 0 ? (
                        <>
                          {row.teacherDone}/{row.teacherTotal}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td style={tdCell}>
                      {row.studentTotal > 0 ? (
                        <>
                          {row.studentDone}/{row.studentTotal}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td style={tdCell}>
  {row.wordTotal ? (
    <>
      {row.wordCorrect}/{row.wordTotal}
    </>
  ) : (
    "-"
  )}
</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 상세 플래너 (선택 학생 · 오늘 날짜 1일분) */}
          <div
            style={{
              background: "#FFFFFF",
              borderRadius: 14,
              border: "1px solid #E5E7EB",
              padding: 14,
            }}
          >
            <div
              style={{
                marginBottom: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#111827",
                  }}
                >
                  📝 선택 학생 상세 플래너
                </div>
                <div style={{ fontSize: 12, color: "#6B7280" }}>
                  {currentStudent
                    ? `${currentStudent.name} · ${dateStr}`
                    : "학생을 선택하세요."}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 12, color: "#4B5563" }}>과목</span>
                <select
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  style={{
                    padding: "4px 6px",
                    fontSize: 12,
                    borderRadius: 999,
                    border: "1px solid #CBD5E1",
                    background: "#F9FAFB",
                  }}
                >
                  {SUBJECTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!currentStudent ? (
              <div
                style={{
                  fontSize: 12,
                  color: "#9CA3AF",
                  textAlign: "center",
                  padding: "20px 0",
                }}
              >
                왼쪽에서 학생을 선택하세요.
              </div>
            ) : (
              <>
                {/* 선생님 과제 */}
                <InputSection
                  title="선생님 과제"
                  value={teacherInput}
                  setValue={setTeacherInput}
                  readonly={false}
                  placeholder="예) 수학 문제집 p.132~135, 개념정리, 단원평가 등"
                />

                {/* 학생 계획 */}
                <InputSection
                  title="학생 계획"
                  value={studentInput}
                  setValue={setStudentInput}
                  readonly={false}
                  placeholder="예) 오답 정리, 개념 암기, 시험 대비 요약노트 등"
                />

                {/* 메모 */}
                <InputSection
                  title="메모"
                  value={memo}
                  setValue={setMemo}
                  readonly={false}
                  rows={3}
                  placeholder="컨디션, 시험범위, 특이사항 등을 적어주세요."
                />

                {/* 🔵 단어 시험 입력 */}
<div style={{ marginBottom: 10 }}>
  <div
    style={{
      fontSize: 12,
      fontWeight: 700,
      color: "#4B5563",
      marginBottom: 4,
    }}
  >
    단어 시험 (맞은 개수 / 총 문제)
  </div>

  <div style={{ display: "flex", gap: 10 }}>
    <input
      type="number"
      placeholder="맞은 개수"
      value={wordCorrect}
      onChange={(e) => setWordCorrect(Number(e.target.value || 0))}
      style={{
        width: 100,
        borderRadius: 8,
        border: "1px solid #D1D5DB",
        padding: "6px 8px",
        fontSize: 12,
      }}
    />
    <input
      type="number"
      placeholder="총 문제 수"
      value={wordTotal}
      onChange={(e) => setWordTotal(Number(e.target.value || 0))}
      style={{
        width: 100,
        borderRadius: 8,
        border: "1px solid #D1D5DB",
        padding: "6px 8px",
        fontSize: 12,
      }}
    />
  </div>
</div>

                {/* 🔥 집공 인증샷/메모 표시 (읽기 전용) */}
{(() => {
  const currentDay = dayPlans[selectedStudentId || ""] || null;
  const currentSubj = currentDay?.subjects?.[selectedSubject];

  if (!currentSubj) return null;
  if (!currentSubj.proofImages?.length && !currentSubj.proofMemo) return null;

  return (
    <div style={{ marginBottom: 12, marginTop: 8 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#4B5563",
          marginBottom: 4,
        }}
      >
        📸 집공 인증
      </div>

     {/* 이미지들 */}
{(currentSubj?.proofImages?.length ?? 0) > 0 && (
  <div
    style={{
      display: "flex",
      gap: 6,
      flexWrap: "wrap",
      marginBottom: 6,
    }}
  >
    {currentSubj?.proofImages?.map((url, i) => (
      <img
        key={i}
        src={url}
        alt={`proof-${i}`}
        style={{
          width: 60,
          height: 60,
          objectFit: "cover",
          borderRadius: 8,
          border: "1px solid #E5E7EB",
        }}
      />
    ))}
  </div>
)}

      {/* 메모 */}
      {currentSubj.proofMemo && (
        <div
          style={{
            fontSize: 12,
            color: "#374151",
            background: "#F9FAFB",
            borderRadius: 8,
            padding: "6px 8px",
            border: "1px solid #E5E7EB",
          }}
        >
          {currentSubj.proofMemo}
        </div>
      )}
    </div>
  );
})()}

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 6,
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={(e) => setDone(e.target.checked)}
                  />
                  이 과목 오늘 계획 완료
                </label>

                <button
                  onClick={handleSave}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    padding: "9px 0",
                    borderRadius: 10,
                    border: "none",
                    background: "#1E3A8A",
                    color: "#FFFFFF",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  💾 저장하기
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------- */
/* 공통 InputSection                                  */
/* -------------------------------------------------- */

type InputSectionProps = {
  title: string;
  value: string;
  setValue: (v: string) => void;
  readonly: boolean;
  placeholder?: string;
  rows?: number;
};

function InputSection({
  title,
  value,
  setValue,
  readonly,
  placeholder,
  rows = 4,
}: InputSectionProps) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#4B5563",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        readOnly={readonly}
        rows={rows}
        placeholder={placeholder}
        style={{
          width: "100%",
          borderRadius: 10,
          border: "1px solid #E5E7EB",
          padding: "7px 9px",
          fontSize: 13,
          background: readonly ? "#F9FAFB" : "#FFFFFF",
          resize: "vertical",
        }}
      />
    </div>
  );
}

/* -------------------------------------------------- */
/* 테이블 공용 스타일                                 */
/* -------------------------------------------------- */

const thCell: React.CSSProperties = {
  padding: "6px 8px",
  textAlign: "left",
  fontWeight: 700,
  fontSize: 11,
  color: "#4B5563",
  whiteSpace: "nowrap",
};

const tdCell: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 12,
  color: "#111827",
  borderBottom: "1px solid #F3F4F6",
  whiteSpace: "nowrap",
};