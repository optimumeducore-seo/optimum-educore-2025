// src/pages/StudyPlanDashboardPage.tsx
import React, { useEffect, useState, useMemo } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  onSnapshot,
  updateDoc,
  arrayUnion,
  Timestamp,
} from "firebase/firestore";
import OpsModal from "../components/admin/OpsModal";
import { db } from "../firebase";
import type { AssignmentRules, Weekday } from "../services/firestore";
import { saveAssignmentRules, loadAssignmentRules } from "../services/firestore";
import { rescheduleDeletedAutoTask } from "../services/firestore";
import type { MainTask } from "../services/firestore";
import { useNavigate } from "react-router-dom";
import { BRAND } from "../config/brand";

/* -------------------------------------------------- */
/* 타입 정의 (간단 버전)                              */
/* -------------------------------------------------- */

type Student = {
  id: string;
  name: string;
  grade?: string | number;   // 지금 데이터가 "고1" 같은 문자열이라 이게 안전
  gradeLevel?: "초" | "중" | "고" | string;
  removed?: boolean;    // ✅ "중학교" / "고등학교"
  hidden?: boolean;
  isPaused?: boolean;
  school?: string;

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
  teacherComment?: string;
  done?: boolean;
  updatedAt?: any;
  proofImages?: string[];
  proofMemo?: string;
  wordTest?: { correct?: number; total?: number };
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
  { key: "common", label: "공통" },
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
const RULE_SUBJECT = "common";

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

function minToHM(min: number) {
  const totalMin = Math.floor(min); // 🔥 소수 잘라버림

  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  return `${h}:${String(m).padStart(2, "0")}`;
}



const normalizeTasks = (v: any): TaskItem[] => {
  if (!Array.isArray(v)) return [];

  return v.map((x: any) => {
    const base: TaskItem = {
      id: x.id,
      title: x.title ?? "",
      text: x.text ?? "",
      done: !!x.done,
      carriedFrom: x.carriedFrom ?? "",
      deleted: x.deleted === true,
    };

    // ✅ subtasks는 있을 때만 넣는다 (undefined 절대 금지)
    if (Array.isArray(x.subtasks)) {
      base.subtasks = x.subtasks.map((s: any) => ({
        text: s.text ?? "",
        done: !!s.done,
      }));
    }

    return base;
  });
};

const COMMON = "common" as const;

function QuickInputTable({
  rows,
  selectedStudentId,
  setSelectedStudentId,
  onAddTeacherTask,
}: {
  rows: any[];
  selectedStudentId: string | null;
  setSelectedStudentId: (id: string) => void;
  onAddTeacherTask: (sid: string, text: string) => Promise<void>;
}) {
  const [taskInputs, setTaskInputs] = React.useState<Record<string, string>>({});

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        border: "1px solid #E5E7EB",
        padding: 12,
        overflowX: "auto",
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 900 }}>
        데일리 학생 요약
      </div>

      <table style={{ width: "100%", fontSize: 12, marginTop: 8 }}>
        <thead>
          <tr style={{ background: "#F3F4F6" }}>
            <th style={{ padding: 8 }}>학생</th>
            <th style={{ padding: 8 }}>과제 입력</th>
            <th style={{ padding: 8 }}>액션</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any, i: number) => {
            const sid = row.student.id;
            const active = sid === selectedStudentId;

            return (
              <tr
                key={sid}
                style={{
                  background: active ? "#EEF2FF" : i % 2 === 0 ? "#F8FAFC" : "#fff",
                  cursor: "pointer",
                }}
                onClick={() => setSelectedStudentId(sid)}
              >
                <td style={{ padding: 8 }}>
                  <div style={{ fontWeight: 700 }}>
                    {row.student.name}
                  </div>
                </td>

                <td style={{ padding: 8 }}>
                  <input
                    value={taskInputs[sid] ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setTaskInputs((prev) => ({
                        ...prev,
                        [sid]: e.target.value,
                      }))
                    }
                    onKeyDown={async (e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const text = (taskInputs[sid] ?? "").trim();
                      if (!text) return;
                      await onAddTeacherTask(sid, text);
                      setTaskInputs((prev) => ({
                        ...prev,
                        [sid]: "",
                      }));
                    }}
                    style={{
                      width: "100%",
                      padding: 6,
                      borderRadius: 6,
                      border: "1px solid #E5E7EB",
                    }}
                  />
                </td>

                <td style={{ padding: 8 }}>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const text = (taskInputs[sid] ?? "").trim();
                      if (!text) return;
                      await onAddTeacherTask(sid, text);
                      setTaskInputs((prev) => ({
                        ...prev,
                        [sid]: "",
                      }));
                    }}
                    style={{
                      padding: "6px 10px",
                      background: "#1E3A8A",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    전송
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
/* -------------------------------------------------- */
/* 메인 컴포넌트: StudyPlanDashboardPage              */
/* -------------------------------------------------- */

export default function
  StudyPlanDashboardPage() {
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
  const [selectedSubject, setSelectedSubject] = useState<string>("common");
  // 학년 선택
  const [selectedGrade, setSelectedGrade] = useState("");

  // 여러 학생 선택
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  const [showStats, setShowStats] = useState(false);

  // 여러 학생에게 넣을 과제 입력값
  const [multiTaskInput, setMultiTaskInput] = useState("");

  const [assignDate, setAssignDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const [localDoneMap, setLocalDoneMap] = useState<Record<string, boolean>>({});
  const [localSubDoneMap, setLocalSubDoneMap] =
    useState<Record<string, boolean>>({});

  const [printMode, setPrintMode] = useState<8 | 12>(12);
  const [searchTerm, setSearchTerm] = useState("");

  const [teacherComment, setTeacherComment] = useState("");
  const [studentExam, setStudentExam] = useState<any | null>(null);
  const [examProgress, setExamProgress] = useState<number>(0);
  const [examDetailOpen, setExamDetailOpen] = useState(false);
  const [examCardOpen, setExamCardOpen] = useState(false);


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

  const navigate = useNavigate();
  const getSchoolGroup = (s: any) => {
    const gl = (s.gradeLevel ?? "").toString();
    const g = (s.grade ?? "").toString();

    if (gl.includes("중") || g.includes("중")) return 0;
    if (gl.includes("고") || g.includes("고")) return 1;
    return 9;
  };

  const [wordCorrectBySid, setWordCorrectBySid] = useState<Record<string, number>>({});
  const [wordTotalBySid, setWordTotalBySid] = useState<Record<string, number>>({});
  const getGradeNumber = (s: any) => {
    const raw = `${s.grade ?? ""}`;
    const num = parseInt(raw.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(num) ? num : 99;
  };
  const stats = useMemo(() => {
    // 숨김/삭제 제외한 현인원
    const activeStudents = students.filter(
      (s: any) => s.removed !== true
    );

    const total = activeStudents.length;

    const count = (lv: string) =>
      activeStudents.filter((s: any) =>
        String(s.gradeLevel || "").includes(lv)
      ).length;

    return {
      total,
      elementary: count("초"),
      middle: count("중"),
      high: count("고"),
    };
  }, [students]);



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
    if (!selectedStudentIds.length) return alert("학생을 1명 이상 선택하세요.");
    if (!multiTaskInput.trim()) return alert("과제를 입력하세요.");
    if (!assignDate) return alert("날짜가 선택되지 않았습니다.");

    const tasks = multiTaskInput
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({
        id: crypto.randomUUID(),
        text,
        done: false,
        deleted: false,
      }));

    await Promise.all(
      selectedStudentIds.map(async (sid) => {
        const ref = doc(db, "studyPlans", sid, "days", assignDate);

        await setDoc(
          ref,
          {
            date: assignDate,
            common: {                // ✅ 여기! ruleSubject 제거
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

  const saveWordTestToCommon = async (
    sid: string,
    dateStr: string,
    correct: number,
    total: number
  ) => {

    const ref = doc(db, "studyPlans", sid, "days", dateStr);

    await setDoc(
      ref,
      {
        date: dateStr,
        common: {
          wordTest: { correct, total, updatedAt: serverTimestamp() },
        },
      },
      { merge: true }
    );
    setDayPlans((prev: any) => ({
      ...prev,
      [sid]: {
        ...(prev[sid] || {}),
        subjects: {
          ...(prev[sid]?.subjects || {}),
          common: {
            ...(prev[sid]?.subjects?.common || {}),
            wordTest: { correct, total }
          }
        }
      }
    }))
    // 🔥 화면 즉시 반영
    setWordCorrectBySid((prev) => ({ ...prev, [sid]: correct }));
    setWordTotalBySid((prev) => ({ ...prev, [sid]: total }));
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
                teacherComment: sRaw.teacherComment || "",
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


    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedStudentId) {
      setStudentExam(null);
      setExamProgress(0);
      return;
    }

    const loadStudentExam = async () => {
      try {
        const snap = await getDocs(
          collection(db, "studentExams", selectedStudentId, "exams")
        );

        if (snap.empty) {
          setStudentExam(null);
          setExamProgress(0);
          return;
        }

        const exams = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        const picked = pickCurrentOrLatestExam(exams);

        setStudentExam(picked);
        setExamProgress(calcExamProgress(picked));
      } catch (err) {
        console.error("학생 시험 데이터 불러오기 실패:", err);
        setStudentExam(null);
        setExamProgress(0);
      }
    };

    loadStudentExam();
  }, [selectedStudentId]);

  useEffect(() => {
    if (!selectedStudentId) return;
    const d = dayPlans[selectedStudentId];
    const wt = d?.subjects?.common?.wordTest;
    setWordCorrect(wt?.correct ?? 0);
    setWordTotal(wt?.total ?? 0);
  }, [selectedStudentId, dayPlans]);

  useEffect(() => {
    setExamCardOpen(false);
  }, [selectedStudentId]);
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
      setTeacherComment("");
      setWordCorrect(0);
      setWordTotal(0);
      return;
    }

    const day = dayPlans[selectedStudentId];

    const subj =
      day?.subjects?.[selectedSubject] ??
      day?.subjects?.["common"] ??
      {};

    setTeacherInput(
      (subj?.teacherTasks || [])
        .map((t: any) => t.text || t.title || "")
        .join("\n")
    );

    setStudentInput(
      (subj?.studentPlans || [])
        .map((t: any) => t.text || "")
        .join("\n")
    );

    setMemo(subj?.memo || "");
    setDone(!!subj?.done);
    setTeacherComment((subj as any)?.teacherComment || "");
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

    const stripUndefinedDeep = (obj: any): any => {
      if (Array.isArray(obj)) return obj.map(stripUndefinedDeep);
      if (obj && typeof obj === "object") {
        const out: any = {};
        Object.keys(obj).forEach((k) => {
          const v = obj[k];
          if (v === undefined) return;
          out[k] = stripUndefinedDeep(v);
        });
        return out;
      }
      return obj;
    };

    const teacherTasks: TaskItem[] = teacherInput
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text, idx) => {
        const prev = prevSubj?.teacherTasks?.[idx];
        const task: any = {
          id: prev?.id ?? crypto.randomUUID(),
          text,
          done: prev?.done ?? false,
          deleted: prev?.deleted ?? false,
          carriedFrom: prev?.carriedFrom ?? "",
        };
        if (prev?.subtasks) task.subtasks = prev.subtasks;
        return task as TaskItem;
      });

    // ✅ 학생계획은 덮지 말고 기존값 유지
    const studentPlans: TaskItem[] = (prevSubj?.studentPlans || []).map((t) => ({
      ...t,
    }));

    const mergedSubject: SubjectPlan = {
      teacherTasks,
      studentPlans,
      memo: memo.trim(),
      teacherComment: teacherComment.trim(),
      done,
      updatedAt: serverTimestamp(),
      proofImages: prevSubj?.proofImages || [],
      proofMemo: prevSubj?.proofMemo || "",
      wordTest: {
        correct: wordCorrect ?? prevSubj?.wordTest?.correct ?? 0,
        total: wordTotal ?? prevSubj?.wordTest?.total ?? 0,
      },
    };

    const payload = stripUndefinedDeep({
      date: dateStr,
      [selectedSubject]: mergedSubject,
    });

    await setDoc(ref, payload, { merge: true });

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

.date{
  position: absolute;
  top: 4.5mm;      /* 상단 라인 아래 */
  right: 5mm;      /* 카드 오른쪽 여백 맞춤 */
  font-size: 6pt;
  color: #9CA3AF;
  font-weight: 600;
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
        const dateStr = (card.getAttribute("data-date") || "").toString();
        let formattedDate = "";

        if (dateStr) {
          const d = new Date(dateStr);
          const days = ["일", "월", "화", "수", "목", "금", "토"];

          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          const weekday = days[d.getDay()];

          formattedDate = `${y}.${m}.${day} (${weekday})`;
        }

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
 ${formattedDate ? `<div class="date">${formattedDate}</div>` : ``}
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
      const subj =
        day?.subjects?.[selectedSubject] ??
        day?.subjects?.["common"] ??
        {};

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
  // ✅ table styles (기존 thCell/tdCell 말고 이걸로)
  const cellClamp: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const tableHeaderStyle: React.CSSProperties = {
    padding: "12px 14px",
    fontSize: 13,
    fontWeight: 800,
    color: "#475569",
    borderBottom: "2px solid #E2E8F0",
    textAlign: "left", // (원하면 center로 바꿔도 됨)
    ...cellClamp,
  };

  const tableRowStyle = (isSelected: boolean): React.CSSProperties => ({
    background: isSelected ? "#EEF2FF" : "#FFFFFF",
    borderBottom: "1px solid #F1F5F9",
    transition: "all 0.15s ease",
    cursor: "pointer",
  });

  const tableCellStyle: React.CSSProperties = {
    padding: "8px 12px",
    fontSize: 13,
    verticalAlign: "middle",
    ...cellClamp,

    // ✅ 행 구분선 (td에 줘야 보임)
    borderBottom: "1px solid #c3cfe0",
    backgroundClip: "padding-box",
  };

  const selectedRowAccent: React.CSSProperties = {
    boxShadow: "inset 4px 0 0 #2563EB",               // ✅ 왼쪽 포인트 바
  };
  const centerCell: React.CSSProperties = {
    ...tableCellStyle,
    textAlign: "center",
  };
  const tinyMuted: React.CSSProperties = {
    fontSize: 11,
    color: "#3b5579",
    fontWeight: 700,
  };

  const inoutCell: React.CSSProperties = {
    ...tableCellStyle,
    verticalAlign: "middle",
  };

  const dotRed: React.CSSProperties = {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "#EF4444",
    flex: "0 0 5px",
  };
  // ✅ 순공 시간: 가운데 정렬 + “숫자만 색”
  const netColor = (netMin: number) => {
    if (netMin >= 180) return "#14a03e";  // 3시간+
    if (netMin >= 60) return "#e98936";   // 1시간+
    return "#3b5579";                     // 그 외
  };

  const NetTimeCell = ({ netMin }: { netMin: number }) => {
    const hm = minToHM(netMin); // "6:47"
    const color = netColor(netMin);

    return (
      <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
        <span style={{ fontWeight: 900, color, fontVariantNumeric: "tabular-nums" }}>
          {hm}
        </span>
      </div>
    );
  };
  const calcExamProgress = (exam: any) => {
    let totalTarget = 0;
    let totalDone = 0;

    (exam?.subjects || []).forEach((sub: any) => {
      (sub?.ranges || []).forEach((rg: any) => {
        (rg?.tasks || []).forEach((task: any) => {
          totalTarget += Number(task?.target || 0);
          totalDone += Number(task?.done || 0);
        });
      });
    });

    return totalTarget === 0 ? 0 : Math.round((totalDone / totalTarget) * 100);
  };
  const getProgressStatus = (p: number) => {
    if (p >= 70) return "진행 양호";
    if (p >= 40) return "보통";
    return "주의";
  };

  const getProgressStatusColor = (progress: number) => {
    if (progress < 30) return { text: "⚠ 관리 필요", color: "#DC2626" };
    if (progress < 60) return { text: "진행중", color: "#D97706" };
    return { text: "정상", color: "#059669" };
  };

  const getProgressColor = (p: number) => {
    if (p >= 70) return "#16A34A";
    if (p >= 40) return "#D97706";
    return "#DC2626";
  };
  const getDaysLeftToExam = (exam: any) => {
    if (!exam?.examStart) return null;

    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const t1 = new Date(`${exam.examStart}T00:00:00`).getTime();

    if (isNaN(t1)) return null;
    return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
  };
  const getDDay = (examEnd?: string) => {
    if (!examEnd) return "";

    const today = new Date();
    const end = new Date(examEnd);

    const diff = Math.ceil(
      (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diff < 0) return "종료";
    if (diff === 0) return "D-day";
    return `D-${diff}`;
  };

  const getExamWarning = (exam: any, progress: number) => {
    const daysLeft = getDaysLeftToExam(exam);

    if (daysLeft !== null && daysLeft <= 7 && progress < 50) {
      return {
        text: "🚨 긴급 관리 필요",
        color: "#DC2626",
        bg: "#FEF2F2",
        border: "#FECACA",
      };
    }

    if (progress < 30) {
      return {
        text: "⚠ 관리 필요",
        color: "#D97706",
        bg: "#FFF7ED",
        border: "#FED7AA",
      };
    }

    return null;
  };

  const pickCurrentOrLatestExam = (exams: any[]) => {
    if (!exams.length) return null;

    const today = new Date();
    const todayYmd = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    ).getTime();

    const current = exams.find((exam) => {
      const start = exam?.planStart ? new Date(exam.planStart + "T00:00:00").getTime() : 0;
      const end = exam?.examEnd ? new Date(exam.examEnd + "T00:00:00").getTime() : 0;
      return start && end && todayYmd >= start && todayYmd <= end;
    });

    if (current) return current;

    return [...exams].sort((a, b) => {
      const aTime = a?.examStart ? new Date(a.examStart + "T00:00:00").getTime() : 0;
      const bTime = b?.examStart ? new Date(b.examStart + "T00:00:00").getTime() : 0;
      return bTime - aTime;
    })[0];
  };

  // ✅ 진행도 바 (너가 쓰던 바 스타일 유지 + 줄여서 통일)
  const ProgressCell = ({
    done,
    total,
    color,
  }: {
    done: number;
    total: number;
    color: string;
  }) => {
    if (!total || total <= 0) return <span style={{ color: "#CBD5E1" }}>-</span>;

    const pct = Math.max(0, Math.min(100, (done / total) * 100));

    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 6,
            minWidth: 54,
            background: "#E2E8F0",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: color,
              borderRadius: 999,
              transition: "width 0.2s ease",
            }}
          />
        </div>
        <span style={{ fontWeight: 800, color: "#334155", minWidth: 36, textAlign: "right" }}>
          {done}/{total}
        </span>
      </div>
    );
  };

  const statusBadge = (done: number, total: number) => {
    const percent = total > 0 ? (done / total) * 100 : 0;
    let bg = "#F1F5F9"; // 미시작
    let color = "#64748B";

    if (percent >= 100) { bg = "#DCFCE7"; color = "#166534"; } // 완료
    else if (percent > 0) { bg = "#DBEAFE"; color = "#1E40AF"; } // 진행중

    return { bg, color, percent };
  };

  const thCell: React.CSSProperties = {
    padding: "14px 12px",
    fontSize: "13px",
    fontWeight: 800,
    color: "#4B5563",
    textAlign: "center",
    background: "#F9FAFB",
    borderBottom: "2px solid #E5E7EB",
  };

  const tdCell: React.CSSProperties = {
    padding: "16px 12px",
    fontSize: "14px",
    textAlign: "center",
    borderBottom: "1px solid #F3F4F6",
  };

  const tdMid: React.CSSProperties = {
    ...tableCellStyle,
    verticalAlign: "middle",
  };
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
    const firestoreTaskId = task.id ?? task._uiId ?? task.taskIndex;

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

        const updatedTodayTasks = todayTasks.map((t: any, i: number) =>
          (t.id ?? t._uiId ?? i) === firestoreTaskId
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
      alert("이월에 실패했습니다. 코드를 확인해주세요.");
    }
  };
  const [memoModal, setMemoModal] = useState<{ show: boolean, studentId: string, studentName: string }>({
    show: false, studentId: '', studentName: ''
  });
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
      alert("삭제 실패");
    }
  };
  const tableHeaderCenter: React.CSSProperties = {
    ...tableHeaderStyle,
    textAlign: "center",
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
  // selectedStudents 아래쯤(아무데나 컴포넌트 안이면 됨)

  const COMMON_MODE = true;

  const COMMON = "common" as const;

  const filteredSummaryRows = summaryRows.filter((row) => {
    const q = (searchTerm || "").trim().toLowerCase();
    if (!q) return true;

    const name = (row.student.name || "").toLowerCase();
    const school = (row.student.school || "").toLowerCase();
    const grade = String(row.student.grade || "").toLowerCase();

    // ✅ "중2", "고1" 같은 검색
    if (q.includes("중") || q.includes("고")) {
      return grade.includes(q);
    }

    // ✅ 학교 검색 (율하, 수남 등)
    if (school.includes(q)) return true;

    // ✅ 이름 검색
    if (name.includes(q)) return true;

    return false;
  });
  const examWarning = studentExam ? getExamWarning(studentExam, examProgress) : null;

  const updateStudentTaskTarget = async (
    subKey: string,
    rangeId: string,
    taskKey: string,
    nextTarget: number
  ) => {
    if (!selectedStudentId || !studentExam?.id) return;

    const safeTarget = Math.max(0, Number(nextTarget || 0));

    const nextSubjects = (studentExam.subjects || []).map((sub: any) => {
      if (sub.key !== subKey) return sub;

      return {
        ...sub,
        ranges: (sub.ranges || []).map((rg: any) => {
          if (rg.id !== rangeId) return rg;

          return {
            ...rg,
            tasks: (rg.tasks || []).map((task: any) =>
              task.key === taskKey ? { ...task, target: safeTarget } : task
            ),
          };
        }),
      };
    });

    const ref = doc(db, "studentExams", selectedStudentId, "exams", studentExam.id);

    await setDoc(
      ref,
      {
        subjects: nextSubjects,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    setStudentExam((prev: any) =>
      prev
        ? {
          ...prev,
          subjects: nextSubjects,
        }
        : prev
    );
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
          padding: "20px 24px",
          background: "#FFFFFF",
          borderRadius: "24px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)",
          marginBottom: "24px",
          border: "1px solid #F1F5F9",
          flexWrap: "wrap",
          gap: 16
        }}
      >
        {/* 왼쪽: 브랜드 및 타이틀 영역 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* 로고 강조: 그라데이션 적용 */}
            <div style={{
              letterSpacing: "-0.5px",
              fontSize: 30,
              fontWeight: 900,
              background: "linear-gradient(135deg, #8B1E1E 0%, #1d3d86 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              OPTIMUM EDUCORE
            </div>
            <div style={{ width: 1, height: 14, background: "#E2E8F0" }} />
            <div style={{ fontSize: 19, fontWeight: 800, color: "#1E293B" }}>
              선생님 대시보드
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#94A3B8", fontWeight: 500 }}>
            실시간 출결 및 과제 진행도 통합 관리 시스템
          </div>
        </div>

        {/* 오른쪽: 액션 및 상태 영역 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* 날짜 선택 - 깔끔한 박스 스타일 */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#F8FAFC",
            padding: "8px 14px",
            borderRadius: "14px",
            border: "1px solid #E2E8F0"
          }}>
            <span style={{ fontSize: 12, color: "#64748B", fontWeight: 700 }}>Date</span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              style={{
                border: "none",
                background: "transparent",
                fontSize: 13,
                fontWeight: 800,
                color: "#3B82F6",
                outline: "none",
                cursor: "pointer",
              }}
            />
          </div>


          {/* 운영 버튼 - 캡슐 스타일 */}
          <OpsModal open={opsOpen} onClose={() => setOpsOpen(false)} />
          <button
            onClick={() => setOpsOpen(true)}
            style={{
              padding: "10px 18px",
              borderRadius: "14px",
              border: "none",
              background: "#FDF4FF",
              color: "#A21CAF",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#FAE8FF")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#FDF4FF")}
          >
            <span>⚙️</span> 운영/출결
          </button>
          <button
            onClick={() => navigate("/exam-manage")}
            style={{
              padding: "10px 18px",
              borderRadius: "14px",
              border: "none",
              background: "#EEF2FF",
              color: "#121f66",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#E0E7FF")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#EEF2FF")}
          >
            <span>📝</span> 시험관리
          </button>


          {/* 학생수 - 배지 스타일 */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowStats((v) => !v)}
              style={{
                padding: "10px 18px",
                borderRadius: "14px",
                border: "1px solid #E2E8F0",
                background: showStats ? "#1d3d86" : "#fff",
                color: showStats ? "#fff" : "#1d3d86",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 2px 4px rgba(0,0,0,0.02)"
              }}
            >
              <span>👥</span> {stats.total}명
            </button>

            {/* 학생수 상세 팝오버 (토글) */}
            {showStats && (
              <div style={{
                position: "absolute",
                top: "52px",
                right: 0,
                background: "#fff",
                padding: "16px",
                borderRadius: "18px",
                boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
                border: "1px solid #F1F5F9",
                whiteSpace: "nowrap",
                zIndex: 100,
                display: "flex",
                flexDirection: "column",
                gap: 10
              }}>
                <div style={{ fontSize: 12, color: "#94A3B8", borderBottom: "1px solid #F1F5F9", paddingBottom: 6 }}>학교급별 현황</div>
                <div style={{ display: "flex", gap: 16, fontSize: 13, fontWeight: 700 }}>
                  <span style={{ color: "#64748B" }}>초등 <b style={{ color: "#0F172A" }}>{stats.elementary}</b></span>
                  <span style={{ color: "#64748B" }}>중등 <b style={{ color: "#0F172A" }}>{stats.middle}</b></span>
                  <span style={{ color: "#64748B" }}>고등 <b style={{ color: "#0F172A" }}>{stats.high}</b></span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* ✅ 전체 2컬럼 래퍼 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "240px 1fr", // 좌측 고정, 우측 유동
          gap: 14,
          alignItems: "start",
        }}
      >
        {/* ---------------- 좌측: 학생 리스트 섹션 ---------------- */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "24px",
            border: "1px solid #F1F5F9",
            padding: "20px",
            maxHeight: "800px",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 10px 30px rgba(0,0,0,0.02)",
          }}
        >
          {/* 1. 상단 타이틀 & 카운트 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>👥</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: "#1E293B" }}>학생 목록</span>
            </div>

          </div>

          {/* 2. 검색바 */}
          <div style={{ position: "relative", marginBottom: 20 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }}>
              🔍
            </span>
            <input
              type="text"
              placeholder="이름 · 학교 · 학년 검색 (예: 김, 율하, 중2)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 12px 12px 38px",
                borderRadius: "12px",
                border: "1px solid #E2E8F0",
                background: "#F8FAFC",
                fontSize: "13px",
                fontWeight: 600,
                outline: "none",
              }}
            />
          </div>

          {/* 3. 리스트 영역(스크롤) */}
          <div style={{ flex: 1, overflowY: "auto", paddingRight: 4, display: "flex", flexDirection: "column" }}>
            {/* 중학생 */}
            <div style={{
              fontSize: 11,
              fontWeight: 900,
              color: "#64748B",
              margin: "14px 0 6px 4px",
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}>
              MIDDLE SCHOOL
            </div>

            {middle
              .filter((s) => {
                const q = searchTerm.trim();
                if (!q) return true;
                return s.name.includes(q) || (s.school ?? "").includes(q);
              })
              .map((s) => {
                const active = s.id === selectedStudentId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStudentId(s.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: active ? "1px solid #1E3A8A" : "1px solid transparent",
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
                  </button>
                );
              })}

            {/* 고등학생 */}
            <div style={{
              fontSize: 11,
              fontWeight: 900,
              color: "#64748B",
              margin: "14px 0 6px 4px",
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}>
              HIGH SCHOOL
            </div>

            {high
              .filter((s) => {
                const q = searchTerm.trim();
                if (!q) return true;
                return s.name.includes(q) || (s.school ?? "").includes(q);
              })
              .map((s) => {
                const active = s.id === selectedStudentId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStudentId(s.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: active ? "1px solid #1E3A8A" : "1px solid transparent",
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
                  </button>
                );
              })}
          </div>
        </div>


        {/* ✅ 오늘 전체 학생 요약 테이블 */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 20,
            border: "1px solid #E2E8F0",
            padding: 16,
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.06)",

            overflowX: "hidden",   // ✅ auto → hidden (커서 땡기는거 제거)
            overflowY: "visible",
            position: "relative",
            width: "100%",         // ✅ 안전
            maxWidth: "100%",      // ✅ 안전
          }}
        >
          {/* 헤더 */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>📊</span>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: "#1c397a", margin: 0 }}>
                EDUCORE 학생 요약
              </h2>
              <span
                style={{
                  fontSize: 11,
                  background: "#E2E8F0",
                  padding: "2px 8px",
                  borderRadius: 999,
                  color: "#475569",
                  fontWeight: 800,
                }}
              >
              </span>
            </div>

            {loading && (
              <div style={{ fontSize: 12, color: "#2563EB", fontWeight: 800 }} className="animate-pulse">
                동기화 중...
              </div>
            )}
          </div>

          <table
            style={{
              width: "100%",
              minWidth: 0,          // ✅ 970 삭제
              borderCollapse: "separate",
              borderSpacing: 0,
              tableLayout: "fixed",
            }}
          >
            {/* ✅ 여기! thead 위에 colgroup */}
            <colgroup><col style={{ width: 150 }} /><col style={{ width: 120 }} /><col style={{ width: 90 }} /><col style={{ width: 130 }} /><col style={{ width: 130 }} /><col style={{ width: 60 }} /><col style={{ width: 70 }} /><col style={{ width: 80 }} /></colgroup>
            <thead>
              <tr>
                <th
                  style={{
                    ...tableHeaderCenter,
                    verticalAlign: "middle",
                    borderRadius: "12px 0 0 12px",
                  }}
                >
                  학생 정보
                </th>
                <th style={tableHeaderCenter}>등/하원</th>
                <th style={tableHeaderCenter}>순공시간</th>
                <th style={tableHeaderCenter}>선생님과제</th>
                <th style={tableHeaderCenter}>학생계획</th>
                <th style={tableHeaderCenter}>단어</th>
                <th style={tableHeaderCenter}>상담</th>
                <th style={{ ...tableHeaderCenter, borderRadius: "0 12px 12px 0" }}>플랜</th>
              </tr>
            </thead>

            <tbody>
              {filteredSummaryRows.map((row) => {
                const sid = row.student.id;
                const isSelected = sid === selectedStudentId;
                const hasCheckedIn = !!row.inTime;
                const day = dayPlans[sid];

                const wordTest = day?.subjects?.common?.wordTest || { correct: 0, total: 0 };

                const wordText = wordTest.total
                  ? `${wordTest.correct}/${wordTest.total}`
                  : "";

                const common = day?.subjects?.["common"];
                const raw = common?.teacherTasks || [];


                const subjects = day?.subjects || {};

                const studentPlansAll = Object.entries(subjects).flatMap(([subjectKey, sp]: any) => {
                  const arr = sp?.studentPlans || [];
                  return arr.map((p: any, idx: number) => ({
                    subjectKey,
                    idx,
                    text: p?.text || p?.title || "",
                    done: !!p?.done,
                  }));
                }).filter((x) => x.text);


                // ✅ DashboardTask 형태로 맞춰서 렌더링용 만들기
                const teacherTasks = (raw as any[]).map((t, idx) => ({
                  ...t,
                  _uiId: t._uiId ?? `${sid}_${dateStr}_common_${idx}`, // 없으면 생성
                  taskIndex: t.taskIndex ?? idx,                      // 없으면 idx로
                  subjectKey: t.subjectKey ?? "common",               // common 고정
                  date: t.date ?? dateStr,                            // 오늘 날짜로
                }));

                return (
                  <React.Fragment key={sid}>
                    {/* --- [1] 상단 요약 행 --- */}
                    <tr
                      onClick={() => setSelectedStudentId(isSelected ? null : sid)}
                      style={{
                        ...tableRowStyle(isSelected),
                        ...(isSelected ? selectedRowAccent : {}),
                        // 선택 시 하단 테두리를 없애 아코디언과 연결된 느낌 부여
                        borderBottom: isSelected ? "none" : "1px solid #F1F5F9",
                        cursor: "pointer",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "#F8FAFC";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "#FFFFFF";
                      }}
                    >
                      {/* 1) 학생 정보 */}
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          {!hasCheckedIn && <span style={dotRed} title="미등원" />}

                          <span
                            style={{
                              fontWeight: 900,
                              color: "#0F172A",
                              fontSize: 13,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1,
                            }}
                            title={row.student.name}
                          >
                            {row.student.name}
                          </span>

                          <span style={{ ...tinyMuted, whiteSpace: "nowrap" }}>
                            {row.student.school ?? ""} {row.student.grade ?? ""}
                          </span>
                        </div>
                      </td>

                      {/* 2) 등하원 */}
                      <td style={tdMid}>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center", // ✅ 세로 가운데
                            alignItems: "center",     // ✅ 가로 가운데 (원하면 left로 바꿔도 됨)
                            gap: 2,
                            fontSize: 12,
                            minHeight: 44,            // ✅ 행 높이 기준
                            lineHeight: 1.15,
                          }}
                        >
                          <span style={{ color: row.inTime ? "#2563EB" : "#94A3B8", fontWeight: 900 }}>
                            IN: {row.inTime || "--:--"}
                          </span>
                          <span style={{ color: row.outTime ? "#F59E0B" : "#94A3B8", fontWeight: 800 }}>
                            OUT: {row.outTime || "--:--"}
                          </span>
                        </div>
                      </td>

                      {/* 3) 순공 시간 */}
                      <td style={centerCell}>
                        <NetTimeCell netMin={row.netMin} />
                      </td>

                      {/* 4) 선생님 과제 진행률 */}
                      <td style={tableCellStyle}>
                        <ProgressCell done={row.teacherDone} total={row.teacherTotal} color="#6366F1" />
                      </td>

                      {/* 5) 학생 계획 진행률 */}
                      <td style={tableCellStyle}>
                        <ProgressCell done={row.studentDone} total={row.studentTotal} color="#EC4899" />
                      </td>

                      {/* 6) 단어 시험 결과 */}
                      <td style={centerCell}>
                        {row.wordTotal ? (
                          <div style={{ fontWeight: 900, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                            <span style={{ color: "#2563EB" }}>{row.wordCorrect ?? 0}</span>
                            <span style={{ color: "#CBD5E1", margin: "0 2px" }}>/</span>
                            <span style={{ color: "#0F172A" }}>{row.wordTotal}</span>
                          </div>
                        ) : (
                          <span style={{ color: "#CBD5E1" }}>-</span>
                        )}
                      </td>

                      {/* 7) 메모 아이콘 */}
                      <td style={centerCell}>
                        <span
                          onClick={(e) => { e.stopPropagation(); console.log("메모", sid); }}
                          style={{ fontSize: 18, cursor: "pointer" }}
                        >
                          📝
                        </span>
                      </td>

                      {/* 8) 관리 버튼 */}
                      <td style={centerCell}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/study-plan/${sid}?role=teacher`);
                          }}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 8,
                            border: "1px solid #E2E8F0",
                            background: "#FFFFFF",
                            color: "#475569",
                            fontSize: 11,
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          관리
                        </button>
                      </td>
                    </tr>

                    {/* --- [2] ✅ 아코디언 상세 영역 (펼쳐지는 부분) --- */}
                    {isSelected && (
                      <tr>
                        <td
                          colSpan={8}
                          style={{
                            padding: "0 16px 16px",
                            background: "#b2cbe1",
                            overflow: "visible",
                            position: "relative",  // ✅
                            zIndex: 5,             // ✅
                          }}
                        >
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: "100%",
                              maxWidth: "100%",
                              boxSizing: "border-box",
                              position: "relative",
                              zIndex: 5,
                              background: "#FFFFFF",
                              borderRadius: "0 0 14px 14px",
                              border: "1px solid #E2E8F0",
                              borderTop: "none",
                              padding: 16,

                              display: "grid",
                              gridTemplateColumns: "minmax(0, 400px) minmax(0, 400px)", // ✅ 우측 폭 줄임
                              gap: 14,

                              // ✅ 핵심: grid에서 삐져나오는 문제는 minWidth:0 로 잡는다
                              minWidth: 0,
                              overflow: "visible", // ✅ 여기서도 hidden 금지
                            }}
                          >
                            {/* 좌측 */}
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 900,
                                  color: "#1E293B",
                                  marginBottom: 10,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                }}
                              >
                                <span>🎯 선생님 과제 입력</span>
                                <span style={{ fontSize: 11, color: "#3B82F6", whiteSpace: "nowrap" }}>
                                  입력 후 바깥 클릭 시 자동저장
                                </span>
                              </div>

                              <textarea
                                placeholder="엔터(줄바꿈)로 여러 과제를 한 번에 입력 가능합니다."
                                value={teacherInput}
                                onChange={(e) => setTeacherInput(e.target.value)}
                                onBlur={() => handleSave()}
                                style={{
                                  width: "100%",
                                  boxSizing: "border-box",
                                  height: 200,
                                  borderRadius: 12,
                                  border: "2px solid #F1F5F9",
                                  padding: "12px",
                                  fontSize: 12,
                                  lineHeight: "1.6",
                                  outline: "none",
                                  resize: "none",
                                  background: "#F9FBFF",
                                  fontWeight: 550,
                                }}
                              />
                              {/* ✅ 단어 시험 입력 (맞은/총) */}
                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: 12, fontWeight: 900, color: "#1E293B", marginBottom: 6 }}>
                                  🧠 단어 시험 (맞은 개수 / 총 문제)
                                </div>

                                <div style={{ display: "flex", gap: 10 }}>
                                  <input
                                    type="number"
                                    value={wordCorrect}
                                    onChange={(e) => setWordCorrect(Number(e.target.value || 0))}
                                    onBlur={() => saveWordTestToCommon(sid, dateStr, wordCorrect, wordTotal)}
                                    placeholder="맞은 개수"
                                    style={{
                                      width: 110,
                                      borderRadius: 10,
                                      border: "1px solid #E5E7EB",
                                      padding: "8px 10px",
                                      fontSize: 12,
                                      background: "#fff",
                                    }}
                                  />

                                  <input
                                    type="number"
                                    value={wordTotal}
                                    onChange={(e) => setWordTotal(Number(e.target.value || 0))}
                                    onBlur={() => saveWordTestToCommon(sid, dateStr, wordCorrect, wordTotal)}
                                    placeholder="총 문제"
                                    style={{
                                      width: 110,
                                      borderRadius: 10,
                                      border: "1px solid #E5E7EB",
                                      padding: "8px 10px",
                                      fontSize: 12,
                                      background: "#fff",
                                    }}
                                  />

                                  {/* 표시용 */}
                                  <div style={{ alignSelf: "center", fontSize: 12, color: "#64748B", fontWeight: 800 }}>
                                    {wordTotal > 0 ? `${wordCorrect}/${wordTotal}` : "—"}
                                  </div>
                                </div>
                              </div>
                            </div>



                            {/* 우측 */}
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                              <div style={{ fontSize: 13, fontWeight: 900, color: "#1E293B", marginBottom: 10 }}>
                                📋 선생님 과제목록 ({teacherTasks.length})
                              </div>

                              <div
                                style={{
                                  maxHeight: 160,
                                  overflowY: "auto",
                                  display: "flex",
                                  flexDirection: "column",
                                  border: "1px solid #E5E7EB",
                                  borderRadius: 12,
                                  background: "#FFFFFF",
                                  minWidth: 0,
                                }}
                              >
                                {teacherTasks.length === 0 && (
                                  <div style={{ padding: "18px 0", textAlign: "center", color: "#CBD5E1", fontSize: 12 }}>
                                    등록된 과제가 없습니다.
                                  </div>
                                )}

                                {teacherTasks.map((t: any, idx: number) => {
                                  // ✅ 1) 상태 정리
                                  const carriedIn = !!t.carriedFrom;      // 어제/이전날에서 '들어온' 과제
                                  const carriedOut = t.deleted === true;  // 오늘에서 '이월 보내져서' 줄그어진 과제

                                  // ✅ 2) carryOverMainTask / deleteMainTask 가 먹게 DashboardTask 형태로 가공
                                  const uiId =
                                    (t.id ?? t._uiId ?? `common_${sid}_${dateStr}_${idx}`) as string;

                                  const dashTask = {
                                    ...t,
                                    _uiId: uiId,
                                    id: t.id ?? uiId,
                                    subjectKey: "common",
                                    taskIndex: idx,
                                    date: dateStr,
                                    title: t.title ?? "",
                                    text: t.text ?? t.title ?? "",
                                  };

                                  // ✅ 3) 버튼 노출 조건(원하는대로 조절 가능)
                                  const canCarry =
                                    !carriedOut && !t.done; // 이월된건 숨기고 / 완료된건 이월 못하게

                                  return (
                                    <div
                                      key={uiId}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "10px 12px",
                                        borderBottom: idx === teacherTasks.length - 1 ? "none" : "1px solid #F1F5F9",
                                        minWidth: 0,
                                      }}
                                    >
                                      {/* ✅ 체크 */}
                                      <input
                                        type="checkbox"
                                        checked={!!t.done}
                                        disabled={carriedOut}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={() => toggleMainFromDashboard(sid, dateStr, "common", idx)}
                                        style={{ width: 16, height: 16, cursor: carriedOut ? "not-allowed" : "pointer" }}
                                      />

                                      {/* ✅ 제목 */}
                                      <div
                                        style={{
                                          flex: 1,
                                          minWidth: 0,
                                          fontSize: 13,
                                          fontWeight: 700,
                                          whiteSpace: "nowrap",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          color: carriedOut
                                            ? "#94A3B8"
                                            : carriedIn
                                              ? "#1a8423"
                                              : "#0F172A",
                                          textDecoration: carriedOut ? "line-through" : "none",
                                          opacity: carriedOut ? 0.7 : 1,
                                        }}
                                        title={t.text || t.title}
                                      >
                                        {carriedIn ? "🕒 " : ""}
                                        {t.text || t.title}
                                        {carriedOut ? (
                                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: "#94A3B8" }}>
                                            (이월됨)
                                          </span>
                                        ) : null}
                                      </div>

                                      {/* ✅ 우측 액션: 이월 + 삭제 */}
                                      <div style={{ display: "inline-flex", gap: 6, flex: "0 0 auto" }}>
                                        {/* 이월 버튼 (트렌디 캡슐) */}
                                        {canCarry && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              // ✅ subtasks 없는 common 과제라 remainingSubs는 빈 배열로
                                              carryOverMainTask(sid, dateStr, dashTask as any, []);
                                            }}
                                            style={{
                                              height: 22,
                                              padding: "0 10px",
                                              borderRadius: 999,
                                              border: "1px solid #E2E8F0",
                                              background: "#F8FAFC",
                                              color: "#334155",
                                              fontSize: 11,
                                              fontWeight: 900,
                                              cursor: "pointer",
                                              whiteSpace: "nowrap",
                                            }}
                                            title="내일로 이월"
                                          >
                                            이월
                                          </button>
                                        )}

                                        {/* 삭제 버튼 */}
                                        {!carriedOut && (
                                          <button
                                            type="button"
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              await deleteMainTask(sid, dateStr, "common", uiId);
                                            }}
                                            style={{
                                              height: 22,
                                              padding: "0 10px",
                                              borderRadius: 999,
                                              border: "1px solid #FECACA",
                                              background: "#FFFFFF",
                                              color: "#EF4444",
                                              fontSize: 11,
                                              fontWeight: 900,
                                              cursor: "pointer",
                                              whiteSpace: "nowrap",
                                            }}
                                            title="삭제"
                                          >
                                            삭제
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                  );
                                })}

                              </div>


                              {/* ✅ 학생 계획 (읽기 전용) */}
                              <div
                                style={{
                                  marginTop: 12,
                                  border: "1px solid #E5E7EB",
                                  borderRadius: 12,
                                  background: "#FFFFFF",
                                  padding: 12,
                                }}
                              >
                                <div style={{ fontSize: 13, fontWeight: 900, color: "#1E293B", marginBottom: 8 }}>
                                  🧩 학생 계획 ({studentPlansAll.length})
                                </div>

                                {studentPlansAll.length === 0 ? (
                                  <div style={{ fontSize: 12, color: "#94A3B8" }}>학생이 입력한 계획이 없습니다.</div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    {studentPlansAll.slice(0, 8).map((p) => (
                                      <div
                                        key={`${p.subjectKey}_${p.idx}`}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 8,
                                          fontSize: 12,
                                          color: p.done ? "#94A3B8" : "#0F172A",
                                          textDecoration: p.done ? "line-through" : "none",
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: 11,
                                            padding: "2px 8px",
                                            borderRadius: 999,
                                            background: "#F1F5F9",
                                            color: "#334155",
                                            fontWeight: 800,
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {p.subjectKey}
                                        </span>
                                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {p.text}
                                        </span>
                                      </div>
                                    ))}
                                    {studentPlansAll.length > 8 && (
                                      <div style={{ fontSize: 11, color: "#94A3B8" }}>
                                        + {studentPlansAll.length - 8}개 더 있음 (상세는 학생 플래너에서)
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {selectedStudentId && (
                            <div
                              style={{
                                marginTop: 20,
                                border: "1px solid #F1F5F9",
                                borderTop: `4px solid ${getProgressColor(examProgress)}`,
                                borderRadius: 20,
                                background: "#FFFFFF",
                                padding: 20,
                                boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.05)",
                              }}
                            >
                              <div
                                onClick={() => setExamCardOpen((prev) => !prev)}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  cursor: "pointer",
                                  marginBottom: examCardOpen ? 16 : 0,
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: 17,
                                      fontWeight: 900,
                                      color: "#1a3175",
                                      letterSpacing: "-0.02em",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    [시험기간 진행 현황]
                                  </div>

                                  {studentExam && (
                                    <div
                                      style={{
                                        fontSize: 16,
                                        fontWeight: 800,
                                        color: "#569f4d",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {studentExam.title || "시험명 없음"} · {examProgress}% ·{" "}

                                      <span
                                        style={{
                                          color: getProgressStatusColor(examProgress).color,
                                          fontWeight: 800,
                                          marginLeft: 2,
                                        }}
                                      >
                                        {getProgressStatusColor(examProgress).text}
                                      </span>

                                      <span style={{ color: "#64748B", fontWeight: 700, marginLeft: 6 }}>
                                        {getDDay(studentExam.examEnd)}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 800,
                                    color: "#64748B",
                                    whiteSpace: "nowrap",
                                    marginLeft: 12,
                                  }}
                                >
                                  {examCardOpen ? "접기 ▴" : "펼치기 ▾"}
                                </div>
                              </div>

                              {examCardOpen && (
                                <>
                                  {!studentExam ? (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        color: "#94A3B8",
                                        border: "1px dashed #E2E8F0",
                                        borderRadius: 12,
                                        background: "#F8FAFC",
                                        padding: "20px 0",
                                        textAlign: "center",
                                        marginTop: 16,
                                      }}
                                    >
                                      현재 배포된 시험 일정이 없습니다.
                                    </div>
                                  ) : (
                                    <>
                                      <div style={{ marginBottom: 16 }}>
                                        <div
                                          style={{
                                            fontSize: 16,
                                            fontWeight: 850,
                                            color: "#1E293B",
                                            marginBottom: 4,
                                          }}
                                        >
                                          {studentExam.title || "시험명 없음"}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: 12,
                                            color: "#94A3B8",
                                            fontWeight: 500,
                                          }}
                                        >
                                          {studentExam.planStart || "-"} ~ {studentExam.examEnd || "-"}
                                        </div>
                                      </div>

                                      {/*examWarning && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: examWarning.bg,
                    color: examWarning.color,
                    fontSize: 12,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  ⚠️ {examWarning.text}
                </div>
              )} */}

                                      <div
                                        style={{
                                          height: 10,
                                          borderRadius: 999,
                                          background: "#F1F5F9",
                                          overflow: "hidden",
                                          marginBottom: 20,
                                        }}
                                      >
                                        <div
                                          style={{
                                            width: `${examProgress}%`,
                                            height: "100%",
                                            background: getProgressColor(examProgress),
                                            borderRadius: 999,
                                            transition: "width 0.6s ease-out",
                                          }}
                                        />
                                      </div>

                                      <div style={{ display: "grid", gap: 10 }}>
                                        {(studentExam.subjects || []).slice(0, 3).map((sub: any) => {
                                          let subTarget = 0;
                                          let subDone = 0;

                                          (sub.ranges || []).forEach((rg: any) => {
                                            (rg.tasks || []).forEach((task: any) => {
                                              subTarget += Number(task.target || 0);
                                              subDone += Number(task.done || 0);
                                            });
                                          });

                                          const subProgress =
                                            subTarget === 0 ? 0 : Math.round((subDone / subTarget) * 100);

                                          return (
                                            <div
                                              key={sub.key}
                                              style={{
                                                border: "1px solid #F1F5F9",
                                                borderRadius: 12,
                                                padding: "12px",
                                                background: "#FCFCFD",
                                              }}
                                            >
                                              <div
                                                style={{
                                                  display: "flex",
                                                  justifyContent: "space-between",
                                                  marginBottom: 6,
                                                }}
                                              >
                                                <span
                                                  style={{
                                                    fontSize: 13,
                                                    fontWeight: 700,
                                                    color: "#334155",
                                                  }}
                                                >
                                                  {sub.name}
                                                </span>
                                                <span
                                                  style={{
                                                    fontSize: 12,
                                                    fontWeight: 800,
                                                    color: getProgressColor(subProgress),
                                                  }}
                                                >
                                                  {subProgress}%
                                                </span>
                                              </div>

                                              <div
                                                style={{
                                                  height: 6,
                                                  borderRadius: 999,
                                                  background: "#E2E8F0",
                                                  overflow: "hidden",
                                                }}
                                              >
                                                <div
                                                  style={{
                                                    width: `${subProgress}%`,
                                                    height: "100%",
                                                    background: getProgressColor(subProgress),
                                                    borderRadius: 999,
                                                  }}
                                                />
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>

                                      <button
                                        onClick={() => setExamDetailOpen(true)}
                                        style={{
                                          marginTop: 16,
                                          width: "100%",
                                          height: 40,
                                          borderRadius: 12,
                                          border: "none",
                                          background: "#F1F5F9",
                                          color: "#475569",
                                          fontSize: 12,
                                          fontWeight: 800,
                                          cursor: "pointer",
                                        }}
                                      >
                                        시험 상세 리포트 보기
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          )}
{examDetailOpen && (
  <div
    onClick={() => setExamDetailOpen(false)}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(15, 23, 42, 0.75)", // 조금 더 어둡게 해서 모달에 집중
      backdropFilter: "blur(8px)", // 블러 효과 강화
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
      padding: 20,
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: "min(1000px, 100%)",
        maxHeight: "90vh",
        overflowY: "auto",
        background: "#F1F5F9", // 전체 배경은 살짝 회색
        borderRadius: 32,
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 헤더 섹션 */}
      <div style={{
        padding: "32px 32px 24px",
        background: "#FFFFFF",
        borderRadius: "32px 32px 0 0",
        borderBottom: "1px solid #E2E8F0"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#0F172A", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 28 }}>📊</span> 과목별 상세 진행도
            </div>
            <div style={{ fontSize: 14, color: "#64748B", fontWeight: 600 }}>
              {studentExam?.title || "시험명 없음"} • {studentExam?.planStart || "-"} ~ {studentExam?.examEnd || "-"}
            </div>
          </div>
          <button
            onClick={() => setExamDetailOpen(false)}
            style={{
              width: 40, height: 40, borderRadius: 12, border: "none", background: "#F1F5F9",
              fontSize: 20, cursor: "pointer", color: "#64748B", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s"
            }}
          >✕</button>
        </div>

        {/* 전체 진행률 요약 바 */}
        <div style={{ marginTop: 24, background: "#F8FAFC", padding: 16, borderRadius: 20, border: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
            <span style={{ fontWeight: 800, color: "#334155" }}>전체 목표 달성도</span>
            <span style={{ fontWeight: 900, color: getProgressColor(examProgress), fontSize: 18 }}>{examProgress}%</span>
          </div>
          <div style={{ height: 12, background: "#E2E8F0", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${examProgress}%`, height: "100%", background: `linear-gradient(90deg, ${getProgressColor(examProgress)}, #4ade80)`, borderRadius: 999 }} />
          </div>
        </div>
      </div>

      {/* 본문 그리드 섹션 */}
      <div style={{ padding: 32, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 24 }}>
        {(studentExam?.subjects || []).map((sub: any) => {
          let subTarget = 0, subDone = 0;
          (sub.ranges || []).forEach((rg: any) => {
            (rg.tasks || []).forEach((task: any) => {
              subTarget += Number(task.target || 0);
              subDone += Number(task.done || 0);
            });
          });
          const subProgress = subTarget === 0 ? 0 : Math.round((subDone / subTarget) * 100);

          return (
            <div key={sub.key} style={{
              background: "#FFFFFF", borderRadius: 24, padding: 20, border: "1px solid #E2E8F0",
              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)", display: "flex", flexDirection: "column", gap: 20
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: "#1E293B" }}>{sub.name}</span>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: getProgressColor(subProgress) }}>{subProgress}%</div>
                  <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700 }}>{subDone}/{subTarget} 완료</div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(sub.ranges || []).map((rg: any) => (
                  <div key={rg.id} style={{ padding: 14, borderRadius: 16, background: "#F8FAFC", border: "1px solid #F1F5F9" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#475569", marginBottom: 10 }}>
                      📍 { [rg.big, rg.small].filter(Boolean).join(" > ") }
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(rg.tasks || []).map((task: any) => {
                        const done = Number(task.done || 0);
                        const target = Number(task.target || 0);
                        return (
                          <div key={task.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748B", flex: 1 }}>{task.label}</span>
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <div style={{ display: "flex", gap: 2 }}>
                                {Array.from({ length: Math.max(target, 1) }).map((_, i) => (
                                  <div key={i} style={{
                                    width: 16, height: 16, borderRadius: 4, border: "1px solid",
                                    borderColor: i < done ? "#22C55E" : "#CBD5E1",
                                    background: i < done ? "#DCFCE7" : "transparent",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 10, color: "#166534", fontWeight: 900
                                  }}>
                                    {i < done ? "✓" : ""}
                                  </div>
                                ))}
                              </div>
                              <input
                                type="number" min={0} value={target}
                                onChange={(e) => updateStudentTaskTarget(sub.key, rg.id, task.key, Number(e.target.value))}
                                style={{
                                  width: 32, height: 22, borderRadius: 6, border: "1px solid #E2E8F0",
                                  background: "#FFF", textAlign: "center", fontSize: 11, fontWeight: 800, color: "#334155", outline: "none"
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 하단 버튼 섹션 */}
      <div style={{ padding: "0 32px 32px" }}>
        <button
          onClick={() => setExamDetailOpen(false)}
          style={{
            width: "100%", height: 56, borderRadius: 18, border: "none",
            background: "#0F172A", color: "#fff", fontSize: 16, fontWeight: 800,
            cursor: "pointer", transition: "transform 0.1s",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)"
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.01)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
        >
          학습 진행 상황 확인 완료
        </button>
      </div>
    </div>
  </div>
)}

                          {/* ✅ 티키타카 대화창 (2열 전체폭) */}
                          <div
                            style={{
                              marginTop: 12,
                              background: "#fff",
                              border: "1px solid #dbe4f0",
                              borderRadius: 12,
                              padding: 12,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 800,
                                color: "#475569",
                                marginBottom: 8,
                              }}
                            >
                              선생님 코멘트
                            </div>

                            <textarea
                              value={teacherComment}
                              onChange={(e) => setTeacherComment(e.target.value)}
                              onBlur={handleSave}
                              placeholder="학생에게 남길 코멘트를 입력하세요"
                              style={{
                                width: "100%",
                                minHeight: 72,
                                resize: "vertical",
                                borderRadius: 10,
                                border: "1px solid #CBD5E1",
                                padding: "10px 12px",
                                fontSize: 13,
                                outline: "none",
                                boxSizing: "border-box",
                                background: "#fff",
                              }}
                            />
                          </div>


                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>


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


                {!COMMON_MODE && (
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
                )}
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

                  {/* 🔥  인증샷/메모 표시 (읽기 전용) */}
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
                          📸 인증
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
                  data-date={assignDate}
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