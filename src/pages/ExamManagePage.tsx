// src/pages/ExamManagePage.tsx
import React, { useEffect, useState } from "react";
import { collection, doc, getDocs, setDoc, query, where, serverTimestamp, deleteDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";

// 학생 타입 (느슨하게 any로 써도 되지만, 기본 구조만 정의)
type Student = {
  id: string;
  name: string;
  school?: string;
  grade?: string;
};

type ExamRange = { big: string; small: string; pages: string };
type ExamTask = { key: string; label: string; target: number };

type ExamSubject = {
  key: string;
  name: string;
  ranges: ExamRange[];
  tasks: ExamTask[];
};
type ExamSlot = {
  period: number;        // 1,2,3교시
  subKey: string;        // "kor"
  subName: string;       // "국어"
  start?: string;        // "09:00"
  end?: string;          // "10:00"
};

type ExamScheduleByDate = {
  [ymd: string]: ExamSlot[];   // "2026-04-20": [...]
};

type Exam = {
  id: string;
  school: string;
  grade: string;
  title: string;

  planStart: string; // ✅ 계획 시작일 (시험 준비 시작)
  planEnd: string;   // ✅ 계획 종료일 = 시험 전날

  examStart: string; // ✅ 실제 시험 시작일
  examEnd: string;   // ✅ 실제 시험 종료일

  memo?: string;
  subjects: ExamSubject[];
  scheduleByDate?: ExamScheduleByDate;
};

type SubjectDetail = {
  ranges: ExamRange[];
  tasks: ExamTask[];
};



// ===== subjectDetail 조작 함수들 =====


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

const SUBJECT_TASK_KEYS: Record<string, string[]> = {
  kor: ["textbook", "print", "workbook", "workbookWrong", "zokboEssay"],
  eng: ["textbook", "print", "workbook", "workbookWrong"],
  math: ["workbook", "workbookWrong", "print"],
  sci: ["textbook", "print", "printBlank", "workbook", "workbookWrong", "blankNote"],
  soc: ["textbook", "print", "workbook", "workbookWrong"],
  hist1: ["textbook", "print", "printBlank", "workbookWrong"],
  hist2: ["textbook", "print", "printBlank", "workbookWrong"],
  tech: ["textbook", "print", "workbook"],
  hanja: ["printBlank", "blankNote"],
  jp: ["textbook", "print", "printBlank"],
};

// ✅ 과목 기본 템플릿(너가 원하는 항목들)
const DEFAULT_TASKS: ExamTask[] = [
  { key: "textbook", label: "교과서 1-3회독", target: 3 },
  { key: "print", label: "프린트 1-3회독", target: 3 },
  { key: "workbook", label: "시험범위 문제집풀이", target: 1 },
  { key: "workbookWrong", label: "문제집 단원별 오답 여부", target: 1 },
  { key: "printBlank", label: "프린트 빈칸암기 1-3회독", target: 3 },
  { key: "zokboPersonal", label: "족보 개인별문제", target: 1 },
  { key: "zokboEssay", label: "족보 서술형", target: 1 },
  { key: "guideEssay", label: "자습서 서술형", target: 1 },
  { key: "blankNote", label: "백지노트", target: 1 },
];

const TASK_CANDIDATES: ExamTask[] = [
  { key: "textbook", label: "교과서", target: 3 },
  { key: "print", label: "프린트", target: 3 },
  { key: "workbook", label: "문제집", target: 1 },
  { key: "workbookWrong", label: "문제집 오답", target: 1 },
  { key: "printBlank", label: "프린트 빈칸암기", target: 3 },
  { key: "zokboPersonal", label: "족보 개인별문제", target: 1 },
  { key: "zokboEssay", label: "족보 서술형", target: 1 },
  { key: "guideEssay", label: "자습서 서술형", target: 1 },
  { key: "blankNote", label: "백지노트", target: 1 },
];

const parseYMD = (ymd: string) => new Date(`${ymd}T00:00:00`);
const pad2 = (n: number) => String(n).padStart(2, "0");
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

export default function ExamManagePage() {
  // 전체 학생
  const [students, setStudents] = useState<Student[]>([]);
  const [subjectDetail, setSubjectDetail] = useState<Record<string, SubjectDetail>>({});
  const [activeSubKey, setActiveSubKey] = useState<string>("kor");


  const [schools, setSchools] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>("");
  const [selectedGrade, setSelectedGrade] = useState<string>("");

  // 선택된 조건(학교+학년)의 시험 목록
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);

  // 폼 상태
  const [title, setTitle] = useState("");

  const [planStart, setPlanStart] = useState("");
  const [planEnd, setPlanEnd] = useState("");
  const [examStart, setExamStart] = useState("");
  const [examEnd, setExamEnd] = useState("");

  const [memo, setMemo] = useState("");
  const [tab, setTab] = useState<"base" | "schedule" | "subjects">("base");

  const [saving, setSaving] = useState(false);
  const [scheduleByDate, setScheduleByDate] = useState<ExamScheduleByDate>({});
  const [activeDate, setActiveDate] = useState<string>(""); // 선택된 날짜

  const toDdayLabel = (targetYmd: string) => {
    if (!targetYmd) return "";
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const t1d = new Date(targetYmd + "T00:00:00").getTime();
    if (isNaN(t1d)) return "";
    const diff = Math.round((t1d - t0) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "D-DAY";
    if (diff > 0) return `D-${diff}`;
    return `D+${Math.abs(diff)}`;
  };

  const dday = toDdayLabel(examStart); // 시험 시작일 기준
  const countScheduleDays = (sbd: ExamScheduleByDate) => Object.keys(sbd || {}).length;

  const countTotalSlots = (sbd: ExamScheduleByDate) => {
    return Object.values(sbd || {}).reduce((acc, arr) => acc + (arr?.length || 0), 0);
  };

  const toggleTask = (subKey: string, taskKey: string) => {
    setSubjectDetail((prev) => {
      const cur = prev[subKey] || ensureSubject(subKey);
      const exists = (cur.tasks || []).some((t) => t.key === taskKey);

      const found = TASK_CANDIDATES.find((t) => t.key === taskKey);
      if (!found) return prev; // 방어

      const nextTasks = exists
        ? (cur.tasks || []).filter((t) => t.key !== taskKey) // OFF
        : [...(cur.tasks || []), { ...found }]; // ON (추가)

      return { ...prev, [subKey]: { ...cur, tasks: nextTasks } };
    });
  };

  const toYmd = (d: Date) => d.toISOString().slice(0, 10);

  const getDateList = (startYmd: string, endYmd: string) => {
    if (!startYmd || !endYmd) return [];
    const out: string[] = [];
    const s = new Date(startYmd + "T00:00:00");
    const e = new Date(endYmd + "T00:00:00");
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return [];
    for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
     out.push(toYMD(d));
    }
    return out;
  };
  const ensureDate = (ymd: string) => {
    setScheduleByDate((prev) => (prev[ymd] ? prev : { ...prev, [ymd]: [] }));
  };

  const addSlot = (ymd: string) => {
    setScheduleByDate((prev) => {
      const cur = prev[ymd] || [];
      // 기본 교시는 "마지막 교시 + 1"
      const nextPeriod = cur.length ? Math.max(...cur.map((x) => x.period || 0)) + 1 : 1;
      return {
        ...prev,
        [ymd]: [...cur, { period: nextPeriod, subKey: "kor", subName: "국어" }],
      };
    });
  };

  const updateSlot = (ymd: string, idx: number, patch: Partial<ExamSlot>) => {
    setScheduleByDate((prev) => {
      const cur = prev[ymd] || [];
      const next = cur.map((x, i) => (i === idx ? { ...x, ...patch } : x));
      // 교시 정렬
      next.sort((a, b) => (a.period || 0) - (b.period || 0));
      return { ...prev, [ymd]: next };
    });
  };

  const removeSlot = (ymd: string, idx: number) => {
    setScheduleByDate((prev) => {
      const cur = prev[ymd] || [];
      const next = cur.filter((_, i) => i !== idx);
      return { ...prev, [ymd]: next };
    });
  };
  const subjectLabel = (subKey: string) => SUBJECTS.find((s) => s.key === subKey)?.label || subKey;

  const ymdToDow = (ymd: string) => {
    const d = new Date(ymd + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  };

  const buildScheduleMatrix = (sbd: ExamScheduleByDate) => {
    const dates = Object.keys(sbd || {}).sort();
    let maxP = 0;
    dates.forEach((d) => {
      (sbd[d] || []).forEach((slot) => {
        maxP = Math.max(maxP, Number(slot.period || 0));
      });
    });
    maxP = Math.max(maxP, 3); // 최소 3교시

    const rows = dates.map((d) => {
      const byPeriod: Record<number, string> = {};
      (sbd[d] || []).forEach((slot) => {
        byPeriod[Number(slot.period || 0)] = slot.subName || subjectLabel(slot.subKey);
      });
      return { date: d, dow: ymdToDow(d), byPeriod };
    });

    return { rows, maxP };
  };

  /* ------------------------------------------------------------------ */
  /* 🔹 1. 학생 로딩 + 학교 / 학년 목록 만들기 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const loadStudents = async () => {
      const snap = await getDocs(collection(db, "students"));
      const list: Student[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));

      setStudents(list);

      // 학교 목록
      const schoolSet = new Set<string>();
      list.forEach((s) => {
        if (s.school) schoolSet.add(s.school);
      });
      setSchools(Array.from(schoolSet));

      // 기본 선택값 (첫 학교 + 그 학교의 첫 학년)
      const firstSchool = Array.from(schoolSet)[0] || "";
      setSelectedSchool(firstSchool);
    };

    loadStudents();
  }, []);
  useEffect(() => {
    console.log("🔥 subjectDetail 상태:", subjectDetail);
  }, [subjectDetail]);
  /* ------------------------------------------------------------------ */
  /* 🔹 2. 학교 선택 시 해당 학교의 학년 목록 생성 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!selectedSchool) {
      setGrades([]);
      setSelectedGrade("");
      return;
    }

    const gradeSet = new Set<string>();
    students
      .filter((s) => s.school === selectedSchool)
      .forEach((s) => {
        if (s.grade) gradeSet.add(s.grade);
      });

    const gradeList = Array.from(gradeSet);
    setGrades(gradeList);
    if (!gradeList.includes(selectedGrade)) {
      setSelectedGrade(gradeList[0] || "");
    }
  }, [selectedSchool, students]);

  /* ------------------------------------------------------------------ */
  /* 🔹 3. 학교 + 학년 선택이 바뀌면 시험 목록 로딩 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const loadExams = async () => {
      if (!selectedSchool || !selectedGrade) {
        setExams([]);
        setSelectedExamId(null);
        resetForm();
        return;
      }

      const q = query(
        collection(db, "exams"),
        where("school", "==", selectedSchool),
        where("grade", "==", selectedGrade)
      );

      const snap = await getDocs(q);

      const list: Exam[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          school: data.school,
          grade: data.grade,
          title: data.title,

          planStart: data.planStart || data.start || "",
          planEnd: data.planEnd || data.end || "",
          examStart: data.examStart || data.start || "",
          examEnd: data.examEnd || data.end || "",

          memo: data.memo || "",
          subjects: data.subjects || [],
          scheduleByDate: data.scheduleByDate || {},
        };
      });

      setExams(list); // ✅ 이게 핵심!!
    };

    loadExams();
  }, [selectedSchool, selectedGrade, students]); // students는 굳이 없어도 되는데 초기 세팅 안정적

  useEffect(() => {
    if (!selectedSchool || !selectedGrade) return;

    setSubjectDetail((prev) => {
      const next = { ...prev };
      SUBJECTS.forEach((s) => {
        if (!next[s.key]) {
          next[s.key] = {
            ranges: [{ big: "", small: "", pages: "" }],
            tasks: [],
          };
        }
      });
      return next;
    });
  }, [selectedSchool, selectedGrade]);

  useEffect(() => {
    const dates = getDateList(examStart, examEnd);
    if (!dates.length) return;
    if (!activeDate || !dates.includes(activeDate)) {
      setActiveDate(dates[0]);
      ensureDate(dates[0]);
    }
  }, [examStart, examEnd]);

  useEffect(() => {
    // 학교/학년이 바뀌면 선택된 시험도 의미 없어지니까 폼 초기화
    setSelectedExamId(null);
    resetForm();
  }, [selectedSchool, selectedGrade]);

  const makeTasksForSubject = (subKey: string) => {
    const keys = SUBJECT_TASK_KEYS[subKey] || TASK_CANDIDATES.map(t => t.key);
    return TASK_CANDIDATES
      .filter(t => keys.includes(t.key))
      .map(t => ({ ...t })); // 복사
  };

  const ensureSubject = (subKey: string): SubjectDetail => ({
    ranges: [{ big: "", small: "", pages: "" }], // UI용 1줄은 유지
    tasks: [], // ✅ 기본 체크항목은 "선택 전" = 빈 배열
  });

  const updateRange = (
    subKey: string,
    idx: number,
    field: "big" | "small" | "pages",
    val: string
  ) => {
    setSubjectDetail((prev) => {
      const cur = prev[subKey] || ensureSubject(subKey);
      const ranges = (cur.ranges || []).map((r, i) =>
        i === idx ? { ...r, [field]: val } : r
      );
      return { ...prev, [subKey]: { ...cur, ranges } };
    });
  };

  const addRangeRow = (subKey: string) => {
    setSubjectDetail((prev) => {
      const cur = prev[subKey] || ensureSubject(subKey);
      return {
        ...prev,
        [subKey]: { ...cur, ranges: [...cur.ranges, { big: "", small: "", pages: "" }] },
      };
    });
  };

  const removeRangeRow = (subKey: string, idx: number) => {
    setSubjectDetail((prev) => {
      const cur = prev[subKey] || ensureSubject(subKey);
      const ranges = cur.ranges.filter((_, i) => i !== idx);
      return {
        ...prev,
        [subKey]: { ...cur, ranges: ranges.length ? ranges : [{ big: "", small: "", pages: "" }] },
      };
    });
  };

  const updateTaskTarget = (
    subKey: string,
    taskKey: string,
    target: number
  ) => {
    setSubjectDetail((prev) => {
      const cur = prev[subKey] || ensureSubject(subKey);
      const tasks = (cur.tasks || []).map((t) =>
        t.key === taskKey ? { ...t, target } : t
      );
      return { ...prev, [subKey]: { ...cur, tasks } };
    });
  };

  /* ------------------------------------------------------------------ */
  /* 🔹 4. 폼 리셋 */
  /* ------------------------------------------------------------------ */

  const buildDefaultDetail = (): Record<string, SubjectDetail> => {
    const next: Record<string, SubjectDetail> = {};
    SUBJECTS.forEach((s) => {
      next[s.key] = {
        ranges: [{ big: "", small: "", pages: "" }],
        tasks: [], // ✅ 빈 배열
      };
    });
    return next;
  };

  const resetForm = () => {
    setTitle("");

    setPlanStart("");
    setPlanEnd("");
    setExamStart("");
    setExamEnd("");

    setMemo("");
    setSubjectDetail(buildDefaultDetail());
    setScheduleByDate({});
    setActiveDate("");
  };
  /* ------------------------------------------------------------------ */
  /* 🔹 5. 시험 클릭 시 폼에 로드 */
  /* ------------------------------------------------------------------ */

  const handleSelectExam = (exam: Exam) => {
    setSelectedExamId(exam.id);
    setTitle(exam.title || "");
    setPlanStart(exam.planStart || "");
    setPlanEnd(exam.planEnd || "");
    setExamStart(exam.examStart || "");
    setExamEnd(exam.examEnd || "");
    setMemo(exam.memo || "");

    const nextDetail: Record<string, SubjectDetail> = {};

    (exam.subjects || []).forEach((sub: any) => {
      nextDetail[sub.key] = {
        ranges: sub.ranges?.length ? sub.ranges : [{ big: "", small: "", pages: "" }],
        tasks: sub.tasks?.length ? sub.tasks : [],
      };
    });

    // ✅ 빠진 과목도 기본값으로 채워 넣기 (null 방지)
    SUBJECTS.forEach((s) => {
      if (!nextDetail[s.key]) nextDetail[s.key] = ensureSubject(s.key);
    });

    setSubjectDetail(nextDetail);

    // ✅ scheduleByDate 로딩 (중요)
    setScheduleByDate((exam as any).scheduleByDate || exam.scheduleByDate || {});
    setActiveDate("");
  };



  /* ------------------------------------------------------------------ */
  /* 🔹 7. 시험 저장 + 학생들에게 반영 */
  /* ------------------------------------------------------------------ */

  const handleSaveExam = async () => {
    if (!selectedSchool || !selectedGrade) {
      alert("학교와 학년을 먼저 선택하세요.");
      return;
    }
    if (!title.trim()) {
      alert("시험 제목을 입력하세요.");
      return;
    }
    if (!planStart || !planEnd) {
      alert("계획 시작일/종료일(시험 전날)을 입력하세요.");
      return;
    }
    if (!examStart || !examEnd) {
      alert("실제 시험 시작일/종료일을 입력하세요.");
      return;
    }

    setSaving(true);

    try {
      // 1) exam 문서 ID 준비 (새로 생성 or 기존 것 사용)
      let examRef;
      let examId = selectedExamId;

      if (!examId) {
        examRef = doc(collection(db, "exams"));
        examId = examRef.id;
      } else {
        examRef = doc(db, "exams", examId);
      }
        // ✅ 계획기간/시험기간 겹침 방지: planEnd는 반드시 examStart 전날이어야 함
      const dPlanStart = parseYMD(planStart);
      const dPlanEnd = parseYMD(planEnd);
      const dExamStart = parseYMD(examStart);
      const dExamEnd = parseYMD(examEnd);

      // 기본 순서 검증
      if (dExamStart > dExamEnd) {
        alert("시험 시작일이 종료일보다 늦어요.");
        setSaving(false);
        return;
      }

      // ✅ 겹치면 자동 보정: planEnd = examStart - 1일
      let fixedPlanEnd = planEnd;
      if (dPlanEnd >= dExamStart) {
        fixedPlanEnd = toYMD(addDays(dExamStart, -1));
        setPlanEnd(fixedPlanEnd); // 화면에도 바로 반영
        alert(`계획 종료일이 시험 시작일과 겹쳐서\n계획 종료일을 ${fixedPlanEnd} 로 자동 수정했어요.`);
      }

      // 보정 후에도 planStart가 planEnd보다 늦으면 저장 금지
      if (dPlanStart > parseYMD(fixedPlanEnd)) {
        alert("계획 시작일이 계획 종료일보다 늦어요.");
        setSaving(false);
        return;
      }

      // 2) subjects 배열 만들기 (범위가 있는 과목만)
      const makeRangeId = (subKey: string, idx: number) =>
  `${subKey}-${Date.now()}-${idx}-${Math.random().toString(16).slice(2)}`;

const subjects = SUBJECTS
  .map((s) => {
    const detail = subjectDetail[s.key];
    if (!detail) return null;

    // ✅ 유효 range만
    const cleanedRanges = (detail.ranges || [])
      .map((r, idx) => ({
        id: (r as any).id || makeRangeId(s.key, idx),  // ✅ id 유지(중요)
        big: (r.big || "").trim(),
        small: (r.small || "").trim(),
        pages: (r.pages || "").trim(),
      }))
      .filter((r) => r.big || r.small || r.pages);

    const hasAnyRange = cleanedRanges.length > 0;

    // ✅ 과목 체크칩(선택된 것들)
    const chosenTasks = (detail.tasks || []).map((t) => ({
      key: t.key,
      label: t.label,
      target: Number(t.target || 0),
    }));
    const hasAnyTask = chosenTasks.length > 0;

    if (!hasAnyRange && !hasAnyTask) return null;

    // ✅ exams(마스터)에는 "과목 템플릿 tasks"를 따로 저장해두면 좋음 (관리자 화면 재편집용)
    return {
      key: s.key,
      name: s.label,

      // ✅ ranges에는 id 포함해서 저장(소단원 기준 유지용)
      ranges: cleanedRanges,

      // ✅ 과목 템플릿(관리자 재편집/표시용) — 학생쪽에선 range로 내려서 쓸거임
      tasks: chosenTasks,
    };
  })
  .filter((x): x is any => x !== null);

      const examData = {
        school: selectedSchool,
        grade: selectedGrade,
        title: title.trim(),

  planStart,
planEnd: fixedPlanEnd,
examStart,
examEnd,

        memo: memo.trim(),
        subjects,
        scheduleByDate,
        updatedAt: serverTimestamp(),
        ...(selectedExamId ? {} : { createdAt: serverTimestamp() }),
      };

      // 3) exams 컬렉션에 저장
      await setDoc(examRef, examData, { merge: true });

      // 4) 해당 학교 + 학년의 학생들 찾기
      const targetStudents = students.filter(
        (s) => s.school === selectedSchool && s.grade === selectedGrade
      );

      // 5) 각 학생의 studentExams/{sid}/exams/{examId} 에 동일 정보 저장
      const studentSubjects = subjects.map((sub: any) => ({
  key: sub.key,
  name: sub.name,
  ranges: (sub.ranges || []).map((rg: any, idx: number) => ({
    id: rg.id || `${sub.key}-${idx}`,
    big: rg.big || "",
    small: rg.small || "",
    pages: rg.pages || "",
    tasks: (sub.tasks || []).map((t: any) => ({
      key: t.key,
      label: t.label,
      target: Number(t.target || 0),
      done: 0,
    })),
  })),
}));
      for (const st of targetStudents) {
        const ref = doc(collection(db, "studentExams", st.id, "exams"), examId!);
        await setDoc(ref, {
          examId,
          studentId: st.id,
          studentName: st.name,
          school: selectedSchool,
          grade: selectedGrade,
          title: title.trim(),

         planStart,
planEnd: fixedPlanEnd,
examStart,
examEnd,

          scheduleByDate,
          memo: memo.trim(),
          subjects: studentSubjects,
          appliedAt: serverTimestamp(),
        }, { merge: true });
      }

      // 6) 로컬 state 갱신
      const newExam: Exam = {
        id: examId!,
        school: selectedSchool,
        grade: selectedGrade,
        title: title.trim(),

     planStart,
planEnd: fixedPlanEnd,
examStart,
examEnd,

        memo: memo.trim(),
        subjects,
        scheduleByDate,
      };
      setExams((prev) => {
        const exists = prev.find((e) => e.id === examId);
        if (exists) {
          return prev.map((e) => (e.id === examId ? newExam : e));
        }
        return [...prev, newExam];
      });

      setSelectedExamId(examId!);

      alert("시험 정보가 저장되고, 해당 학생들에게 반영되었습니다.");
    } catch (e) {
      console.error(e);
      alert("저장 중 오류가 발생했습니다. 콘솔을 확인하세요.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExam = async (examId: string) => {
    if (!selectedSchool || !selectedGrade) {
      alert("학교/학년 선택 후 삭제할 수 있어요.");
      return;
    }

    const ok = confirm("이 시험을 삭제할까요?\n(해당 학년 학생들에게 반영된 시험도 같이 삭제됩니다)");
    if (!ok) return;

    setSaving(true);

    try {
      // 1) 마스터 exams 삭제
      await deleteDoc(doc(db, "exams", examId));

      // 2) 해당 학교/학년 학생들 찾기
      const targetStudents = students.filter(
        (s) => s.school === selectedSchool && s.grade === selectedGrade
      );

      // 3) 학생쪽 사본(studentExams)도 배치로 삭제
      const batch = writeBatch(db);
      targetStudents.forEach((st) => {
        const ref = doc(db, "studentExams", st.id, "exams", examId);
        batch.delete(ref);
      });
      await batch.commit();

      // 4) 로컬 state 정리
      setExams((prev) => prev.filter((e) => e.id !== examId));
      if (selectedExamId === examId) {
        setSelectedExamId(null);
        resetForm();
      }

      alert("삭제 완료!");
    } catch (e) {
      console.error(e);
      alert("삭제 중 오류. 콘솔 확인!");
    } finally {
      setSaving(false);
    }
  };

  const ui = {
    input: {
      height: 34,
      padding: "0 10px",
      borderRadius: 10,
      border: "1px solid #E5E7EB",
      background: "#FFFFFF",
      fontSize: 12,
      outline: "none",
      boxSizing: "border-box" as const,
    },
    inputSmall: {
      height: 30,
      padding: "0 10px",
      borderRadius: 10,
      border: "1px solid #E5E7EB",
      background: "#FFFFFF",
      fontSize: 12,
      outline: "none",
      boxSizing: "border-box" as const,
    },
    btnGhost: {
      height: 34,
      padding: "0 10px",
      borderRadius: 10,
      border: "1px solid #E5E7EB",
      background: "#F8FAFC",
      fontSize: 12,
      fontWeight: 800,
      cursor: "pointer",
    },
  };
  /* ------------------------------------------------------------------ */
  /* 🔹 UI 렌더링 */
  /* ------------------------------------------------------------------ */

  // ✅ ExamManagePage.tsx : return (...) 블록 전체를 아래로 교체

// ✅ ExamManagePage.tsx : return (...) 블록 전체 교체 (요즘 SaaS 레이아웃)

return (
  <div
    style={{
      maxWidth: 1360, // 조금 더 여유 있게 확장
      margin: "40px auto",
      padding: "0 24px 60px",
      fontFamily: "'Pretendard', system-ui, sans-serif",
      color: "#1E293B",
      backgroundColor: "#F1F5F9", // 전체 배경을 연한 회색으로 설정
      minHeight: "100vh",
    }}
  >
    <style>{`
      /* 최신 트렌드: 매끄러운 스크롤과 호버 애니메이션 */
      * { transition: all 0.2s ease-in-out; }
      
      .examGrid {
        display: grid;
        gap: 24px;
        align-items: start;
        grid-template-columns: 340px 1fr 340px;
      }

      .mainCard {
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow:
    0 1px 0 rgba(15, 23, 42, 0.04),
    0 10px 30px rgba(15, 23, 42, 0.06);
}


      .glassInput {
        width: 100%;
        height: 48px;
        padding: 0 16px;
        border-radius: 12px;
        border: 1px solid #E2E8F0;
        background: #F1F5F9;
        font-size: 14px;
        outline: none;
      }

      .glassInput:focus {
        background: #FFFFFF;
        border-color: #3B82F6;
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
      }

      @media (max-width: 1200px) {
        .examGrid { grid-template-columns: 340px 1fr; }
        .rightCol { grid-column: 1 / -1; }
      }

      @media (max-width: 900px) {
        .examGrid { grid-template-columns: 1fr; }
        .leftCol, .midCol, .rightCol { grid-column: 1 / -1; }
      }
        .btnPrimary{
  height:44px;
  border-radius:14px;
  border:1px solid #2563EB;
  background:#2563EB;
  color:#fff;
  font-weight:700;
  font-size:14px;
  cursor:pointer;
}
.btnPrimary:hover{
  background:#1D4ED8;
}
    `}</style>
    {/* ───────────────── Header ───────────────── */}
   {/* ───────────────── 1. 상단 헤더 & 통계 섹션 ───────────────── */}
    <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-1px", margin: 0, color: "#0F172A" }}>
          시험 관리 <span style={{ color: "#3B82F6", fontSize: 16, verticalAlign: 'middle', marginLeft: 8 }}>Teacher Dashboard</span>
        </h1>
        <p style={{ marginTop: 8, color: "#64748B", fontSize: 15 }}>효율적인 시험 일정 수립과 자동 반영 시스템</p>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ textAlign: 'right', padding: "0 16px", borderRight: "1px solid #E2E8F0" }}>
          <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>진행 중인 시험</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{exams.length}건</div>
        </div>
        <div style={{ textAlign: 'right', padding: "0 16px" }}>
          <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>학습 대상</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#3B82F6" }}>
            {students.filter(s => s.school === selectedSchool && s.grade === selectedGrade).length}명
          </div>
        </div>
      </div>
    

      {/* KPI chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            padding: "6px 10px",
            borderRadius: 999,
            background: "#F9FAFB",
            border: "1px solid #E5E7EB",
            color: "#374151",
          }}
        >
          {selectedExamId ? "수정 모드" : "새 시험"}
        </span>

        <span
          style={{
            fontSize: 12,
            fontWeight: 900,
            padding: "6px 10px",
            borderRadius: 999,
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            color: "#2563EB",
          }}
        >
          {dday ? `시험 ${dday}` : "시험일 미설정"}
        </span>

        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            padding: "6px 10px",
            borderRadius: 999,
            background: "#FFFFFF",
            border: "1px solid #E5E7EB",
            color: "#374151",
          }}
        >
          시험일정 {countScheduleDays(scheduleByDate)}일 · {countTotalSlots(scheduleByDate)}교시
        </span>
      </div>
    </div>

    {/* ───────────────── Target Filter ───────────────── */}
  <div className="mainCard" style={{ padding: '20px 24px', marginBottom: 24, display: 'flex', gap: 16, alignItems: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#475569" }}>대상 선택</div>
      <select
        className="glassInput"
        style={{ width: 180 }}
        value={selectedSchool}
        onChange={(e) => setSelectedSchool(e.target.value)}
      >
        <option value="">전체 학교</option>
        {schools.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select
        className="glassInput"
        style={{ width: 140 }}
        value={selectedGrade}
        onChange={(e) => setSelectedGrade(e.target.value)}
      >
        <option value="">전체 학년</option>
        {grades.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      
      <div style={{ flex: 1 }} />
      
      <div style={{ 
        padding: "8px 16px", 
        borderRadius: "12px", 
        background: dday ? "rgba(59, 130, 246, 0.1)" : "#F1F5F9",
        color: dday ? "#2563EB" : "#64748B",
        fontSize: 13,
        fontWeight: 700
      }}>
        {dday ? `시험까지 ${dday}` : "날짜 미정"}
      </div>
    </div>

{/* ───────────────── 3. 메인 그리드 레이아웃 ───────────────── */}
<div className="examGrid">
  
  {/* [좌측] 시험 리스트 : 우측 요약 카드와 일치시킨 스타일 */}
  <div className="leftCol mainCard" style={{ padding: 0, overflow: 'hidden', border: "1px solid #E5E7EB", borderRadius: 18, background: "#FFFFFF" }}>
    
    {/* 헤더 섹션: 액션 중심 */}
    <div style={{ padding: "20px", borderBottom: "1px solid #F1F5F9", background: "#F9FAFB" }}>
      <button
        onClick={() => { setSelectedExamId(null); resetForm(); }}
        style={{
          width: "100%",
          height: 40, // 우측 저장 버튼과 높이 통일
          borderRadius: "12px",
          background: "#2e4ca3", // 우측 메인 컬러와 일치
          color: "#fff",
          border: "none",
          fontSize: "13px",
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "0 2px 4px rgba(29, 78, 216, 0.2)",
          transition: "all 0.2s"
        }}
      >
        + 새 시험 일정 만들기
      </button>

      {/* 상태 안내 메시지 */}
      {(!selectedSchool || !selectedGrade) ? (
        <div style={{ marginTop: 12, fontSize: 12, color: "#94A3B8", textAlign: "center" }}>
          학교와 학년을 먼저 선택해 주세요.
        </div>
      ) : (
        exams.length === 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: "#94A3B8", textAlign: "center" }}>
            등록된 시험 일정이 없습니다.
          </div>
        )
      )}
    </div>

    {/* 리스트 섹션 */}
    <div style={{ 
      maxHeight: "calc(100vh - 300px)", // 화면 높이에 맞게 가변 조정
      overflowY: 'auto',
      padding: "12px" 
    }}>
      {exams.map((ex) => {
        const selected = selectedExamId === ex.id;
        return (
          <div
            key={ex.id}
            className="examItem"
            onClick={() => handleSelectExam(ex)}
            style={{
              padding: "16px 18px",
              borderRadius: "14px",
              marginBottom: 8,
              cursor: "pointer",
              transition: "all 0.2s ease",
              position: "relative",
              
              // 배경: 선택 시 연한 블루, 미선택 시 투명(또는 흰색)
              background: selected ? "#EFF6FF" : "transparent",
              // 테두리: 선택 시 블루, 미선택 시 아주 연한 회색
              border: selected ? "1px solid #BFDBFE" : "1px solid #F1F5F9",
            }}
          >
            {/* 선택 표시 인디케이터 (더 얇고 세련되게) */}
            {selected && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: "20%",
                  bottom: "20%",
                  width: 3,
                  background: "#2563EB",
                  borderRadius: "0 4px 4px 0",
                }}
              />
            )}

            <div style={{ 
              fontSize: 14, 
              fontWeight: selected ? 800 : 600, 
              color: selected ? "#1E40AF" : "#202122",
              marginBottom: 4 
            }}>
              {ex.title}
            </div>
            
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              fontSize: 11, 
              color: selected ? "#3f81d2" : "#19191a",
              fontWeight: 500 
            }}>
              <span style={{ marginRight: 4 }}>📅</span>
              {ex.examStart} ~ {ex.examEnd}
            </div>
          </div>
        );
      })}
    </div>
  </div>
    {/* ========== Middle: Editor ========== */}
      <div className="midCol noOverflow" style={{
        borderRadius: 18,
        border: "1px solid #E5E7EB",
        background: "#FFFFFF",
        overflow: "hidden",
        boxShadow: "0 8px 24px rgba(17,24,39,0.06)",
        display: "flex",
        flexDirection: "column",
        height: "100%"
      }}>
        {/* Sticky Action Bar */}
        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "#FFFFFF",
          borderBottom: "1px solid #E5E7EB",
        }}>
          <div style={{
            padding: "12px 14px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}>
            {/* Text Tabs */}
            <div style={{ display: "flex", gap: 14, alignItems: "flex-end" }}>
              {(
                [
                  { key: "base", label: "기본", desc: "시험명 · 기간" },
                  { key: "schedule", label: "시험일정", desc: "날짜 · 교시" },
                  { key: "subjects", label: "과목", desc: "범위 · 체크" },
                ] as const
              ).map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: "8px 0",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: 8,
                      color: active ? "#111827" : "#6B7280",
                      fontWeight: active ? 900 : 800,
                      fontSize: 14,
                      letterSpacing: "-0.2px",
                    }}>
                      {t.label}
                      <span style={{ fontSize: 11, fontWeight: 700, color: active ? "#2563EB" : "#9CA3AF" }}>
                        {t.desc}
                      </span>
                    </div>
                    <div style={{
                      marginTop: 8,
                      height: 2,
                      width: active ? "100%" : 0,
                      background: "#2563EB",
                      borderRadius: 999,
                      transition: "width 0.2s ease",
                    }} />
                  </button>
                );
              })}
            </div>

            {/* Inline CTA */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setSelectedExamId(null); resetForm(); }}
                style={{
                  height: 36, padding: "0 12px", borderRadius: 10,
                  border: "1px solid #E5E7EB", background: "#FFFFFF",
                  fontSize: 12, fontWeight: 800, cursor: "pointer", color: "#374151",
                }}
              >
                초기화
              </button>
              
            </div>
          </div>
          <div style={{ padding: "0 14px 10px", fontSize: 11, color: "#9CA3AF" }}>
            추천 흐름: <b style={{ color: "#6B7280" }}>기본</b> → <b style={{ color: "#6B7280" }}>시험일정</b> → <b style={{ color: "#6B7280" }}>과목</b>
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div style={{ padding: 14, overflowY: "auto", flex: 1 }}>
          
          {/* ───────── TAB: BASE ───────── */}
          {tab === "base" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
                <div style={{ padding: 16, borderRadius: 16, border: "1px solid #E5E7EB" }}>
                  <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8 }}>시험 제목</div>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="예: 2026 1학기 중간고사"
                    style={{ ...ui.input, width: "100%", height: 40, borderRadius: 10 }}
                  />
                </div>
                <div style={{ padding: 16, borderRadius: 16, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                  <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>상태 요약</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <div
  style={{
    padding: "6px 12px",
    borderRadius: 8,
    background: "#F1F5F9",
    border: "1px solid #E2E8F0",
    fontSize: 12,
    fontWeight: 700,
    color: "#334155"
  }}
>
  {dday || "D-day -"}
</div>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "4px 8px", borderRadius: 6, background: "#FFFFFF", border: "1px solid #E5E7EB" }}>
                      시험일정 {countScheduleDays(scheduleByDate)}일
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ padding: 16, borderRadius: 16, border: "1px solid #E5E7EB" }}>
                <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 12 }}>기간 설정</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>계획 기간 (준비)</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} style={{ ...ui.input, flex: 1, fontSize: 12 }} />
                      <input type="date" value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} style={{ ...ui.input, flex: 1, fontSize: 12 }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>시험 기간 (실제)</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input type="date" value={examStart} onChange={(e) => setExamStart(e.target.value)} style={{ ...ui.input, flex: 1, fontSize: 12 }} />
                      <input type="date" value={examEnd} onChange={(e) => setExamEnd(e.target.value)} style={{ ...ui.input, flex: 1, fontSize: 12 }} />
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ padding: 16, borderRadius: 16, border: "1px solid #E5E7EB" }}>
                <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8 }}>메모</div>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="공지사항이나 주의사항 입력"
                  style={{ width: "100%", minHeight: 80, borderRadius: 10, border: "1px solid #E5E7EB", padding: 10, fontSize: 13, outline: "none", resize: "none" }}
                />
              </div>
            </div>
          )}

          {/* ───────── TAB: SCHEDULE ───────── */}
          {tab === "schedule" && (
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 16, background: "#F9FAFB", border: "1px solid #E5E7EB" }}>
                <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>시험 날짜</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {getDateList(examStart, examEnd).map((d) => (
                    <button
                      key={d}
                      onClick={() => { setActiveDate(d); ensureDate(d); }}
                      style={{
                        textAlign: "left", padding: "10px", borderRadius: 10,
                        border: activeDate === d ? "1px solid #2563EB" : "1px solid #E5E7EB",
                        background: activeDate === d ? "#EFF6FF" : "#FFFFFF", cursor: "pointer"
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 12 }}>{d.slice(5)} ({ymdToDow(d)})</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ padding: 16, borderRadius: 16, border: "1px solid #E5E7EB" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 900 }}>{activeDate || "날짜 선택"} 시험일정</div>
                    <button onClick={() => activeDate && addSlot(activeDate)} style={{ fontSize: 12, fontWeight: 800, color: "#2563EB", background: "none", border: "none", cursor: "pointer" }}>
                      + 교시 추가
                    </button>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {(scheduleByDate[activeDate] || []).map((slot, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", background: "#F9FAFB", padding: 8, borderRadius: 10 }}>
                        <input type="number" value={slot.period} onChange={(e) => updateSlot(activeDate, idx, { period: Number(e.target.value) })} style={{ width: 45, textAlign: "center", border: "1px solid #E5E7EB", borderRadius: 6, height: 30 }} />
                        <select value={slot.subKey} onChange={(e) => updateSlot(activeDate, idx, { subKey: e.target.value, subName: subjectLabel(e.target.value) })} style={{ flex: 1, border: "1px solid #E5E7EB", borderRadius: 6, height: 30 }}>
                          {SUBJECTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                        <button onClick={() => removeSlot(activeDate, idx)} style={{ border: "none", background: "none", cursor: "pointer", color: "#9CA3AF" }}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ───────── TAB: SUBJECTS ───────── */}
          {tab === "subjects" && (
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 16, background: "#F9FAFB", border: "1px solid #E5E7EB" }}>
                <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>과목 목록</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {SUBJECTS.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setActiveSubKey(s.key)}
                      style={{
  display: "flex",
  alignItems: "center",     // 세로 중앙
  justifyContent: "center", // 가로 중앙
  padding: "10px 0",
  borderRadius: 10,
  border: activeSubKey === s.key
    ? "1px solid #4256EB"
    : "1px solid #E5E7EB",
  background: activeSubKey === s.key ? "#EEF6FF" : "#FFFFFF",
  cursor: "pointer",
}}
                    >
                      <div style={{ fontWeight: 800, fontSize: 12 }}>{s.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ padding: 16, borderRadius: 16, border: "1px solid #E5E7EB" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 900 }}>{subjectLabel(activeSubKey)} 범위</div>
                    <button onClick={() => addRangeRow(activeSubKey)} style={{ fontSize: 12, fontWeight: 800, color: "#2563EB", background: "none", border: "none", cursor: "pointer" }}>
                      + 줄 추가
                    </button>
                  </div>
                  {(subjectDetail[activeSubKey]?.ranges || []).map((r, idx) => (
  <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
    <input
      placeholder="대단원"
      value={r.big}
      onChange={(e) => updateRange(activeSubKey, idx, "big", e.target.value)}
      style={{ width: 140, maxWidth: 140, border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}
    />

    <input
  placeholder="소단원"
  value={r.small}
  onChange={(e) => updateRange(activeSubKey, idx, "small", e.target.value)}
  style={{ width: 140, maxWidth: 140, border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}
/>

    <input
      placeholder="쪽수"
      value={r.pages}
      onChange={(e) => updateRange(activeSubKey, idx, "pages", e.target.value)}
      style={{ width: 90, border: "1px solid #E5E7EB", borderRadius: 8, padding: "4px 8px", fontSize: 12 }}
    />

    <button onClick={() => removeRangeRow(activeSubKey, idx)} style={{ color: "#9CA3AF", border: "none", background: "none" }}>
      ✕
    </button>
  </div>
))}
                </div>

                <div style={{ padding: 16, borderRadius: 16, border: "1px solid #E5E7EB" }}>
                  <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 12 }}>체크 리스트</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {TASK_CANDIDATES.map(t => {
                      const selected = (subjectDetail[activeSubKey]?.tasks || []).some(x => x.key === t.key);
                      return (
                        <button
                          key={t.key}
                          onClick={() => toggleTask(activeSubKey, t.key)}
                          style={{
                            padding: "6px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                            border: selected ? "1px solid #2563EB" : "1px solid #E5E7EB",
                            background: selected ? "#EFF6FF" : "#FFFFFF",
                            color: selected ? "#2563EB" : "#6B7280", cursor: "pointer"
                          }}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========== Right: Summary / Actions ========== */}
<div className="rightCol noOverflow" style={{ display: "grid", gap: 16, alignContent: "start" }}>
  
  {/* 요약 카드 (Summary Card) */}
  <div
    style={{
      borderRadius: 16,
      border: "1px solid #E5E7EB",
      background: "#FFFFFF",
      overflow: "hidden",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
    }}
  >
    {/* 카드 헤더 */}
    <div style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6", background: "#F9FAFB" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>설정 요약</div>
    </div>

    {/* 카드 본문 */}
    <div style={{ padding: "20px", display: "grid", gap: 16 }}>
      
      {/* 1. 시험 제목 및 대상 */}
      <div>
        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>시험 정보</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#a32e8f" }}>
          {title?.trim() ? title : "시험 제목을 입력해주세요"}
        </div>
        <div style={{ fontSize: 13, marginTop: 4, color: "#374151" }}>
          <b style={{ color: "#111827" }}>{selectedSchool || "-"}</b> · <b style={{ color: "#111827" }}>{selectedGrade || "-"}</b> 대상
        </div>
      </div>

      {/* 2. 기간 정보 (구분선 추가로 가독성 향상) */}
      <div style={{ padding: "12px 0", borderTop: "1px dashed #E5E7EB", borderBottom: "1px dashed #E5E7EB", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "#6B7280" }}>계획 수립</span>
          <span style={{ fontWeight: 600 }}>{planStart || "-"} ~ {planEnd || "-"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "#6B7280" }}>시험 기간</span>
          <span style={{ fontWeight: 600 }}>{examStart || "-"} ~ {examEnd || "-"}</span>
        </div>
      </div>

      {/* 3. 통계 배지 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <div style={{ padding: "6px 12px", borderRadius: 8, background: "#EFF6FF", border: "1px solid #DBEAFE", color: "#1E40AF", fontSize: 12, fontWeight: 700 }}>
          {dday ? dday : "D-Day 미정"}
        </div>
        <div style={{ padding: "6px 12px", borderRadius: 8, background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#4B5563", fontSize: 12, fontWeight: 700 }}>
          시험일정 {countScheduleDays(scheduleByDate)}일
        </div>
        <div style={{ padding: "6px 12px", borderRadius: 8, background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#4B5563", fontSize: 12, fontWeight: 700 }}>
          총 {countTotalSlots(scheduleByDate)}개 교시
        </div>
      </div>

      {/* 4. 액션 버튼 (왼쪽 폼의 버튼과 일치시킴) */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          onClick={handleSaveExam}
          disabled={saving}
          style={{
            flex: 2,
            height: 42,
            borderRadius: 12,
            border: "none",
            background: saving ? "#BFDBFE" : "#2e4ca3",
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 700,
            cursor: saving ? "not-allowed" : "pointer",
            transition: "background 0.2s",
          }}
        >
          {saving ? "저장 중..." : "시험 일정 저장"}
        </button>

        <button
          onClick={() => {
            if(window.confirm("입력한 내용을 모두 초기화할까요?")) {
              setSelectedExamId(null);
              resetForm();
            }
          }}
          style={{
            flex: 1,
            height: 42,
            borderRadius: 12,
            border: "1px solid #E5E7EB",
            background: "#FFFFFF",
            color: "#6B7280",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          초기화
        </button>
      </div>
    </div>
  </div>

  {/* 가이드 카드 (UX 보완) */}
  <div
    style={{
      borderRadius: 16,
      background: "#F8FAFC",
      border: "1px solid #E2E8F0",
      padding: "16px",
    }}
  >
    <div style={{ fontSize: 13, fontWeight: 800, color: "#475569", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
      💡 입력 팁
    </div>
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#64748B", lineHeight: 1.6 }}>
      <li>날짜는 <b style={{ color: "#334155" }}>기본 → 시험일정</b> 순서로 설정하세요.</li>
      <li>시험일정 누락 시 <b style={{ color: "#334155" }}>toYMD</b> 형식을 확인하세요.</li>
      <li>저장 시 선택된 학교/학년 학생들에게 즉시 반영됩니다.</li>
    </ul>
  </div>
</div>
      </div>
    </div>
 
);
}