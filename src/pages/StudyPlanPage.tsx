// src/pages/StudyPlanPage.tsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { deleteDoc } from "firebase/firestore";
import { uploadProof } from "../services/storage";
import { getStorage, ref, deleteObject } from "firebase/storage";
import "./StudyPlanPage.css";


/* ------------------------------------------------------------------ */
/* 타입 / 상수 정의 */
/* ------------------------------------------------------------------ */

type TaskItem = { text: string; done: boolean };

type SubjectPlan = {
  teacherTasks: TaskItem[];
  studentPlans: TaskItem[];
  memo?: string;
  done?: boolean;
  updatedAt?: any;
  proofImages?: string[];
  proofMemo?: string;
  wordTest?: {  correct?: number;   total?: number;   };
};

type DayPlan = {
  date: string;
  subjects: Record<string, SubjectPlan>;
};

type ExamItem = {
  id: string;
  examDate: string;  // YYYY-MM-DD
  subject: string;
  range: string;
  memo?: string;
};

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

const cleanForFirestore = (obj: any) => {
  const res: any = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined) res[k] = v;
  });
  return res;
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

/* ------------------------------------------------------------------ */
/* 메인 컴포넌트 */
/* ------------------------------------------------------------------ */

export default function StudyPlanPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // 역할 구분 (?role=teacher / ?role=student / ?role=parent)
  const searchParams = new URLSearchParams(location.search);
  const role = searchParams.get("role") || "student";

  const isStudent = role === "student";
  const isTeacher = role === "teacher";
  const isParent = role === "parent";

  // 상태들
  const [student, setStudent] = useState<any | null>(null);
  const [plans, setPlans] = useState<Record<string, DayPlan>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());

  const [selectedSubject, setSelectedSubject] = useState<string>("kor");

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

  subjects[key] = {
    teacherTasks: normalizeTasks(sRaw.teacherTasks),
    studentPlans: normalizeTasks(sRaw.studentPlans),
    memo: sRaw.memo || "",
    done: !!sRaw.done,
    updatedAt: sRaw.updatedAt,

    // 🔥 여기 추가 (인증샷 & 메모)
    proofImages: sRaw.proofImages || [],
    proofMemo: sRaw.proofMemo || "",
    wordTest: sRaw.wordTest || { correct: 0, total: 0 },
  };
});

        map[d.id] = {
          date: d.id,
          subjects,
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

  useEffect(() => {
  if (!selectedDate || !id) return;

  const loadProof = async () => {
    const ref = doc(db, "proofs", id, "days", selectedDate);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const data = snap.data();
      setProofImages(data.images || []);
      setProofMemo(data.memo || "");
    } else {
      setProofImages([]);
      setProofMemo("");
    }
  };

  loadProof();
}, [selectedDate, id]);

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

  /* ------------------------------------------------------------------ */
  /* 🔹 체크박스 토글 (선생님/학생 공통) */
/* ------------------------------------------------------------------ */

  const toggleTask = (
    field: "teacherTasks" | "studentPlans",
    index: number
  ) => {
    if (!id || !selectedDate || !selectedSubject || isParent) return;

    setPlans((prev) => {
      const day = prev[selectedDate];
      if (!day) return prev;

      const subj = day.subjects?.[selectedSubject];
      if (!subj) return prev;

      const list = [...(subj[field] || [])];
      if (!list[index]) return prev;

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

      const ref = doc(db, "studyPlans", id, "days", selectedDate);
      setDoc(
        ref,
        cleanForFirestore({
          date: selectedDate,
          [selectedSubject]: {
            ...updatedSubject,
          },
        }),
        { merge: true }
      );

      return { ...prev, [selectedDate]: updatedDay };
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
    const prevSubj = prevDay?.subjects?.[selectedSubject];

    const ref = doc(db, "studyPlans", id, "days", selectedDate);

   if (isTeacher) {
  const prevTeacher = prevSubj?.teacherTasks || [];

  const teacherTasks = teacherInput
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      done: prevTeacher.find((x) => x.text === text)?.done ?? false,
    }));

  const mergedSubject: SubjectPlan = {
    teacherTasks,
    studentPlans: prevSubj?.studentPlans || [],
    memo: memo.trim(),
    done,
    updatedAt: serverTimestamp(),
    proofImages: prevSubj?.proofImages || [],
    proofMemo: prevSubj?.proofMemo || "",
    wordTest: prevSubj?.wordTest || {},   // ⭐⭐ 반드시 있어야 함 ⭐⭐
  };

  const data = cleanForFirestore({
    date: selectedDate,
    [selectedSubject]: mergedSubject,
  });

  await setDoc(ref, data, { merge: true });

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
    teacherTasks: prevSubj?.teacherTasks || [],
    studentPlans,
    memo: memo.trim(),
    done,
    updatedAt: serverTimestamp(),
    proofImages: prevSubj?.proofImages || [],
    proofMemo: prevSubj?.proofMemo || "",
    wordTest: prevSubj?.wordTest || {},   // ⭐⭐ 여기도 반드시 ⭐⭐
  };

  const data = cleanForFirestore({
    date: selectedDate,
    [selectedSubject]: mergedSubject,
  });

  await setDoc(ref, data, { merge: true });
  
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
  /* 📅 달력 렌더링 */
/* ------------------------------------------------------------------ */

  const renderCalendar = () => {
    const firstDay = new Date(year, month, 1).getDay();
    const last = new Date(year, month + 1, 0).getDate();

    const blanks = Array(firstDay).fill(null);
    const today = new Date().toISOString().slice(0, 10);

    

    return (
      <div>
        {/* 월 이동 헤더 + 시험기간 버튼 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <button
              style={navBtn}
              onClick={() => {
                if (month === 0) {
                  setYear(year - 1);
                  setMonth(11);
                } else setMonth(month - 1);
              }}
            >
              ←
            </button>

            <div
              style={{
                fontWeight: 800,
                fontSize: 16,
                color: "#1E3A8A",
                minWidth: 140,
                textAlign: "center",
              }}
            >
              📆 {year}-{String(month + 1).padStart(2, "0")}
            </div>

            <button
              style={navBtn}
              onClick={() => {
                if (month === 11) {
                  setYear(year + 1);
                  setMonth(0);
                } else setMonth(month + 1);
              }}
            >
              →
            </button>
          </div>

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
    onClick={() => handleSelectDate(ds)}
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
        <div style={{ fontSize: 20, fontWeight: 900, color: "#1E3A8A" }}>
          {student?.name} 학생 학습 플래너
        </div>

        {student && (
          <div style={{ fontSize: 13, color: "#4B5563", marginTop: 6 }}>
            {student.school} {student.grade} • 총 과제일{" "}
            {Object.keys(plans).length}일
          </div>
        )}

        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: "#6B7280",
          }}
        >
          현재 모드: <b>{currentRoleLabel}</b>
        </div>
      </div>

      {/* 출력/이동 영역 (선생님/학생) */}
      {!isParent && (
        <div
          style={{
            marginBottom: 20,
            padding: "14px 16px",
            background: "#F3F4FF",
            borderRadius: 14,
            border: "1px solid #DDE3FF",
          }}
        >
          
          <div className="sp-btn-row"
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  }}
>
            <button
              onClick={() => navigate(-1)}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid #D1D5DB",
                background: "#FFFFFF",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 600,
                color: "#374151",
                whiteSpace: "nowrap",
              }}
            >
              ← 돌아가기
            </button>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => navigate(`/study-plan/term-print/${id}`)}
                style={topOutBtn}
              >
                🗂 텀스케줄러
              </button>

              <button
                onClick={() => navigate(`/study-plan/portfolio-print/${id}`)}
                style={topOutBtn}
              >
                📘 매니지먼트 포트폴리오
              </button>

              <button
                onClick={() => setShowPrintOptions(!showPrintOptions)}
                style={{
                  ...topOutBtn,
                  background: "#EEF2FF",
                }}
              >
                📅 기간 선택
              </button>
            </div>
          </div>

          {showPrintOptions && (
            <div
              style={{
                padding: 16,
                border: "1px solid #E5E7EB",
                background: "#F8FAFC",
                borderRadius: 12,
                marginTop: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <button style={rangeBtn} onClick={() => quickRange("week")}>
                  이번 주
                </button>
                <button style={rangeBtn} onClick={() => quickRange("month")}>
                  이번 달
                </button>
                <button style={rangeBtn} onClick={() => quickRange("lastWeek")}>
                  지난 주
                </button>
                <button
                  style={rangeBtn}
                  onClick={() => quickRange("lastMonth")}
                >
                  지난 달
                </button>

                <span style={{ color: "#94A3B8" }}>|</span>

                <span style={{ fontSize: 13, color: "#475569" }}>📅</span>
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  style={dateInput}
                />
                <span>~</span>
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  style={dateInput}
                />

                <button
                  onClick={() =>
                    navigate(
                      `/study-plan/term-print/${id}?start=${start}&end=${end}`
                    )
                  }
                  style={applyBtn}
                >
                  적용
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- 2컬럼 레이아웃 ---------------- */}
<div
  className="sp-grid">
 
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
        fontSize: 12,
        fontWeight: 800,
        color: "#1D4ED8",
        marginBottom: 6,
      }}
    >
      📘 오늘 선생님 과제 한눈에 보기
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
            {subj.tasks.map((t) => `• ${t.text}`).join("\n")}
          </div>
        </div>
      ))}
    </div>
  </div>
)}
          {/* 과목 탭 (5개씩 두 줄) */}
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

          {/* 선택한 날짜 / 과목 정보 */}
          <div
            style={{
              fontSize: 13,
              marginBottom: 6,
              color: "#4B5563",
            }}
          >
            🗓{" "}
            {selectedDate
              ? selectedDate.replace(/-/g, ".")
              : "날짜를 선택해주세요"}{" "}
            · 과목: {currentSubjectLabel}
          </div>

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

          {/* 선생님 과제 입력 */}
          <InputSection
            readonly={isParent || isStudent}
            title="선생님 과제"
            value={teacherInput}
            setValue={setTeacherInput}
            placeholder="예) 수학 문제집 p.132~135, 개념정리, 단원평가 등"
            subjLabel={currentSubjectLabel}
          />

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
{selectedDate && (
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

          {/* 선생님 과제 체크박스 */}
          {selectedDate &&
            plans[selectedDate]?.subjects?.[selectedSubject]?.teacherTasks?.map(
              (task, i) => (
                <label
                  key={i}
                  style={{
                    display: "flex",
                    gap: 6,
                    marginBottom: 4,
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={() => toggleTask("teacherTasks", i)}
                    disabled={isParent}
                  />
                  <span>{task.text}</span>
                </label>
              )
            )}

          {/* 내 공부 계획 입력 */}
          <InputSection
            readonly={isParent || isTeacher}
            title="내 공부 계획"
            value={studentInput}
            setValue={setStudentInput}
            placeholder="예) 오답 정리, 개념 암기, 시험 대비 요약노트 등"
          />

          {/* 학생 계획 체크박스 */}
          {selectedDate &&
            plans[selectedDate]?.subjects?.[selectedSubject]?.studentPlans?.map(
              (task, i) => (
                <label
                  key={i}
                  style={{
                    display: "flex",
                    gap: 6,
                    marginBottom: 4,
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={() => toggleTask("studentPlans", i)}
                    disabled={isParent}
                  />
                  <span>{task.text}</span>
                </label>
              )
            )}
             {/* 🔥 집공 인증샷 섹션 */}
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

          {/* 메모 */}
          {selectedDate && (
            <InputSection
              readonly={isParent}
              title="메모"
              value={memo}
              setValue={setMemo}
              rows={3}
              placeholder="특이사항, 컨디션, 시험범위, 과제 중 어려웠던 점 등을 적어주세요."
            />
          )}

          {/* 저장 버튼 */}
          {!isParent && (
            <>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 10,
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
                  width: "100%",
                  padding: "10px 0",
                  marginTop: 18,
                  background: "#1E3A8A",
                  color: "#FFF",
                  borderRadius: 10,
                  border: "none",
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
          if (title === "선생님 과제" && subjLabel) {
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
      doc(db, "proofs", studentId, "days", selectedDate),
      {
        images: newList,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error("삭제 오류:", err);
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
      const newItems = urls.map((url) => ({
    url,
  }));

  await setDoc(
    doc(db, "proofs", studentId, "days", selectedDate),
    {
      images: [...images, ...newItems], // 기존 + 새 이미지 누적
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

