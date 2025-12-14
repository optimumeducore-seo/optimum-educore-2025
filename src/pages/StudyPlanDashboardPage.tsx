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
  grade?: string;
  school?: string;
  removed?: boolean;
};

type TaskItem = {
  text?: string;   // 수동 과제
  title?: string;  // 자동 과제
  done?: boolean;
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
    title: x.title,          // ✅ 추가
    text: x.text || "",      // 수동용
    done: !!x.done,
    carriedFrom: x.carriedFrom,
    subtasks: Array.isArray(x.subtasks)
      ? x.subtasks.map((s: any) => ({
        text: s.text,
        done: !!s.done,
      }))
      : undefined,
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

  const getYesterday = (date: string) => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  const getNextDate = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };

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
      .map(text => ({ text, done: false }));

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
    _uiId: string;
    sid: string;
    studentName: string;
    subjectKey: string;
    subjectLabel: string;
    date: string;
    done: boolean;
    text?: string;
    title?: string;
    subtasks?: DashboardSubTask[];
  };

  const taskByStudent = useMemo<Record<string, DashboardTask[]>>(() => {
    const map: Record<string, DashboardTask[]> = {};

    students.forEach((s) => {
      const day = dayPlans[s.id];
      if (!day || !day.subjects) return;

      Object.entries(day.subjects).forEach(([subjectKey, subj]: any) => {
        (subj.teacherTasks || []).forEach((task: any) => {
          if (!map[s.id]) map[s.id] = [];
          const uiId = `${s.id}_${subjectKey}_${task.date}_${map[s.id].length}`;

          map[s.id].push({
            _uiId: uiId,
            sid: s.id,
            studentName: s.name,
            subjectKey,
            subjectLabel:
              SUBJECTS.find(x => x.key === subjectKey)?.label || subjectKey,
            date: task.date,

            done: !!task.done,   // ✅ 하나로 통일

            text: task.text,
            title: task.title,

            subtasks: Array.isArray(task.subtasks)
              ? task.subtasks.map((s: any) => ({
                text: s.text,
                done: !!s.done,   // ✅ 하나로 통일
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
      const list: StudentLite[] = snap.docs.map((d) => ({
        id: d.id,
        name: (d.data() as any).name || "이름 없음",
        grade: (d.data() as any).grade,
      }));

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
              console.log("🔥 RAW teacherTasks", sRaw.teacherTasks);
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
              setDayPlans(planMap);

              const firstSid = Object.keys(planMap)[0];
              console.log(
                "🔥 AFTER setDayPlans",
                planMap[firstSid]?.subjects
              );
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
          .map((text) => ({
            text,
            done: false,
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

  // 🔥 선생님 과제 1개 삭제 + 자동 이월
  const handleDeleteTeacherTask = async (
    sid: string,
    date: string,
    subjectKey: string,
    taskIndex: number
  ) => {
    if (!sid) return;
    if (!window.confirm("해당 과제를 삭제할까요?\n(미완료분은 다음 적절한 날짜로 이월됩니다)"))
      return;

    // 기존 데이터 로드
    const dayRef = doc(db, "studyPlans", sid, "days", date);
    const snap = await getDoc(dayRef);
    if (!snap.exists()) return;

    const raw = snap.data() as any;
    const subj = raw[subjectKey];
    if (!subj || !Array.isArray(subj.teacherTasks)) return;

    const tasks = [...subj.teacherTasks];
    const targetTask = tasks[taskIndex] as MainTask;

    // 🔥 1) 현재 날짜에서 해당 과제 삭제
    tasks.splice(taskIndex, 1);

    const updatedSubject = {
      ...subj,
      teacherTasks: tasks,
      updatedAt: serverTimestamp(),
    };

    await setDoc(
      dayRef,
      { date, [subjectKey]: updatedSubject },
      { merge: true }
    );

    // 🔥 2) 자동 과제(서브태스크 있는 경우)라면 → 자동 이월
    if (targetTask && Array.isArray(targetTask.subtasks)) {
      await rescheduleDeletedAutoTask({
        studentId: sid,
        subjectKey,
        fromDate: date,
        task: targetTask,
      });
    }

    // 🔥 3) 대시보드 화면 즉시 반영
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

    const subj = snap.data()[subjectKey];
    if (!subj?.teacherTasks) return;

    const tasks = subj.teacherTasks.map((t: any, i: number) => {
      if (i !== taskIndex) return t;

      if (!Array.isArray(t.subtasks)) {
        return { ...t, done: !t.done };
      }

      const shouldComplete = !t.done;
      return {
        ...t,
        done: shouldComplete,
        subtasks: t.subtasks.map((s: any) => ({
          ...s,
          done: shouldComplete,
        })),
      };

    });

    await setDoc(
      ref,
      { [subjectKey]: { ...subj, teacherTasks: tasks } },
      { merge: true }
    );
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

    const data = snap.data();
    const subject = data[subjectKey];
    if (!subject) return;

    const tasks = subject.teacherTasks ?? [];
    const task = tasks[taskIndex];
    if (!task || !Array.isArray(task.subtasks)) return;

    const newSubtasks = task.subtasks.map((s: any, i: number) =>
      i === subIndex ? { ...s, done: !s.done } : s
    );

    const newTasks = tasks.map((t: any, i: number) =>
      i === taskIndex ? { ...t, subtasks: newSubtasks } : t
    );

    await setDoc(
      ref,
      {
        [subjectKey]: {
          ...subject,
          teacherTasks: newTasks,
        },
      },
      { merge: true }
    );
  };

  const carryOverMainTask = async (
    sid: string,
    task: DashboardTask,
    remainingSubs: {
      text: string;
      done: boolean;
    }[]
  ) => {
    // 🔹 기준 날짜는 task.date
    const nextDate = getNextDate(task.date);

    const ref = doc(db, "studyPlans", sid, "days", nextDate);
    const snap = await getDoc(ref);

    const subjectKey = task.subjectKey;
    const data = snap.exists() ? snap.data() : {};

    const prevTasks = data?.[subjectKey]?.teacherTasks || [];

    // ✅ Firestore용 MainTask 생성
    const newTask = {
      id: crypto.randomUUID(),          // ⭐ 필수
      title: task.title,
      text: task.text,
      done: false,
      date: nextDate,
      subtasks:
        remainingSubs.length > 0
          ? remainingSubs.map(s => ({
            text: s.text,
            done: false,               // 🔥 핵심
          }))
          : Array.isArray(task.subtasks)
            ? task.subtasks.map(s => ({
              text: s.text,
              done: false,
            }))
            : [],
      carriedFrom: task.date,           // ⭐ 추적용
    };

    await setDoc(
      ref,
      {
        [subjectKey]: {
          ...(data?.[subjectKey] || {}),
          teacherTasks: [...prevTasks, newTask],
        },
      },
      { merge: true }
    );

    alert("✅ 과제가 다음 날로 이월되었습니다");
  };

  const carryOverSubtask = async (
    sid: string,
    task: DashboardTask,
    subtask: {
      text: string;
      done: boolean;
    }
  ) => {
    const nextDate = getNextDate(task.date);

    const ref = doc(db, "studyPlans", sid, "days", nextDate);
    const snap = await getDoc(ref);

    const subjectKey = task.subjectKey;
    const data = snap.exists() ? snap.data() : {};
    const prevTasks = data?.[subjectKey]?.teacherTasks || [];

    const newTask = {
      title: task.title,
      text: task.text,
      done: false,
      date: nextDate,
      subtasks: [
        {
          text: subtask.text,
          done: false,
        },
      ],
      carriedFrom: task.date,
    };

    await setDoc(
      ref,
      {
        [subjectKey]: {
          ...(data?.[subjectKey] || {}),
          teacherTasks: [...prevTasks, newTask],
        },
      },
      { merge: true }
    );
  };;



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

                          return teacherTasks.map((task, i) => (
                            <div key={task._uiId} style={{ marginBottom: 10 }}>
                              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={task.done}
                                  onChange={() =>
                                    toggleMainFromDashboard(
                                      sid,
                                      task.date,        // ✅ 무조건 task.date
                                      task.subjectKey,
                                      i
                                    )
                                  }
                                />
                                <b>{task.title || task.text}</b>
                              </label>

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
                                          dateStr,
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
                          ));
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
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 14,
              marginTop: 16,
            }}
          >
            {Object.entries(taskByStudent).map(([sid, tasks]) => {
              const student = students.find((s) => s.id === sid);
              if (!student) return null;

              return (
                <div
                  key={sid}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 10,
                    padding: 12,
                    background: "#fff",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>
                    {student.name}
                  </div>

                  {tasks.map((task, i) => {
                    const key = task._uiId;
                    const isDone =
                      localDoneMap[key] ?? task.done;
                    const renderedSubtasks = (task.subtasks ?? []).map((s, j) => {
                      const subKey = `${task._uiId}_sub_${j}`;
                      return {
                        ...s,
                        isDone: localSubDoneMap[subKey] ?? s.done,
                      };
                    });

                    const isPast = task.date && task.date < dateStr;
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
                      isPast &&
                      !teacherDone &&
                      (
                        !hasSubtasks ||
                        task.subtasks!.some(s => !s.done)
                      );

                    const partialCarryOverSubtasks =
                      isPast && hasSubtasks
                        ? task.subtasks!.filter(s => !s.done)
                        : [];


                    return (
                      <div
                        key={key}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          marginBottom: 6,
                          background: isDone ? "#E5F0FF" : "#F9FAFB",
                          border: isDone ? "1px solid #93C5FD" : "1px solid #E5E7EB",
                          opacity: isDone ? 0.7 : 1,
                        }}
                      >
                        {/* 🔹 메인 과제 */}
                        <label style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={isDone}
                            onChange={() => {
                              setLocalDoneMap(prev => ({
                                ...prev,
                                [key]: !isDone,
                              }));

                              toggleMainFromDashboard(
                                sid,
                                dateStr,
                                task.subjectKey,
                                i
                              );
                            }}
                          />

                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <b>{task.title || task.text}</b>
                            {studentDone && !teacherDone && (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontSize: 11,
                                  color: "#F59E0B",
                                  fontWeight: 500,
                                }}
                              >
                                학생 완료 (확인 필요)
                              </span>
                            )}

                            {/* 🔥 메인 이월 뱃지 */}
                            {isMainCarryOver && (
                              <button
                                type="button"
                                onClick={() =>
                                  carryOverMainTask(
                                    sid,
                                    task,
                                    partialCarryOverSubtasks   // ⭐ 중요
                                  )
                                }
                                style={{
                                  fontSize: 10,
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  background: "#FEF3C7",
                                  color: "#92400E",
                                  fontWeight: 700,
                                  border: "1px solid #FCD34D",
                                  cursor: "pointer",
                                }}
                              >
                                이월
                              </button>
                            )}
                          </div>
                        </label>
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

                       {renderedSubtasks.map((s, j) => {
  const subkey = `${task._uiId}_sub_${j}`;
  const isSubDone = s.isDone;
  const isSubCarry = isPast && !s.isDone;

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
          setLocalSubDoneMap(prev => ({
            ...prev,
            [subkey]: !isSubDone,
          }));

          toggleSubtaskFromDashboard(
            sid,
            dateStr,
            task.subjectKey,
            i,
            j
          );
        }}
      />
      <span
        style={{
          textDecoration: isSubDone ? "line-through" : "none",
        }}
      >
        {s.text}
      </span>

                              {/* 🔥 서브 이월 뱃지 */}
                              {isSubCarry && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    carryOverSubtask(
                                      sid,
                                      task,
                                      s,
                                    )
                                  }
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
                              )}
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