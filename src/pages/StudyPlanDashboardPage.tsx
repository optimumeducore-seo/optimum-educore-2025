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
import OpsModal from "../components/admin/OpsModal";
import { db } from "../firebase";
import type { AssignmentRules, Weekday } from "../services/firestore";
import { saveAssignmentRules, loadAssignmentRules } from "../services/firestore";
import { rescheduleDeletedAutoTask } from "../services/firestore";
import type { MainTask } from "../services/firestore";

/* -------------------------------------------------- */
/* 타입 정의 (간단 버전)                              */
/* -------------------------------------------------- */

type Student = {
  id: string;
  name: string;
  grade?: string | number;   // 지금 데이터가 "고1" 같은 문자열이라 이게 안전
  gradeLevel?: string;       // ✅ "중학교" / "고등학교"
  hidden?: boolean;
  isPaused?: boolean;
  school?: string;
  removed?: boolean;
};

type TaskItem = {
  id?: string;          // ✅ 이 줄 하나 추가
  text?: string;
  title?: string;
  done?: boolean;
  deleted?: boolean;
  subtasks?: {
    text: string;
    done: boolean;
  }[];
  carriedFrom?: string;
};

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

type StudentLite = {
  id: string;
  name: string;
  grade?: string;
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
  if (!Array.isArray(v)) return [];

  return v.map((x: any) => ({
    id: x.id,                       // ✅ 유지
    title: x.title ?? "",
    text: x.text ?? "",
    done: !!x.done,
    carriedFrom: x.carriedFrom ?? "", // ✅ 유지
    deleted: x.deleted === true ? true : false,
    subtasks: Array.isArray(x.subtasks)
      ? x.subtasks.map((s: any) => ({
          text: s.text ?? "",
          done: !!s.done,
        }))
      : undefined,                 // ✅ 수동은 subtasks 자체를 안 둠
  }));
};


/* -------------------------------------------------- */
/* 메인 컴포넌트: StudyPlanDashboardPage              */
/* -------------------------------------------------- */

export default function StudyPlanDashboardPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [dateStr, setDateStr] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
const [opsOpen, setOpsOpen] = useState(false);
  const [records, setRecords] = useState<RecordsForDate>({});
  const [dayPlans, setDayPlans] = useState<Record<string, DayPlan>>({});
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null
  );
  const [selectedSubject, setSelectedSubject] = useState<string>("kor");
  // 학년 선택
  const [selectedGrade, setSelectedGrade] = useState("");

  // 여러 학생 선택
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  // 과목 선택
  const [ruleSubject, setRuleSubject] = useState("kor");

  // 여러 학생에게 넣을 과제 입력값
  const [multiTaskInput, setMultiTaskInput] = useState("");

  const [assignDate, setAssignDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const [localDoneMap, setLocalDoneMap] = useState<Record<string, boolean>>({});
  const [localSubDoneMap, setLocalSubDoneMap] =
    useState<Record<string, boolean>>({});

    const [printMode, setPrintMode] = useState<8 | 12>(12);

  const getYesterday = (date: string) => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  const getNextDate = (dateStr: string) => {
    const d = new Date(dateStr); // ✅ 정확히 이거
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };


   const getSchoolGroup = (s: any) => {
    const gl = (s.gradeLevel ?? "").toString();
    const g = (s.grade ?? "").toString();

    if (gl.includes("중") || g.includes("중")) return 0;
    if (gl.includes("고") || g.includes("고")) return 1;
    return 9;
  };

  const getGradeNumber = (s: any) => {
    const raw = `${s.grade ?? ""}`;
    const num = parseInt(raw.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(num) ? num : 99;
  };

const sortedStudents = useMemo(() => {
  const visible = students.filter((s: any) => !s.hidden && !s.isPaused && !s.removed);

  return visible.slice().sort((a: any, b: any) => {
    // 1) 중등 -> 고등
    const ga = getSchoolGroup(a);
    const gb = getSchoolGroup(b);
    if (ga !== gb) return ga - gb;

    // 2) 학년 오름차순
    const na = getGradeNumber(a);
    const nb = getGradeNumber(b);
    if (na !== nb) return na - nb;

    // 3) 이름순
    return (a.name ?? "").localeCompare(b.name ?? "", "ko");
  });
}, [students]);

  
const middle = sortedStudents.filter((s: any) => getSchoolGroup(s) === 0);
const high = sortedStudents.filter((s: any) => getSchoolGroup(s) === 1);

  // 학생 체크 토글
  const toggleStudent = (id: string) => {
    setSelectedStudentIds(prev =>
      prev.includes(id)
        ? prev.filter(s => s !== id)
        : [...prev, id]
    );
  };

  // 🔥 선택 학생들에게 오늘(dateStr) 과제 저장
  // 여러 학생에게 같은 과제 저장
  const saveMultiTask = async () => {
    if (!selectedStudentIds.length)
      return alert("학생을 1명 이상 선택하세요.");

    if (!multiTaskInput.trim())
      return alert("과제를 입력하세요.");

    if (!assignDate)
      return alert("날짜가 선택되지 않았습니다.");

    const tasks = multiTaskInput
      .split("\n")
      .map(t => t.trim())
      .filter(Boolean)
      .map(text => ({
        id: crypto.randomUUID(),   // ⭐ 반드시
        text,
        done: false,
        deleted: false,
      }))

    await Promise.all(
      selectedStudentIds.map(async (sid) => {
        const ref = doc(db, "studyPlans", sid, "days", assignDate);

        await setDoc(
          ref,
          {
            date: assignDate,
            [ruleSubject]: {
              teacherTasks: tasks,
              updatedAt: serverTimestamp(),
            },
          },
          { merge: true }
        );
      })
    );

    alert("✔ 선택한 학생들에게 과제가 저장되었습니다!");
  };

  // 🔽 여기!
  type DashboardSubTask = {
    text: string;
    done: boolean;
  };

  type DashboardTask = {
  id?: string;
  _uiId: string;
  sid: string;
  studentName: string;
  subjectKey: string;
  subjectLabel: string;
  date: string;
  taskIndex: number;          // ✅ 추가
  done: boolean;
  text?: string;
  title?: string;
  subtasks?: { text: string; done: boolean }[];
  deleted?: boolean;
  carriedFrom?: string;
};

  const taskByStudent = useMemo<Record<string, DashboardTask[]>>(() => {
    const map: Record<string, DashboardTask[]> = {};

    students.forEach((s) => {
      const day = dayPlans[s.id];
      if (!day || !day.subjects) return;

      Object.entries(day.subjects).forEach(([subjectKey, subj]: any) => {
  (subj.teacherTasks || []).forEach((task: any, taskIndex: number) => {
    if (!map[s.id]) map[s.id] = [];

    // ✅ task.date 같은 거 쓰지 말고, 이 페이지 문서 날짜(dateStr)로 고정
    // ✅ id가 있으면 id 기반으로 uiId를 안정화(렌더 재정렬/삭제에도 안전)
    const uiId = `${s.id}_${subjectKey}_${dateStr}_${task.id ?? taskIndex}`;

    map[s.id].push({
      id: task.id,
      _uiId: uiId,

      // ✅ 이거 추가(핵심): Firestore teacherTasks 배열에서의 진짜 인덱스
      taskIndex,

      sid: s.id,
      studentName: s.name,
      subjectKey,
      subjectLabel: SUBJECTS.find(x => x.key === subjectKey)?.label || subjectKey,

      // ✅ 문서 날짜
      date: dateStr,

      done: !!task.done,
      deleted: !!task.deleted,
      carriedFrom: task.carriedFrom,

      text: task.text,
      title: task.title,
      subtasks: Array.isArray(task.subtasks)
        ? task.subtasks.map((ss: any) => ({
            text: ss.text,
            done: !!ss.done,
          }))
        : [],
    });
  });
});
    });

    return map;
  }, [students, dayPlans, assignDate]);

  // 상세 입력 상태 (우측 하단)
  const [teacherInput, setTeacherInput] = useState("");
  const [studentInput, setStudentInput] = useState("");
  const [memo, setMemo] = useState("");
  const [done, setDone] = useState(false);

  const [loading, setLoading] = useState(false);
  // 1) 선택된 학생
  const [selectedRuleStudentId, setSelectedRuleStudentId] = useState("");

  // 2) 학생의 규칙 데이터
  const [ruleState, setRuleState] = useState<AssignmentRules>({});

  // 3) 요일 ON/OFF 함수
  const toggleRuleDay = (subject: string, day: Weekday) => {
    setRuleState(prev => {
      const cur = prev[subject] || { days: [] };
      const exists = cur.days.includes(day);

      return {
        ...prev,
        [subject]: {
          days: exists
            ? cur.days.filter(d => d !== day)
            : [...cur.days, day],
        },
      };
    });
  };



  // 4) 저장 함수
  const handleSaveRule = async () => {
    if (!selectedRuleStudentId) return alert("학생을 선택하세요.");

    await saveAssignmentRules(selectedRuleStudentId, ruleState);
    alert("저장 완료!");
  };



  /* ---------------- 학생 목록 로드 ---------------- */

  useEffect(() => {
    const loadStudents = async () => {
      const snap = await getDocs(collection(db, "students"));
    const list = snap.docs.map((d) => {
  const data = d.data() as any;
  return {
    id: d.id,
    name: data.name || "이름 없음",
    grade: data.grade,
    gradeLevel: data.gradeLevel, // ✅ 추가
    school: data.school,
    hidden: !!data.hidden,
    isPaused: !!data.isPaused,
    removed: !!data.removed,
  };
});
setStudents(list);

      // 첫 학생 자동 선택
      if (list.length > 0) {
        setSelectedRuleStudentId(list[0].id);
        setSelectedStudentId(list[0].id);
      }
    };

    loadStudents();
  }, []);

  useEffect(() => {
    if (!selectedRuleStudentId) return;

    const run = async () => {
      const loaded = await loadAssignmentRules(selectedRuleStudentId);

      if (loaded) {
        setRuleState(loaded);
      } else {
        // 과목별 빈 구조 생성
        const empty: AssignmentRules = {};
        ["kor", "math", "eng", "sci"].forEach((sub) => {
          empty[sub] = { days: [] };
        });
        setRuleState(empty);
      }
    };

    run();
  }, [selectedRuleStudentId]);

  /* ---------------- 출결 / 플래너 로드 (날짜별) ----- */
  useEffect(() => {
    loadDayPlans();
  }, [dateStr, students]);

  const loadDayPlans = async () => {
    if (!dateStr || students.length === 0) return;

    setLoading(true);
    try {
      // 1) 출결 records/<dateStr>
      const recSnap = await getDoc(doc(db, "records", dateStr));
      setRecords((recSnap.data() as any) || {});

      // 2) 각 학생 플래너 studyPlans/<sid>/days/<dateStr>
      const planMap: Record<string, DayPlan> = {};

      await Promise.all(
        students.map(async (s) => {
          const ref = doc(db, "studyPlans", s.id, "days", dateStr);
          const snap = await getDoc(ref);

          const subjects: Record<string, SubjectPlan> = {};

          if (snap.exists()) {
            const raw = snap.data() as any;

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
          }

          // ✅ 학생 단위로 한 번만
          planMap[s.id] = {
            date: dateStr,
            subjects,
          };
        })
      );

      // ✅ 여기서만 setDayPlans
      setDayPlans(planMap);

      console.log("✅ DayPlans Loaded", planMap);
    } finally {
      setLoading(false);
    }
  };




  /* ---------------- 우측 하단 상세 입력 동기화 ------- */


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
    const teacherTasks: TaskItem[] =
      prevSubj?.teacherTasks?.length
        ? prevSubj.teacherTasks
        : teacherInput
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
          .map(text => ({
            id: crypto.randomUUID(),   // ⭐ 반드시
            text,
            done: false,
            deleted: false,
          }))

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

  // 🔥 선생님 과제 1개 삭제 + 자동 이월
  const handleDeleteTeacherTask = async (
    sid: string,
    date: string,
    subjectKey: string,
    taskIndex: number
  ) => {
    if (!sid || !date) return;
    
    const ok = window.confirm("해당 과제를 삭제할까요?\n(확인을 누르면 즉시 삭제됩니다)");
    if (!ok) return;

    try {
      // 1. 정확한 위치(상세 주소) 찾기
      const dayRef = doc(db, "studyPlans", sid, "days", date);
      const snap = await getDoc(dayRef);
      
      if (!snap.exists()) {
        alert("데이터를 찾을 수 없습니다.");
        return;
      }

      const raw = snap.data();
      const subj = raw[subjectKey];
      
      if (!subj || !Array.isArray(subj.teacherTasks)) {
        alert("삭제할 과제가 목록에 없습니다.");
        return;
      }

      // 2. 데이터 복사해서 해당 순서(index) 과제만 쏙 빼기
      const tasks = [...subj.teacherTasks];
      const targetTask = tasks[taskIndex]; // 삭제될 과제 정보 보관

      tasks.splice(taskIndex, 1); // 선택한 번호 삭제

      const updatedSubject = {
        ...subj,
        teacherTasks: tasks,
        updatedAt: serverTimestamp(),
      };

      // 3. 파이어베이스에 최종 저장
      await setDoc(
        dayRef,
        { [subjectKey]: updatedSubject },
        { merge: true }
      );

      // 4. 화면(대시보드) 즉시 업데이트
      setDayPlans((prev) => {
        const day = prev[sid];
        if (!day) return prev;
        return {
          ...prev,
          [sid]: {
            ...day,
            subjects: {
              ...day.subjects,
              [subjectKey]: updatedSubject,
            },
          },
        };
      });

      alert("삭제가 완료되었습니다.");

    } catch (e) {
      console.error("삭제 실패 원인:", e);
      alert("삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
  };
const handlePrint = () => {
  const printElement = document.getElementById("print-area");
  if (!printElement) {
    alert("인쇄할 구역(#print-area)을 찾을 수 없어요!");
    return;
  }

  const cards = Array.from(printElement.querySelectorAll(".print-card"));
  if (cards.length === 0) {
    alert("학생 카드(.print-card)를 찾을 수 없어요! className 확인해줘요.");
    return;
  }

  // ✅ 8명(4x2) / 12명(4x3) 카드 높이만 다르게
  const cardHeight = printMode === 8 ? "130mm" : "88mm";

  const style = `
 <style>
@media print {
  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}

@page { size: A4 portrait; margin: 8mm; }

body {
  margin: 0;
  font-family: 'Malgun Gothic', sans-serif;
  background: #fff;
}

/* ✅ 4열 고정 */
.sheet {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6mm;
}

/* ✅ 카드 공통 */
.card {
  border: 1px solid #1E3A8A;
  border-radius: 6px;
  padding: 5mm;
  height: ${cardHeight};
  box-sizing: border-box;
  overflow: hidden;
  page-break-inside: avoid;
  background: #fff;
  position: relative;
}

/* 🔵 중학생 = 블루 상단라인 */
.card.middle::before {
  content: "";
  position: absolute;
  top: 0; left: 0;
  height: 3.5mm;
  width: 100%;
  background: #e4c66e;
}

/* 🔷 고등학생 = 네이비 상단라인 */
.card.high::before {
  content: "";
  position: absolute;
  top: 0; left: 0;
  height: 3.5mm;
  width: 100%;
  background: #1E3A8A;
}

/* ===== 카드 헤더 (중등/고등 + 이름) ===== */

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 3mm 0 3mm 0;
}

/* 중등/고등 배지 */
.tag {
  font-size: 8pt;
  font-weight: 900;
  padding: 0.6mm 2mm;
  border-radius: 999px;
  border: 1px solid #E5E7EB;
  background: #fff;
  white-space: nowrap;
}

.tag.middle {
  border-color: #f4d317;
  color: #312f27;
}

.tag.high {
  border-color: #1E3A8A;
  color: #1E3A8A;
}

/* 학생 이름 */
.name {
  margin: 0;
  font-weight: 800;
  font-size: 12pt;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #111827;
}

/* ===== 과제 ===== */

.task {
  font-size: 7pt;
  line-height: 1.2;
  margin: 1.2mm 0;
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
  color: #111827;
}

/* 이월 강조 */
.task.carried {
  font-weight: 800;
  color: #B91C1C;
}

/* 이월 배지 */
.badge {
  display: inline-block;
  font-size: 7pt;
  padding: 0.2mm 1.5mm;
  margin-right: 2mm;
  border: 1px solid #C00000;
  color: #C00000;
  border-radius: 999px;
  font-weight: 800;
}

/* 체크박스/버튼 숨김 */
input, button {
  display: none !important;
}
</style>
`;

  // ✅ print-card들을 가벼운 HTML로 변환
  const htmlCards = cards
  .map((card) => {

 const gradeLevel = (card.getAttribute("data-gradelevel") || "").toString();
const grade = (card.getAttribute("data-grade") || "").toString();
const raw = `${gradeLevel} ${grade}`;

const schoolClass =
  raw.includes("중") ? "middle" :
  raw.includes("고") ? "high" :
  "etc";

  const nameEl = card.querySelector(".print-name") || card.querySelector("div");
  const name = (nameEl?.textContent || "").trim();

  const taskEls = Array.from(card.querySelectorAll(".print-task b"));

  const tasks = taskEls
    .map((b) => {
      const text = (b.textContent || "").trim();
      const carried = b.getAttribute("data-carried") === "1";
      return { text, carried };
    })
    .filter((t) => !!t.text);

  const taskHtml = tasks
    .map(({ text, carried }) => {
      const badge = carried ? `<span class="badge">이월</span>` : "";
      const cls = carried ? "task carried" : "task";
      return `<div class="${cls}">• ${badge}${text}</div>`;
    })
    .join("");

  // ✅ ✅ 여기 추가
  const tagHtml =
    schoolClass === "etc"
      ? ""
      : `<span class="tag ${schoolClass}">
           ${schoolClass === "middle" ? "중등" : "고등"}
         </span>`;

  // ✅ return 안에서 tagHtml 사용
  return `<div class="card ${schoolClass}">
    <div class="head">
      ${tagHtml}
      <div class="name">${name}</div>
    </div>
    ${taskHtml}
  </div>`;
})
    .join("");

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("팝업이 차단됐어요! 팝업 허용 후 다시 시도해 주세요.");
    return;
  }

  win.document.open();
  win.document.write(`${style}<div class="sheet">${htmlCards}</div>`);
  win.document.close();

  win.focus();
  win.print();
  win.close();
};


  /* ---------------- 요약 테이블 계산 ---------------- */

  const summaryRows = useMemo(() => {
    return sortedStudents.map((s) => {
      const rec = records[s.id] || {};
      const netMin = calcNetStudyMin(rec);

      const day = dayPlans[s.id];
      const subj = day?.subjects?.[selectedSubject];

      let tDone = 0,
        tTotal = 0,
        stDone = 0,
        stTotal = 0,
        unfinishedCount = 0;

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
        unfinishedCount,
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

  /* ---------------- 선생님 과제 체크 테이블 rows ---------------- */

  type TeacherTask = {
    subjectKey: string;   // ✅ 이 줄 추가 (핵심)
    title?: string;
    text?: string;
    done: boolean;
    subtasks?: {
      text: string;
      done: boolean;
    }[];
  };

 const toggleMainFromDashboard = async (
  sid: string,
  date: string,
  subjectKey: string,
  taskIndex: number
) => {
  const ref = doc(db, "studyPlans", sid, "days", date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() as any;
  const subj = data?.[subjectKey];
  if (!subj?.teacherTasks) return;

  const tasks = subj.teacherTasks.map((t: any, i: number) => {
    if (i !== taskIndex) return t;

    // ✅ 수동 과제(이월이든 뭐든): 그냥 토글
    if (!Array.isArray(t.subtasks) || t.subtasks.length === 0) {
      return { ...t, done: !t.done };
    }

    // ✅ 자동 과제: 메인 토글 -> 서브 전체 토글
    const shouldComplete = !t.done;
    return {
      ...t,
      done: shouldComplete,
      subtasks: t.subtasks.map((s: any) => ({ ...s, done: shouldComplete })),
    };
  });

  await setDoc(ref, { [subjectKey]: { ...subj, teacherTasks: tasks } }, { merge: true });

  // ✅✅✅ 여기 추가: 화면 즉시 반영
  setDayPlans((prev) => ({
    ...prev,
    [sid]: {
      ...(prev[sid] || { date, subjects: {} as any }),
      date,
      subjects: {
        ...(prev[sid]?.subjects || {}),
        [subjectKey]: {
          ...(prev[sid]?.subjects?.[subjectKey] || {}),
          ...subj,
          teacherTasks: normalizeTasks(tasks), // ✅ 안정화
        },
      },
    },
  }));
};


  const toggleSubtaskFromDashboard = async (
  sid: string,
  date: string,
  subjectKey: string,
  taskIndex: number,
  subIndex: number
) => {
  const ref = doc(db, "studyPlans", sid, "days", date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() as any;
  const subj = data?.[subjectKey];
  if (!subj?.teacherTasks) return;

  const tasks = [...subj.teacherTasks];
  const task = tasks[taskIndex];
  if (!task || !Array.isArray(task.subtasks)) return;

  const newSubtasks = task.subtasks.map((s: any, i: number) =>
    i === subIndex ? { ...s, done: !s.done } : s
  );

  const allDone = newSubtasks.every((s: any) => s.done);

  tasks[taskIndex] = {
    ...task,
    subtasks: newSubtasks,
    done: allDone,
  };

  await setDoc(ref, { [subjectKey]: { ...subj, teacherTasks: tasks } }, { merge: true });

  // ✅✅✅ 여기 추가: 화면 즉시 반영
  setDayPlans((prev) => ({
    ...prev,
    [sid]: {
      ...(prev[sid] || { date, subjects: {} as any }),
      date,
      subjects: {
        ...(prev[sid]?.subjects || {}),
        [subjectKey]: {
          ...(prev[sid]?.subjects?.[subjectKey] || {}),
          ...subj,
          teacherTasks: normalizeTasks(tasks),
        },
      },
    },
  }));
};

  const carryOverMainTask = async (
    sid: string,
    baseDate: string,
    task: DashboardTask,
    remainingSubs: { text: string; done: boolean }[],
  ) => {
    // 0️⃣ 기초 확인
    if (!baseDate || !sid || !task.subjectKey) {
      alert("정보가 부족하여 이월할 수 없습니다.");
      return;
    }

    const subjectKey = task.subjectKey;
    const nextDate = getNextDate(baseDate); // 내일 날짜 계산
    const firestoreTaskId = task.id ?? task._uiId;

    try {
      // 1️⃣ 내일(다음날) 문서에 새 과제 추가하기
      const nextRef = doc(db, "studyPlans", sid, "days", nextDate);
      const nextSnap = await getDoc(nextRef);
      const nextData = nextSnap.exists() ? nextSnap.data() : {};
      const prevNextTasks = nextData?.[subjectKey]?.teacherTasks || [];

      const newTask = {
  id: crypto.randomUUID(),
  title: task.title || "",
  text: task.text || "",
  done: false,
  deleted: false,           // ✅ 명시 (안전)
  subtasks: remainingSubs.length > 0
    ? remainingSubs.map(s => ({ text: s.text, done: false }))
    : (task.subtasks || []).map(s => ({ text: s.text, done: false })),
  carriedFrom: baseDate,  
      };

      await setDoc(nextRef, {
        [subjectKey]: {
          ...(nextData?.[subjectKey] || {}),
          teacherTasks: [...prevNextTasks, newTask],
        },
      }, { merge: true });

      // 2️⃣ 오늘 문서에서 원본 과제 완전히 삭제하기
      const todayRef = doc(db, "studyPlans", sid, "days", baseDate);
const todaySnap = await getDoc(todayRef);

if (todaySnap.exists()) {
  const todayData = todaySnap.data() as any;
  const todaySubj = todayData?.[subjectKey] || {};
  const todayTasks = Array.isArray(todaySubj.teacherTasks) ? todaySubj.teacherTasks : [];

  const updatedTodayTasks = todayTasks.map((t: any) =>
    (t.id ?? t._uiId) === firestoreTaskId
      ? {
          ...t,
          deleted: true,          // ✅ 전날 “이월됨” 표시
          done: false,            // (선택) 전날은 보통 false로 두는게 UX 깔끔
          carriedTo: nextDate,    // (선택) 나중에 표시/디버깅 편함
        }
      : t
  );

  await setDoc(
    todayRef,
    {
      date: baseDate,
      [subjectKey]: {
        ...todaySubj,
        teacherTasks: updatedTodayTasks,
        updatedAt: serverTimestamp(),
      },
    },
    { merge: true }
  );

      }
      // 3️⃣ 화면 새로고침
      alert("✅ 과제가 내일로 성공적으로 넘어갔습니다!");
      await loadDayPlans();

    } catch (e) {
      console.error("이월 중 에러:", e);
      alert("이월에 실패했습니다. 코드를 확인해주세요.");
    }
  };

  const deleteMainTask = async (
    sid: string,
    date: string,        // ✅ 반드시 task.date
    subjectKey: string,
    taskUiId: string     // ✅ task._uiId 를 받자 (가장 안전)
  ) => {
    const ok = window.confirm("이 과제를 완전히 삭제할까요? (되돌릴 수 없음)");
    if (!ok) return;

    try {
      const ref = doc(db, "studyPlans", sid, "days", date);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;

      const data = snap.data() as any;
      const subj = data?.[subjectKey] || {};
      const tasks: any[] = Array.isArray(subj.teacherTasks) ? subj.teacherTasks : [];

      // ✅ 원본 Firestore task.id == task._uiId 로 매칭해서 삭제
      const nextTasks = tasks.filter((t: any) => (t.id ?? t._uiId) !== taskUiId);

      await setDoc(
        ref,
        {
          [subjectKey]: {
            ...subj,
            teacherTasks: nextTasks,
          },
        },
        { merge: true }
      );

      alert("✅ 삭제 완료");
      await loadDayPlans(); // 🔥 화면 즉시 갱신
    } catch (e) {
      console.error("❌ deleteMainTask failed", e);
      alert("삭제 실패");
    }
  };

  const toggleTeacherTaskDone = async (
    sid: string,
    date: string,
    subject: string,
    taskIndex: number,
    newDone: boolean
  ) => {
    const ref = doc(db, "studyPlans", sid, "days", date);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data() as any;
    const tasks = [...(data[subject]?.teacherTasks || [])];

    tasks[taskIndex] = {
      ...tasks[taskIndex],
      done: newDone,
    };

    await setDoc(
      ref,
      {
        [subject]: {
          ...data[subject],
          teacherTasks: tasks,
          updatedAt: serverTimestamp(),
        },
      },
      { merge: true }
    );

    // 🔥 화면 즉시 반영
    setDayPlans((prev) => ({
      ...prev,
      [sid]: {
        ...prev[sid],
        subjects: {
          ...prev[sid]?.subjects,
          [subject]: {
            ...prev[sid]?.subjects?.[subject],
            teacherTasks: tasks,
          },
        },
      },
    }));
  };


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
<OpsModal open={opsOpen} onClose={() => setOpsOpen(false)} />
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
          <button
  onClick={() => {
    console.log("운영 버튼 클릭됨");
    setOpsOpen(true);
  }}
  style={{
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: "8px 12px",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  }}
>
  운영(타임/출결)
</button>
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
          <>
  {/* 중학생 */}
  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
    🎓 중학생
  </div>

  {middle.map((s) => {
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
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700 }}>{s.name}</span>
          <span style={{ fontSize: 11, color: "#6B7280" }}>
            {s.school} {s.grade}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#6B7280" }}>
          순공: <b style={{ color: "#16A34A" }}>{minToHM(net)}</b>
        </div>
      </button>
    );
  })}

  {/* 고등학생 */}
  <div style={{ fontSize: 12, fontWeight: 800, margin: "12px 0 6px" }}>
    🎓 고등학생
  </div>

  {high.map((s) => {
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
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700 }}>{s.name}</span>
          <span style={{ fontSize: 11, color: "#6B7280" }}>
            {s.school} {s.grade}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#6B7280" }}>
          순공: <b style={{ color: "#16A34A" }}>{minToHM(net)}</b>
        </div>
      </button>
    );
  })}
</>
          </div>
        </div>

        {/* 우측: 요약 테이블 + 상세 플래너 */}
        <div
          style={{
            display: "grid",

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

          {/* 🔥 다중 과제 + 개인 플래너 한 줄 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              alignItems: "stretch", // ⭐ 이게 핵심
              gridAutoRows: "1fr",
            }}
          >


            {/* ========================================= */}
            {/* 🔥 학년별 · 다중 학생 오늘 과제 입력 */}
            {/* ========================================= */}

            <div
              style={{
                background: "#FFFFFF",
                borderRadius: 12,
                border: "1px solid #E5E7EB",
                padding: 16,
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>
                📝 학년별 · 다중학생 오늘 과제 입력
              </div>

              {/* 1) 학년 선택 */}
              {/* 🔥 한 줄로 정렬되는 선택 UI */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                {/* 학년 선택 */}
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, marginRight: 6 }}>
                    학년:
                  </label>
                  <select
                    value={selectedGrade}
                    onChange={(e) => {
                      setSelectedGrade(e.target.value);
                      setSelectedStudentIds([]);
                    }}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #CBD5E1",
                    }}
                  >
                    <option value="">학년 선택</option>
                    <option value="1">중1</option>
                    <option value="2">중2</option>
                    <option value="3">중3</option>
                  </select>
                </div>

                {/* 과목 */}
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, marginRight: 6 }}>
                    과목:
                  </label>
                  <select
                    value={ruleSubject}
                    onChange={(e) => setRuleSubject(e.target.value)}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #CBD5E1",
                    }}
                  >
                    <option value="kor">국어</option>
                    <option value="math">수학</option>
                    <option value="eng">영어</option>
                    <option value="sci">과학</option>
                    <option value="soc">사회</option>
                    <option value="hist1">역사1</option>
                    <option value="hist2">역사2</option>
                    <option value="tech">기술가정</option>
                    <option value="hanja">한자</option>
                    <option value="jp">일본어</option>
                  </select>
                </div>

                {/* 날짜 */}
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, marginRight: 6 }}>
                    날짜:
                  </label>
                  <input
                    type="date"
                    value={assignDate}
                    onChange={(e) => setAssignDate(e.target.value)}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #CBD5E1",
                    }}
                  />
                </div>
              </div>{/* ============================== */}
              {/* 🔥 2) 체크 가능한 학생 목록 */}
              {/* ============================== */}

              {selectedGrade && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    학생 선택:
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      maxHeight: 120,
                      overflowY: "auto",
                      padding: 6,
                      border: "1px solid #E5E7EB",
                      borderRadius: 8,
                    }}
                  >
                    {students
                      .filter((s) => {
                        // 🔥 학생 grade가 "중3", " 3 ", 3 등 어떤 형식이든 숫자만 비교
                        const gradeNum = String(s.grade).replace(/[^0-9]/g, "");
                        return gradeNum === String(selectedGrade);
                      })
                      .map((s) => (
                        <label key={s.id} style={{ fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={selectedStudentIds.includes(s.id)}
                            onChange={() => toggleStudent(s.id)}
                            style={{ marginRight: 4 }}
                          />
                          {s.name}
                        </label>
                      ))}

                    {/* 🔥 필터된 학생이 0명일 때 */}
                    {students.filter((s) => {
                      const gradeNum = String(s.grade).replace(/[^0-9]/g, "");
                      return gradeNum === String(selectedGrade);
                    }).length === 0 && (
                        <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                          해당 학년에 학생이 없습니다.
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* 4) 과제 내용 입력 */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  과제 내용:
                </label>
                <textarea
                  value={multiTaskInput}
                  onChange={(e) => setMultiTaskInput(e.target.value)}
                  placeholder={"예) 영어 단어 20개 외우기\n문법 p.45~47"}
                  rows={4}
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    border: "1px solid #CBD5E1",
                    padding: 8,
                    fontSize: 12,
                  }}
                />
              </div>

              {/* 5) 저장 버튼 */}
              <button
                onClick={saveMultiTask}
                style={{
                  padding: "10px 0",
                  width: "100%",
                  background: "#1E3A8A",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                ✔ 선택 학생들에게 오늘 과제 저장하기
              </button>
            </div>

            {/* 상세 플래너 (선택 학생 · 오늘 날짜 1일분) */}
            <div
              style={{
                background: "#FFFFFF",
                borderRadius: 14,
                border: "1px solid #E5E7EB",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                height: "100%",
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
                  {/* 🔥 선생님 과제 목록 (개별 삭제 UI) */}
                  {(() => {
                    const sid = selectedStudentId;
                    if (!sid) return null;

                    const day = dayPlans[sid];
                    const subj = day?.subjects?.[selectedSubject];
                    const tasks = subj?.teacherTasks || [];

                    return (
                      <div style={{ marginBottom: 12 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#4B5563",
                            marginBottom: 6,
                          }}
                        >
                          📘 자동 배정 과제 목록 (삭제 가능)
                        </div>

                        {tasks.length === 0 && (
                          <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                            등록된 과제가 없습니다.
                          </div>
                        )}

                        {(() => {
                          const teacherTasks = tasks as DashboardTask[];

                         return teacherTasks.map((task, i) => {
  // 1️⃣ 이월 보낸 과제인지 확인하는 '스위치' (1일 날 과제에 deleted: true가 박힘)
  const isOldDeleted = task.deleted === true;

  return (
    <div key={task._uiId} style={{ marginBottom: 10 }}>
      {/* 2️⃣ 정렬을 위해 justifyContent 추가 */}
      <div style={{ 
  display: "flex", 
  alignItems: "center", 
  justifyContent: "space-between", // ⭐ 1. 양 끝으로 벌려라!
  width: "100%",                   // ⭐ 2. 가로 길이를 꽉 채워라!
  gap: 10                          // 3. 제목이랑 버튼 사이 최소 간격
}}>
        
        <label style={{ display: "flex", gap: 6, alignItems: "center", flex: 1, cursor: "pointer" }}>
          <input
  type="checkbox"
  checked={task.done}
  disabled={isOldDeleted}
  onChange={() =>
    toggleMainFromDashboard(sid, dateStr, task.subjectKey, i)
  }
/>

<b
  style={{
    textDecoration: isOldDeleted ? "line-through" : "none",
    color: isOldDeleted ? "#999" : "#000",
    opacity: isOldDeleted ? 0.5 : 1,
    fontSize: 13
  }}
>
  {task.title || task.text}
  {isOldDeleted && (
    <span
      style={{
        marginLeft: 6,
        fontSize: 11,
        color: "#EF4444",
        fontWeight: 700
      }}
    >
      (이월됨)
    </span>
  )}
</b>
        </label>

      {/* [오른쪽]: 삭제 버튼 */}
      <button
        type="button"
        onClick={async () => {
          if (window.confirm("이 과제를 정말 삭제할까요?")) {
            try {
              await handleDeleteTeacherTask(sid, dateStr, selectedSubject, i);
              window.location.reload(); 
            } catch (e) {
              alert("삭제 실패");
            }
          }
        }}
        style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 4,
          border: "1px solid #FCA5A5", background: "#fff",
          color: "#EF4444", fontWeight: 600, cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        삭제
      </button>
    </div>

                                {Array.isArray(task.subtasks) &&
                                  task.subtasks.map((s, j) => (
                                    <div
                                      key={j}
                                      style={{
                                        marginLeft: 22,
                                        display: "flex",
                                        gap: 6,
                                        fontSize: 12,
                                        marginTop: 4,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={s.done}
                                        onChange={() =>
                                          toggleSubtaskFromDashboard(
                                            sid,
                                            task.date,
                                            task.subjectKey,
                                            i,
                                            j
                                          )
                                        }
                                      />
                                      <span>{s.text}</span>
                                    </div>
                                  ))}
                              </div>



                            );
                          });
                        })()}
                      </div>
                    );
                  })()}
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

                  {/* 🖨️ 인쇄 모드 선택 */}
<div style={{ display: "flex", gap: 6, marginTop: 8 }}>
  <button
    type="button"
    onClick={() => setPrintMode(8)}
    style={{
      flex: 1,
      padding: "6px 0",
      borderRadius: 8,
      border: printMode === 8 ? "2px solid #1E3A8A" : "1px solid #E5E7EB",
      background: printMode === 8 ? "#EEF2FF" : "#fff",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
    }}
  >
    8명 / 페이지
  </button>

  <button
    type="button"
    onClick={() => setPrintMode(12)}
    style={{
      flex: 1,
      padding: "6px 0",
      borderRadius: 8,
      border: printMode === 12 ? "2px solid #1E3A8A" : "1px solid #E5E7EB",
      background: printMode === 12 ? "#EEF2FF" : "#fff",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
    }}
  >
    12명 / 페이지
  </button>
</div>

{/* 🖨️ 인쇄 버튼 추가 */}
<button
  onClick={handlePrint}
  style={{
    marginTop: 8,
    width: "100%",
    padding: "9px 0",
    borderRadius: 10,
    border: "1px solid #1E3A8A",
    background: "#fff",
    color: "#1E3A8A",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px"
  }}
>
  <span>🖨️</span> 과제 목록 인쇄하기
</button>


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

          {/* 🔥 학생별 과제 카드 · 과목별 이월 */}
          {/* ======================================= */}
          <div
          id="print-area"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 14,
              marginTop: 16,
            }}
          >
          {sortedStudents.map((student) => {
  const sid = student.id;
  const tasks = taskByStudent[sid] || [];
  if (!tasks.length) return null;

              const level =
  (student.gradeLevel ?? "").toString().includes("중") || String(student.grade ?? "").includes("중")
    ? "middle"
    : (student.gradeLevel ?? "").toString().includes("고") || String(student.grade ?? "").includes("고")
    ? "high"
    : "etc";

return (
 <div
  key={sid}
  className="print-card"
  data-gradelevel={student.gradeLevel ?? ""}
  data-grade={String(student.grade ?? "")}
  style={{
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 12,
    background: "#fff",
  }}
>
                  <div
  className="print-name"   // ✅ (선택)
  style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}
>
  {student.name}
</div>

                  {tasks.map((task, i) => {
                    const baseDate = task.date ?? assignDate;
                    const isCarried = task.deleted === true;
                    console.log(
                      "[RENDER TASK]",
                      task.text,
                      task.deleted,
                      task
                    );


                    const key = task._uiId;
                    const isDone = task.done;
                    const renderedSubtasks = (task.subtasks ?? []).map((s, j) => {

                      const subKey = `${task._uiId}_sub_${j}`;
                      return {
                        ...s,
                        isDone: localSubDoneMap[subKey] ?? s.done,
                      };
                    });

                    const hasIncompleteSub =
                      renderedSubtasks.length === 0 ||
                      renderedSubtasks.some(s => !s.isDone);

                    const canCarryOver =
  !task.deleted &&        // 아직 이월 안 됐고
  task.date === baseDate; // 오늘 과제면 무조건

                    const totalSubs = renderedSubtasks.length;

                    const studentDoneCount =
                      renderedSubtasks.filter(s => s.isDone).length;

                    const progress =
                      totalSubs > 0 ? (studentDoneCount / totalSubs) * 100 : 0;

                    console.log(
                      "[PROGRESS]",
                      studentDoneCount,
                      totalSubs,
                      progress
                    );

 const studentDone =
                      totalSubs > 0 && studentDoneCount === totalSubs;
                    const teacherDone = task.done;
                    const progressColor =
                      teacherDone ? "#10B981" : studentDone ? "#3B82F6" : "#E5E7EB";
                    const hasSubtasks =
                      Array.isArray(task.subtasks) && task.subtasks.length > 0;

                    const isMainCarryOver =
                      !teacherDone &&
                      (
                        !hasSubtasks ||
                        task.subtasks!.some(s => !s.done)
);

                    const partialCarryOverSubtasks =
                      hasSubtasks
                        ? task.subtasks!.filter(s => !s.done)
                        : [];
console.log(`[버튼 체크 - ${task.text}]`, {
    isDeleted: task.deleted,          // 이게 true면 안 나옴
    dateMatch: task.date === baseDate, // 이게 false면 안 나옴
    isTeacherDone: teacherDone,        // 이게 true면 안 나옴 (선생님이 완료하면 이월 불가)
    hasIncompleteSub: !hasSubtasks || (task.subtasks && task.subtasks.some(s => !s.done))
  });
  const isCarryOver = isCarried; // = task.deleted === true (이월로 사용)

const bg = isCarryOver
  ? "#FFFBEB" // 이월: 아주 연한 노랑
  : isDone
  ? "#E5F0FF" // 완료(학생체크): 연한 파랑
  : "#F9FAFB"; // 기본
return (
  <div
    key={key}
    className="print-task"
    style={{
      padding: "8px 10px",
      borderRadius: 8,
      marginBottom: 6,
      background: bg,

      // ✅ 이월 강조: 왼쪽 라인만 주황
      borderLeft: isCarryOver ? "6px solid #FB923C" : undefined,

      border: isDone ? "1px solid #93C5FD" : "1px solid #E5E7EB",
      opacity: isDone ? 0.7 : 1,
    }}
  >
    {/* 🔹 메인 과제 */}
    <label style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>
      <input
        type="checkbox"
        checked={isDone}
        disabled={isCarried}
        onChange={() => {
          if (isCarried) return;
          setLocalDoneMap((prev) => ({
            ...prev,
            [key]: !isDone,
          }));

          toggleMainFromDashboard(sid, dateStr, task.subjectKey, task.taskIndex);
        }}
      />

      <div
  style={{
    display: "grid",
    gridTemplateColumns: "1fr auto", // ✅ 왼쪽 1칸, 오른쪽 1칸
    alignItems: "center",
    columnGap: 8,
    width: "100%",
  }}
>
  {/* 왼쪽: 과제 제목 */}
 <b
  data-carried={isCarryOver ? "1" : "0"}
  style={{
    color: isCarryOver ? "#B91C1C" : "#111827", // 🔴 확실한 빨강
    fontWeight: isCarryOver ? 800 : 600,
    background: isCarryOver ? "#FEE2E2" : "transparent",
    padding: isCarryOver ? "2px 4px" : 0,
    borderRadius: 4,
  }}
>
  {task.title || task.text}
</b>

  {/* 오른쪽: 배지/문구/버튼 한 덩어리 */}
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      justifySelf: "end", // ✅ 무조건 오른쪽 끝
      whiteSpace: "nowrap",
    }}
  >
    {/* 이월 배지 */}
    {isCarryOver && (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: 18,
          padding: "0 8px",
          borderRadius: 999,
          background: "#FEF3C7",
          border: "1px solid #FCD34D",
          color: "#92400E",
          fontWeight: 800,
          fontSize: 11,
        }}
      >
        이월
      </span>
    )}

    {/* 학생 완료 문구 */}
    {studentDone && !teacherDone && (
      <span
        style={{
          fontSize: 11,
          color: "#F59E0B",
          fontWeight: 600,
        }}
      >
        학생 완료
      </span>
    )}

    {/* 메인 이월 버튼 (이월된 건 숨김) */}
    {!isCarryOver && (
      <button
        type="button"
        onClick={() => {
          const baseDate = task.date ?? assignDate;
          carryOverMainTask(
            sid,
            baseDate,
            task,
            renderedSubtasks.filter((s) => !s.isDone)
          );
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: 20,
          padding: "0 8px",
          borderRadius: 999,
          background: "#FFF7ED",
          color: "#9A3412",
          border: "1px solid #FDBA74",
          fontWeight: 800,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        이
      </button>
    )}
  </div>
</div>
    </label>

    {/* 진행바 */}
    {hasSubtasks && (
      <div
        style={{
          height: 8,
          background: "#F1F5F9",
          borderRadius: 999,
          marginTop: 6,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "#3B82F6",
            transition: "width 0.25s ease",
          }}
        />
      </div>
    )}

    {/* 서브태스크 */}
    {renderedSubtasks.map((s, j) => {
      const subkey = `${task._uiId}_sub_${j}`;
      const isSubDone = s.isDone;

      return (
        <div
          key={subkey}
          style={{
            marginLeft: 22,
            marginTop: 4,
            fontSize: 11,
            opacity: isSubDone ? 0.6 : 1,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <input
            type="checkbox"
            checked={isSubDone}
            onChange={() => {
              setLocalSubDoneMap((prev) => ({
                ...prev,
                [subkey]: !isSubDone,
              }));

              toggleSubtaskFromDashboard(sid, dateStr, task.subjectKey, task.taskIndex, j);
            }}
          />

          <span style={{ textDecoration: isSubDone ? "line-through" : "none" }}>
            {s.text}
          </span>

                              {/* 🔥 서브 이월 버튼 */}
                              {/*
                              {!isSubCarried && isSubCarry && (
                                <button
                                  type="button"
                                  onClick={() => carryOverSubtask(sid, task, s)}
                                  style={{
                                    fontSize: 9,
                                    padding: "1px 6px",
                                    borderRadius: 999,
                                    background: "#FDE68A",
                                    color: "#92400E",
                                    fontWeight: 600,
                                    border: "1px solid #FCD34D",
                                    cursor: "pointer",
                                  }}
                                >
                                  이월
                                </button>
                                
                              )}*/}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
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