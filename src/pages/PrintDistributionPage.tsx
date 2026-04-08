import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  addDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";

type SchoolLevel = "middle" | "high" | "all";
type ViewMode = "grouped" | "rows";
type PrintKind = "required" | "optional";
type StatusFilter = "all" | "pending" | "optionalOnly" | "completed";

type StudentRow = {
  id: string;
  name?: string;
  school?: string;
  grade?: string;
  hidden?: boolean;
  isActive?: boolean;
  removed?: boolean;
};

type SummaryRange = "today" | "7d" | "30d" | "all";


type PrintDistribution = {
  id: string;
  distributedDate: string;
  subject: string;
  title: string;
  studentId: string;
  studentName: string;
  school: string;
  grade: string;
  schoolLevel: "middle" | "high";
  kind: PrintKind;
  submittedDate?: string;

  submittedAt?: any;
  checkedAt?: any;
};

type GroupedStudentRows = {
  studentId: string;
  studentName: string;
  school: string;
  grade: string;
  total: number;
  requiredCount: number;
  optionalCount: number;
  pendingSubmit: number;
  completionRate: number;
  status: "danger" | "warning" | "good";
  items: PrintDistribution[];
};

const SUBJECT_OPTIONS = [
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

export default function PrintDistributionPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [rows, setRows] = useState<PrintDistribution[]>([]);

  const [gradeOptions, setGradeOptions] = useState<string[]>([]);
  const [schoolOptions, setSchoolOptions] = useState<string[]>([]);

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("math");
  const [distributedDate, setDistributedDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel>("all");
  const [printKind, setPrintKind] = useState<PrintKind>("required");
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [selectedSchools, setSelectedSchools] = useState<string[]>([]);

  const [filterSubject, setFilterSubject] = useState("");
  const [filterSchoolLevel, setFilterSchoolLevel] = useState<SchoolLevel | "">("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterSchool, setFilterSchool] = useState("");
  const [filterStudentName, setFilterStudentName] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterKind, setFilterKind] = useState<PrintKind | "">("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [viewMode, setViewMode] = useState<ViewMode>("grouped");
  const [openStudentIds, setOpenStudentIds] = useState<string[]>([]);

const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
const [summaryRange, setSummaryRange] = useState<SummaryRange>("7d");

  const loadRows = async () => {
    const q = query(
      collection(db, "printDistributions"),
      orderBy("distributedDate", "desc")
    );
    const snap = await getDocs(q);

    const list = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        ...data,
        kind: data.kind === "optional" ? "optional" : "required",
      };
    }) as PrintDistribution[];

    setRows(list);
  };

  const loadStudents = async () => {
    const snap = await getDocs(collection(db, "students"));
    const list = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as any),
    })) as StudentRow[];

    setStudents(list);

    const activeStudents = list.filter(
      (s) =>
        s.hidden !== true &&
        s.isActive !== false &&
        s.removed !== true
    );

    const gradeSet = new Set<string>();
    const schoolSet = new Set<string>();

    activeStudents.forEach((s) => {
      const grade = String(s.grade || "").trim();
      const school = String(s.school || "").trim();

      if (grade) gradeSet.add(grade);
      if (school) schoolSet.add(school);
    });

    setGradeOptions(
      Array.from(gradeSet).sort((a, b) => a.localeCompare(b, "ko"))
    );
    setSchoolOptions(
      Array.from(schoolSet).sort((a, b) => a.localeCompare(b, "ko"))
    );
  };

  useEffect(() => {
    loadRows();
    loadStudents();
  }, []);

  const getStudentLevel = (grade: string): Exclude<SchoolLevel, "all"> => {
    return String(grade).startsWith("고") ? "high" : "middle";
  };

  const levelLabel = (level: SchoolLevel) => {
    if (level === "middle") return "중등";
    if (level === "high") return "고등";
    return "전체";
  };

  const kindLabel = (kind: PrintKind) => {
    return kind === "required" ? "확인필수" : "참고자료";
  };

  const getSubjectLabel = (key: string) =>
    SUBJECT_OPTIONS.find((s) => s.key === key)?.label || key;

  const toggleItem = (
    value: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const toggleStudent = (id: string) => {
  setSelectedStudentIds((prev) =>
    prev.includes(id)
      ? prev.filter((v) => v !== id)
      : [...prev, id]
  );
};

useEffect(() => {
  setSelectedStudentIds([]);
}, [schoolLevel, selectedGrades, selectedSchools]);

  const getFilteredGradeOptions = () => {
    if (schoolLevel === "middle") {
      return gradeOptions.filter((g) => g.startsWith("중"));
    }
    if (schoolLevel === "high") {
      return gradeOptions.filter((g) => g.startsWith("고"));
    }
    return gradeOptions;
  };

  const getFilteredSchoolOptions = () => {
    if (schoolLevel === "middle") {
      return schoolOptions.filter((s) => s.endsWith("중"));
    }
    if (schoolLevel === "high") {
      return schoolOptions.filter((s) => s.endsWith("고") || s.includes("외고"));
    }
    return schoolOptions;
  };

  const getTodayStr = () => new Date().toISOString().slice(0, 10);

const getDateBeforeStr = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

    const formatShortDate = (date = new Date()) => {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
};

const applyQuickRange = (range: "today" | "3d" | "7d" | "all") => {
  if (range === "today") {
    const today = getTodayStr();
    setFilterDateFrom(today);
    setFilterDateTo(today);
    return;
  }

  if (range === "3d") {
    setFilterDateFrom(getDateBeforeStr(2));
    setFilterDateTo(getTodayStr());
    return;
  }

  if (range === "7d") {
    setFilterDateFrom(getDateBeforeStr(6));
    setFilterDateTo(getTodayStr());
    return;
  }

  setFilterDateFrom("");
  setFilterDateTo("");
};

const handleSave = async () => {
  if (!title.trim()) {
    alert("프린트 이름을 입력하세요.");
    return;
  }

  const filteredStudents = getTargetStudents();

  const targetStudents =
    selectedStudentIds.length > 0
      ? filteredStudents.filter((s) => selectedStudentIds.includes(s.id))
      : filteredStudents;

  if (targetStudents.length === 0) {
    alert("선택 조건에 맞는 학생이 없습니다.");
    return;
  }

  await Promise.all(
    targetStudents.map(async (student) => {
      // 1) printDistributions 원본 저장
      const distRef = await addDoc(collection(db, "printDistributions"), {
        distributedDate,
        subject,
        title: title.trim(),
        studentId: student.id,
        studentName: String(student.name || "").trim(),
        school: String(student.school || "").trim(),
        grade: String(student.grade || "").trim(),
        schoolLevel: getStudentLevel(String(student.grade || "").trim()),
        kind: printKind,
        submittedDate: null,
        submittedAt: null,
        checkedAt: null,
        createdAt: serverTimestamp(),
      });

      // 2) studyPlans/day/common.teacherTasks에 결과물 생성
      const dayRef = doc(db, "studyPlans", student.id, "days", distributedDate);
      const daySnap = await getDoc(dayRef);

      const prevData = daySnap.exists() ? (daySnap.data() as any) : {};
      const prevCommon = prevData.common || {
        teacherTasks: [],
        studentPlans: [],
        memo: "",
        teacherComment: "",
        done: false,
        proofImages: [],
        proofMemo: "",
        wordTest: { correct: 0, total: 0 },
      };

      const prevTeacherTasks = Array.isArray(prevCommon.teacherTasks)
        ? prevCommon.teacherTasks
        : [];

      const newTask = {
        id: crypto.randomUUID(),
        title: title.trim(),
        text: title.trim(),
        done: false,
        deleted: false,

        taskType: "print",
        sourceType: "distribution",
        sourceId: distRef.id,

        subject,
        distributedDate,
        kind: printKind,

        doneByStudent: false,
        submittedAt: null,
        checkedByTeacher: false,
        checkedAt: null,
      };

      await setDoc(
        dayRef,
        {
          date: distributedDate,
          common: {
            ...prevCommon,
            teacherTasks: [...prevTeacherTasks, newTask],
            updatedAt: serverTimestamp(),
          },
        },
        { merge: true }
      );
    })
  );

  alert(`${targetStudents.length}명 배부 기록 저장 완료`);
  setTitle("");
  setSelectedGrades([]);
  setSelectedSchools([]);
  setSelectedStudentIds([]);
  await loadRows();
};

  const getTargetStudents = () => {
    return students.filter((s) => {
      if (
        s.hidden === true ||
        s.isActive === false ||
        s.removed === true
      ) {
        return false;
      }

      const grade = String(s.grade || "").trim();
      const school = String(s.school || "").trim();

      if (!grade || !school) return false;

      if (schoolLevel === "middle" && !grade.startsWith("중")) return false;
      if (schoolLevel === "high" && !grade.startsWith("고")) return false;

      if (selectedGrades.length > 0 && !selectedGrades.includes(grade)) return false;
      if (selectedSchools.length > 0 && !selectedSchools.includes(school)) return false;

      return true;
    });
  };

  const previewStudents = useMemo(() => {
  const filtered = getTargetStudents();

  // 학년/학교 아무것도 안 골랐으면 학생 리스트 숨김
  if (selectedGrades.length === 0 && selectedSchools.length === 0) {
    return [];
  }

  return filtered;
}, [students, schoolLevel, selectedGrades, selectedSchools]);

  const activeStudentIds = new Set(
    students
      .filter(
        (s) =>
          s.hidden !== true &&
          s.isActive !== false &&
          s.removed !== true
      )
      .map((s) => s.id)
  );

  const summaryRows = useMemo(() => {
  let from = "";
  let to = getTodayStr();

  if (summaryRange === "today") from = getTodayStr();
  if (summaryRange === "7d") from = getDateBeforeStr(6);
  if (summaryRange === "30d") from = getDateBeforeStr(29);
  if (summaryRange === "all") {
  from = "";
  to = "";
}

  return rows.filter((row) => {
    if (!activeStudentIds.has(row.studentId)) return false;
    if (from && row.distributedDate < from) return false;
    if (to && row.distributedDate > to) return false;
    return true;
  });
}, [rows, activeStudentIds, summaryRange]);



  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!activeStudentIds.has(row.studentId)) return false;

      if (filterSubject && row.subject !== filterSubject) return false;
      if (filterSchoolLevel && row.schoolLevel !== filterSchoolLevel) return false;
      if (filterGrade && row.grade !== filterGrade) return false;
      if (filterSchool && row.school !== filterSchool) return false;
      if (filterKind && row.kind !== filterKind) return false;

      if (
        filterStudentName &&
        !String(row.studentName || "")
          .toLowerCase()
          .includes(filterStudentName.toLowerCase())
      ) {
        return false;
      }

      if (filterDateFrom && row.distributedDate < filterDateFrom) return false;
      if (filterDateTo && row.distributedDate > filterDateTo) return false;

      if (statusFilter === "pending") {
        return row.kind === "required" && !row.submittedDate;
      }

      if (statusFilter === "optionalOnly") {
        return row.kind === "optional";
      }

      if (statusFilter === "completed") {
        return row.kind === "required" && !!row.submittedDate;
      }

      return true;
    });
  }, [
    rows,
    students,
    filterSubject,
    filterSchoolLevel,
    filterGrade,
    filterSchool,
    filterStudentName,
    filterDateFrom,
    filterDateTo,
    filterKind,
    statusFilter,
  ]);





const toggleSubmitDate = async (row: PrintDistribution) => {
  const nextValue = row.submittedDate ? "" : formatShortDate();

  try {
    await updateDoc(doc(db, "printDistributions", row.id), {
      submittedDate: nextValue,
    });

    setRows((prev) =>
      prev.map((item) =>
        item.id === row.id ? { ...item, submittedDate: nextValue } : item
      )
    );
  } catch (e) {
    console.error("제출 처리 실패", e);
    alert("제출 상태 저장 중 오류가 발생했습니다.");
  }
};

  const groupedRows = useMemo(() => {
    const map: Record<string, GroupedStudentRows> = {};

    filteredRows.forEach((row) => {
      if (!map[row.studentId]) {
        map[row.studentId] = {
          studentId: row.studentId,
          studentName: row.studentName || "",
          school: row.school || "",
          grade: row.grade || "",
          total: 0,
          requiredCount: 0,
          optionalCount: 0,
          pendingSubmit: 0,
          completionRate: 0,
          status: "good",
          items: [],
        };
      }

      map[row.studentId].items.push(row);
    });



    const result = Object.values(map).map((group) => {
      const sortedItems = [...group.items].sort((a, b) =>
        a.distributedDate.localeCompare(b.distributedDate)
      );

      const requiredItems = sortedItems.filter((x) => x.kind === "required");
      const optionalItems = sortedItems.filter((x) => x.kind === "optional");
      const pendingSubmit = requiredItems.filter((x) => !x.submittedDate).length;
      const completedCount = requiredItems.filter((x) => !!x.submittedDate).length;

      const completionRate =
        requiredItems.length === 0
          ? 100
          : Math.round((completedCount / requiredItems.length) * 100);

      let status: "danger" | "warning" | "good" = "good";
      if (pendingSubmit >= 3) status = "danger";
      else if (pendingSubmit >= 1) status = "warning";

      return {
        ...group,
        items: sortedItems,
        total: sortedItems.length,
        requiredCount: requiredItems.length,
        optionalCount: optionalItems.length,
        pendingSubmit,
        completionRate,
        status,
      };
    });

   return result.sort((a, b) => {
    const aIsMiddle = a.grade.startsWith("중") ? 0 : 1;
    const bIsMiddle = b.grade.startsWith("중") ? 0 : 1;

    if (aIsMiddle !== bIsMiddle) return aIsMiddle - bIsMiddle;
    if (b.pendingSubmit !== a.pendingSubmit) return b.pendingSubmit - a.pendingSubmit;

    const rank = { danger: 0, warning: 1, good: 2 };
    if (rank[a.status] !== rank[b.status]) {
      return rank[a.status] - rank[b.status];
    }

    return a.studentName.localeCompare(b.studentName, "ko");
  });
}, [filteredRows]);

  useEffect(() => {
    if (filterStudentName.trim() && groupedRows.length === 1) {
      setOpenStudentIds([groupedRows[0].studentId]);
    }
  }, [filterStudentName, groupedRows]);

  const toggleStudentOpen = (studentId: string) => {
    setOpenStudentIds((prev) =>
      prev.includes(studentId)
        ? prev.filter((id) => id !== studentId)
        : [...prev, studentId]
    );
  };

  const goPrint = () => {
    const qs = new URLSearchParams({
      subject: filterSubject,
      schoolLevel: filterSchoolLevel,
      grade: filterGrade,
      school: filterSchool,
      studentName: filterStudentName,
      from: filterDateFrom,
      to: filterDateTo,
      viewMode,
      kind: filterKind,
      status: statusFilter,
    }).toString();

    window.open(`/print-distribution-print?${qs}`, "_blank");
  };

  const getRowCellStyle = (idx: number): React.CSSProperties => ({
    ...mTd,
    background: idx % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
  });

  const targetCount = getTargetStudents().length;

  
  const deleteRow = async (rowId: string) => {
    const ok = window.confirm("이 배부 기록을 삭제할까요?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "printDistributions", rowId));
      setRows((prev) => prev.filter((row) => row.id !== rowId));
    } catch (e) {
      console.error("삭제 실패", e);
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  const statusSummary = useMemo(() => {
  const requiredRows = summaryRows.filter((r) => r.kind === "required");
  const pendingRows = requiredRows.filter((r) => !r.submittedDate);
  const optionalRows = summaryRows.filter((r) => r.kind === "optional");

  return {
    total: summaryRows.length,
    required: requiredRows.length,
    pending: pendingRows.length,
    optional: optionalRows.length,
  };
}, [summaryRows]);
  
 const requiredSummary = useMemo(() => {
  return {
    middle: summaryRows.filter(
      (r) => r.kind === "required" && r.schoolLevel === "middle"
    ).length,
    high: summaryRows.filter(
      (r) => r.kind === "required" && r.schoolLevel === "high"
    ).length,
  };
}, [summaryRows]);

const pendingSummary = useMemo(() => {
  return {
    middle: summaryRows.filter(
      (r) => r.kind === "required" && !r.submittedDate && r.schoolLevel === "middle"
    ).length,
    high: summaryRows.filter(
      (r) => r.kind === "required" && !r.submittedDate && r.schoolLevel === "high"
    ).length,
  };
}, [summaryRows]);

const optionalSummary = useMemo(() => {
  return {
    middle: summaryRows.filter(
      (r) => r.kind === "optional" && r.schoolLevel === "middle"
    ).length,
    high: summaryRows.filter(
      (r) => r.kind === "optional" && r.schoolLevel === "high"
    ).length,
  };
}, [summaryRows]);

  

const schoolLevelSummary = useMemo(() => {
  const middleRows = summaryRows.filter((r) => r.schoolLevel === "middle");
  const highRows = summaryRows.filter((r) => r.schoolLevel === "high");

  return {
    middle: middleRows.length,
    high: highRows.length,
  };
}, [summaryRows]);

  const riskBadgeStyle = (status: GroupedStudentRows["status"]): React.CSSProperties => {
    if (status === "danger") return dangerPill;
    if (status === "warning") return warningPill;
    return goodPill;
  };

  const riskLabel = (status: GroupedStudentRows["status"]) => {
    if (status === "danger") return "위험";
    if (status === "warning") return "주의";
    return "정상";
  };

  return (
    <div style={pageBg}>
      <div style={container}>
        <div style={headerSection}>
          <h2 style={mainTitle}>
            PRINTS <span style={{ color: "#2C4C9D" }}>DISTRIBUTION</span>
          </h2>
          <p style={subTitle}>학생별 프린트 배부 및 제출 관리표</p>
        </div>

        <div style={card}>
          <div style={sectionLabel}>배부 등록</div>

          <div style={singleRow}>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={modernSelect}
            >
              {SUBJECT_OPTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="프린트 이름"
              style={modernInput}
            />

            <input
              type="date"
              value={distributedDate}
              onChange={(e) => setDistributedDate(e.target.value)}
              style={modernInput}
            />

            <select
              value={schoolLevel}
              onChange={(e) => {
                const next = e.target.value as SchoolLevel;
                setSchoolLevel(next);
                setSelectedGrades([]);
                setSelectedSchools([]);
              }}
              style={modernSelect}
            >
              <option value="all">전체</option>
              <option value="middle">중등</option>
              <option value="high">고등</option>
            </select>

            <select
              value={printKind}
              onChange={(e) => setPrintKind(e.target.value as PrintKind)}
              style={modernSelect}
            >
              <option value="required">확인필수</option>
              <option value="optional">참고자료</option>
            </select>

           <button
  onClick={handleSave}
  disabled={targetCount === 0}
  style={{
    ...saveButton,
    opacity: targetCount === 0 ? 0.5 : 1,
    cursor: targetCount === 0 ? "not-allowed" : "pointer",
  }}
>
  {selectedStudentIds.length > 0 ? "선택 학생 배부" : "조건 전체 배부"}
</button>
          </div>

          <div style={selectionRow}>
            <div style={selectionBox}>
              <div style={selectionTitle}>학년 선택</div>
              <div style={chipContainer}>
                {getFilteredGradeOptions().map((grade) => (
                  <button
                    key={grade}
                    onClick={() => toggleItem(grade, setSelectedGrades)}
                    style={{
                      ...chip,
                      ...(selectedGrades.includes(grade) ? activeChip : {}),
                    }}
                  >
                    {grade}
                  </button>
                ))}
              </div>
            </div>

            <div style={selectionBox}>
              <div style={selectionTitle}>학교 선택</div>
              <div style={chipContainer}>
                {getFilteredSchoolOptions().map((school) => (
                  <button
                    key={school}
                    onClick={() => toggleItem(school, setSelectedSchools)}
                    style={{
                      ...chip,
                      ...(selectedSchools.includes(school) ? activeChip : {}),
                    }}
                  >
                    {school}
                  </button>
                ))}
              </div>
            </div>
<div
  style={{
    ...selectionBox,
    marginTop: 14,
    gridColumn: "1 / -1",
    maxHeight: 220,
  }}
>
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    }}
  >
    <div style={selectionTitle}>학생 선택</div>
    <div style={{ fontSize: 12, color: "#64748B", fontWeight: 700 }}>
      선택 {selectedStudentIds.length}명 / 총 {previewStudents.length}명
    </div>
  </div>

  {selectedGrades.length === 0 && selectedSchools.length === 0 ? (
    <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>
      학년 또는 학교를 먼저 선택하세요
    </div>
  ) : previewStudents.length === 0 ? (
    <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>
      조건에 맞는 학생이 없습니다
    </div>
  ) : (
    <div style={chipContainer}>
      {previewStudents.map((student) => (
        <button
          key={student.id}
          onClick={() => toggleStudent(student.id)}
          style={{
            ...chip,
            ...(selectedStudentIds.includes(student.id) ? activeChip : {}),
          }}
        >
          {student.name}
        </button>
      ))}
    </div>
  )}
</div>

          </div>
        </div>
<div
  style={{
    display: "flex",
    gap: 8,
    alignItems: "center",
    marginBottom: 12,
    flexWrap: "wrap",
  }}
>
  <button
    onClick={() => setSummaryRange("today")}
    style={{
      ...stateBtn,
      ...(summaryRange === "today" ? stateBtnActive : {}),
    }}
  >
    오늘
  </button>

  <button
    onClick={() => setSummaryRange("7d")}
    style={{
      ...stateBtn,
      ...(summaryRange === "7d" ? stateBtnActive : {}),
    }}
  >
    최근 7일
  </button>

  <button
    onClick={() => setSummaryRange("30d")}
    style={{
      ...stateBtn,
      ...(summaryRange === "30d" ? stateBtnActive : {}),
    }}
  >
    최근 30일
  </button>

  <button
    onClick={() => setSummaryRange("all")}
    style={{
      ...stateBtn,
      ...(summaryRange === "all" ? stateBtnActive : {}),
    }}
  >
    전체
  </button>

  <div style={{ fontSize: 12, color: "#64748B", fontWeight: 700, marginLeft: 4 }}>
    상단 통계 기준
  </div>
</div>
        <div style={summaryRow}>
  <div style={summarySplitCard}>
    <div style={summarySplitHalf}>
      <div style={summaryCardLabel}>중등</div>
      <div style={summaryCardValue}>{schoolLevelSummary.middle}</div>
      <div style={summaryCardSub}>현재 필터 기준 건수</div>
    </div>

    <div style={summarySplitDivider} />

    <div style={summarySplitHalf}>
      <div style={summaryCardLabel}>고등</div>
      <div style={summaryCardValue}>{schoolLevelSummary.high}</div>
      <div style={summaryCardSub}>현재 필터 기준 건수</div>
    </div>
  </div>

  <div style={summarySplitCard}>
  <div style={summarySplitHalf}>
    <div style={summaryCardLabel}>중등 필수</div>
    <div style={summaryCardValue}>{requiredSummary.middle}</div>
  </div>

  <div style={summarySplitDivider} />

  <div style={summarySplitHalf}>
    <div style={summaryCardLabel}>고등 필수</div>
    <div style={summaryCardValue}>{requiredSummary.high}</div>
  </div>
</div>

 <div style={summarySplitCard}>
  <div style={summarySplitHalf}>
    <div style={summaryCardLabel}>중등 미제출</div>
    <div style={{ ...summaryCardValue, color: "#BE185D" }}>
      {pendingSummary.middle}
    </div>
  </div>

  <div style={summarySplitDivider} />

  <div style={summarySplitHalf}>
    <div style={summaryCardLabel}>고등 미제출</div>
    <div style={{ ...summaryCardValue, color: "#BE185D" }}>
      {pendingSummary.high}
    </div>
  </div>
</div>

  <div style={summarySplitCard}>
  <div style={summarySplitHalf}>
    <div style={summaryCardLabel}>중등 참고</div>
    <div style={summaryCardValue}>{optionalSummary.middle}</div>
  </div>

  <div style={summarySplitDivider} />

  <div style={summarySplitHalf}>
    <div style={summaryCardLabel}>고등 참고</div>
    <div style={summaryCardValue}>{optionalSummary.high}</div>
  </div>
</div>
   
  </div>
</div>

       <div style={{ ...card, width: 1280, maxWidth: "100%", margin: "0 auto 20px" }}>
  <div style={sectionLabel}>배부 현황표</div>

  <div style={boardInner}>
    <div style={tableHeader}>
   <div
  style={{
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    width: "100%",
  }}
>
        <button
          onClick={() => setStatusFilter("all")}
          style={{
            ...stateBtn,
            ...(statusFilter === "all" ? stateBtnActive : {}),
          }}
        >
          전체
        </button>
         <button
    onClick={() => applyQuickRange("today")}
    style={stateBtn}
  >
    오늘만
  </button>

  <button
    onClick={() => applyQuickRange("3d")}
    style={stateBtn}
  >
    최근 3일
  </button>

  <button
    onClick={() => applyQuickRange("7d")}
    style={stateBtn}
  >
    최근 7일
  </button>

        <button
          onClick={() => setStatusFilter("pending")}
          style={{
            ...stateBtn,
            ...(statusFilter === "pending" ? stateBtnWarning : {}),
          }}
        >
          미제출만
        </button>

        <button
          onClick={() => setStatusFilter("optionalOnly")}
          style={{
            ...stateBtn,
            ...(statusFilter === "optionalOnly" ? stateBtnOptional : {}),
          }}
        >
          참고자료만
        </button>

        <button
          onClick={() => setStatusFilter("completed")}
          style={{
            ...stateBtn,
            ...(statusFilter === "completed" ? stateBtnActive : {}),
          }}
        >
          제출완료
        </button>

        <button
          onClick={() => setViewMode("grouped")}
          style={{
            ...modeBtn,
            ...(viewMode === "grouped" ? modeBtnActive : {}),
          }}
        >
          학생별 보기
        </button>

        <button
          onClick={() => setViewMode("rows")}
          style={{
            ...modeBtn,
            ...(viewMode === "rows" ? modeBtnActive : {}),
          }}
        >
          전체 로그
        </button>

        <button onClick={goPrint} style={printButton}>
          🖨️ 필터 결과 인쇄
        </button>
      </div>
    </div>

    <div style={filterBar}>
      <select
        value={filterSubject}
        onChange={(e) => setFilterSubject(e.target.value)}
        style={filterInput}
      >
        <option value="">전체 과목</option>
        {SUBJECT_OPTIONS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        value={filterSchoolLevel}
        onChange={(e) => setFilterSchoolLevel(e.target.value as SchoolLevel | "")}
        style={filterInput}
      >
        <option value="">전체 구분</option>
        <option value="middle">중등</option>
        <option value="high">고등</option>
      </select>

      <select
        value={filterGrade}
        onChange={(e) => setFilterGrade(e.target.value)}
        style={filterInput}
      >
        <option value="">전체 학년</option>
        {gradeOptions.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>

      <select
        value={filterSchool}
        onChange={(e) => setFilterSchool(e.target.value)}
        style={filterInput}
      >
        <option value="">전체 학교</option>
        {schoolOptions.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={filterKind}
        onChange={(e) => setFilterKind(e.target.value as PrintKind | "")}
        style={filterInput}
      >
        <option value="">전체 자료구분</option>
        <option value="required">확인필수</option>
        <option value="optional">참고자료</option>
      </select>

      <input
        value={filterStudentName}
        onChange={(e) => setFilterStudentName(e.target.value)}
        placeholder="학생명 검색"
        style={filterInput}
      />

      <input
        type="date"
        value={filterDateFrom}
        onChange={(e) => setFilterDateFrom(e.target.value)}
        style={filterInput}
      />

      <input
        type="date"
        value={filterDateTo}
        onChange={(e) => setFilterDateTo(e.target.value)}
        style={filterInput}
      />
    </div>

    {viewMode === "grouped" ? (
      <div style={{ display: "grid", gap: 12 }}>
        {groupedRows.length === 0 ? (
          <div style={emptyTextBox}>배부 데이터가 없습니다.</div>
        ) : (
          groupedRows.map((group) => {
            const isOpen = openStudentIds.includes(group.studentId);

            return (
              <div key={group.studentId} style={groupCard}>
                <button
                  onClick={() => toggleStudentOpen(group.studentId)}
                  style={groupHeaderBtn}
                >
                  <div style={{ textAlign: "left", minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={riskBadgeStyle(group.status)}>{riskLabel(group.status)}</span>

                      <span style={{ fontSize: 16, fontWeight: 900, color: "#0F172A" }}>
                        {group.studentName}
                      </span>

                      <span style={{ color: "#64748B", fontWeight: 700, fontSize: 13 }}>
                        {group.grade} | {group.school}
                      </span>

                      <span style={groupMetaText}>
                        {group.pendingSubmit > 0
                          ? `확인필수 ${group.requiredCount}개 중 미제출 ${group.pendingSubmit}개`
                          : `확인필수 ${group.requiredCount}개 모두 제출 완료`}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                    }}
                  >
                    <span style={summaryPill}>{`배포 ${group.total}`}</span>
                    <span style={{ ...summaryPill, background: "#DBEAFE", color: "#1D4ED8" }}>
                      {`필수 ${group.requiredCount}`}
                    </span>
                    <span style={{ ...summaryPill, background: "#F1F5F9", color: "#475569" }}>
                      {`참고 ${group.optionalCount}`}
                    </span>
                    <span
                      style={{
                        ...summaryPill,
                        background: "#FDF2F8",
                        color: "#BE185D",
                      }}
                    >
                      {`미제출 ${group.pendingSubmit}`}
                    </span>
                    <span style={completionPill}>{`완료율 ${group.completionRate}%`}</span>
                    <span style={{ fontSize: 18, fontWeight: 900, color: "#334155" }}>
                      {isOpen ? "−" : "+"}
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div style={{ marginTop: 10 }}>
                    <table style={table}>
                      <thead>
                        <tr>
                          <th style={{ ...mTh, width: 90 }}>배부일</th>
                          <th style={{ ...mTh, width: 110 }}>구분</th>
                          <th style={{ ...mTh, width: 80 }}>과목</th>
                          <th style={mTh}>프린트명</th>
                          <th style={{ ...mTh, width: 110 }}>제출일</th>
                          <th style={{ ...mTh, width: 70 }}>삭제</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((row, idx) => (
                          <tr key={row.id}>
                            <td style={getRowCellStyle(idx)}>{row.distributedDate}</td>
                            <td style={getRowCellStyle(idx)}>
                              <span style={row.kind === "required" ? requiredBadge : optionalBadge}>
                                {kindLabel(row.kind)}
                              </span>
                            </td>
                            <td style={getRowCellStyle(idx)}>{getSubjectLabel(row.subject)}</td>
                            <td
                              style={{
                                ...getRowCellStyle(idx),
                                textAlign: "left",
                                fontWeight: 700,
                                paddingLeft: 14,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {row.title}
                            </td>
                            <td
                              style={{
                                ...mTd,
                                background: idx % 2 === 0 ? "#F8FAFC" : "#F1F5F9",
                                textAlign: "center",
                              }}
                            >
                              {row.kind === "required" ? (
                                row.submittedDate ? (
                                  <div style={submitWrap}>
                                    <span style={submittedText}>{row.submittedDate}</span>
                                    <button onClick={() => toggleSubmitDate(row)} style={cancelBtn}>
                                      취소
                                    </button>
                                  </div>
                                ) : (
                                  <button onClick={() => toggleSubmitDate(row)} style={submitBtn}>
                                    확인
                                  </button>
                                )
                              ) : (
                                <span style={optionalText}>해당없음</span>
                              )}
                            </td>
                            <td style={getRowCellStyle(idx)}>
                              <button onClick={() => deleteRow(row.id)} style={deleteBtn}>
                                삭제
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    ) : (
      <table style={table}>
        <thead>
          <tr>
            <th style={{ ...mTh, width: 100 }}>배부일</th>
            <th style={{ ...mTh, width: 70 }}>학생명</th>
            <th style={{ ...mTh, width: 90 }}>학교</th>
            <th style={{ ...mTh, width: 60 }}>학년</th>
            <th style={{ ...mTh, width: 70 }}>구분</th>
            <th style={{ ...mTh, width: 90 }}>자료구분</th>
            <th style={{ ...mTh, width: 70 }}>과목</th>
            <th style={mTh}>프린트명</th>
            <th style={{ ...mTh, width: 90 }}>제출일</th>
            <th style={{ ...mTh, width: 80 }}>삭제</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 ? (
            <tr>
              <td colSpan={10} style={emptyText}>
                배부 데이터가 없습니다.
              </td>
            </tr>
          ) : (
            filteredRows.map((row, idx) => (
              <tr key={row.id}>
                <td style={getRowCellStyle(idx)}>{row.distributedDate}</td>
                <td style={{ ...getRowCellStyle(idx), fontWeight: 800 }}>
                  {row.studentName || "-"}
                </td>
                <td style={getRowCellStyle(idx)}>{row.school || "-"}</td>
                <td style={getRowCellStyle(idx)}>{row.grade || "-"}</td>
                <td style={getRowCellStyle(idx)}>
                  <span style={badge}>{levelLabel(row.schoolLevel)}</span>
                </td>
                <td style={getRowCellStyle(idx)}>
                  <span style={row.kind === "required" ? requiredBadge : optionalBadge}>
                    {kindLabel(row.kind)}
                  </span>
                </td>
                <td style={getRowCellStyle(idx)}>{getSubjectLabel(row.subject)}</td>
                <td
                  style={{
                    ...getRowCellStyle(idx),
                    textAlign: "left",
                    fontWeight: 700,
                    paddingLeft: 14,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {row.title}
                </td>
                <td
                  style={{
                    ...mTd,
                    background: idx % 2 === 0 ? "#F8FAFC" : "#F1F5F9",
                    textAlign: "center",
                  }}
                >
                  {row.kind === "required" ? (
                    row.submittedDate ? (
                      <div style={submitWrap}>
                        <span style={submittedText}>{row.submittedDate}</span>
                        <button onClick={() => toggleSubmitDate(row)} style={cancelBtn}>
                          취소
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => toggleSubmitDate(row)} style={submitBtn}>
                        제출
                      </button>
                    )
                  ) : (
                    <span style={optionalText}>해당없음</span>
                  )}
                </td>
                <td style={getRowCellStyle(idx)}>
                  <button onClick={() => deleteRow(row.id)} style={deleteBtn}>
                    삭제
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    )}
  </div>
</div>
   
      </div>
   
  );
}

const pageBg: React.CSSProperties = {
  background: "#F1F5F9", 
  minHeight: "100vh",
  padding: "28px 0 40px",
};

const container: React.CSSProperties = {
  maxWidth: 1320,
  margin: "0 auto",
  padding: "0 20px",
  fontFamily: "'Pretendard', 'Noto Sans KR', system-ui, sans-serif",
  color: "#1E293B",
};

const headerSection: React.CSSProperties = {
  marginBottom: 24,
  borderLeft: "5px solid #1E40AF", 
  paddingLeft: 18,
};

const mainTitle: React.CSSProperties = {
  fontSize: 30,
  fontWeight: 900,
  margin: 0,
  letterSpacing: "-0.6px",
  color: "#0F172A",
};

const subTitle: React.CSSProperties = {
  fontSize: 14,
  color: "#64748B",
  marginTop: 6,
  marginBottom: 0,
};

const card: React.CSSProperties = {
  background: "#FFFFFF",
  borderRadius: 20, 
  padding: 24,
  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
  border: "1px solid #E2E8F0",
  marginBottom: 20,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 900,
  color: "#1E40AF",
  letterSpacing: "0.8px",
  marginBottom: 16,
};

const singleRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "110px 1fr 130px 110px 130px 140px",
  gap: 10,
  alignItems: "center",
  marginBottom: 14,
};

const modernInput: React.CSSProperties = {
  height: 44,
  borderRadius: 10, 
  border: "1px solid #CBD5E1",
  padding: "0 12px",
  fontSize: 14,
  background: "#FFFFFF",
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
  color: "#0F172A",
};

const modernSelect: React.CSSProperties = {
  height: 44,
  borderRadius: 10, 
  border: "1px solid #CBD5E1",
  padding: "0 10px",
  fontSize: 14,
  background: "#FFFFFF",
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
  color: "#0F172A",
  cursor: "pointer",
};

const saveButton: React.CSSProperties = {
  height: 44,
  borderRadius: 10, 
  border: "none",
  background: "#1E40AF",
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 800,
};

const selectionRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 14,
};

const selectionBox: React.CSSProperties = {
  background: "#F8FAFC",
  borderRadius: 14, 
  padding: 14,
  border: "1px solid #E2E8F0",
  maxHeight: 155,
  overflowY: "auto",
};

const selectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#475569",
  marginBottom: 10,
};

const chipContainer: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const chip: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8, 
  border: "1px solid #CBD5E1",
  background: "#FFFFFF",
  fontSize: 13,
  fontWeight: 700,
  color: "#475569",
  cursor: "pointer",
};

const activeChip: React.CSSProperties = {
  background: "#1E40AF",
  color: "#FFFFFF",
  border: "1px solid #1E40AF",
};

const tableHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between", // 🔥 핵심
  alignItems: "center",
  marginBottom: 14,
};

const modeBtn: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  borderRadius: 8, 
  border: "1px solid #CBD5E1",
  background: "#FFFFFF",
  color: "#334155",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const modeBtnActive: React.CSSProperties = {
  background: "#0F172A",
  border: "1px solid #0F172A",
  color: "#FFFFFF",
};

const stateBtn: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid #CBD5E1",
  background: "#FFFFFF",
  color: "#334155",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const stateBtnActive: React.CSSProperties = {
  background: "#EFF6FF",
  border: "1px solid #3B82F6",
  color: "#1E40AF",
};

const stateBtnWarning: React.CSSProperties = {
  background: "#FFFBEB",
  border: "1px solid #F59E0B",
  color: "#92400E",
};

const stateBtnOptional: React.CSSProperties = {
  background: "#F1F5F9",
  border: "1px solid #CBD5E1",
  color: "#475569",
};

const printButton: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  background: "#0F172A",
  color: "#FFFFFF",
  fontWeight: 800,
  border: "none",
  cursor: "pointer",
  fontSize: 13,
};

const filterBar: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr",
  gap: 10,
  marginBottom: 16,
};

const filterInput: React.CSSProperties = {
  height: 40,
  borderRadius: 8, 
  border: "1px solid #CBD5E1",
  padding: "0 10px",
  fontSize: 12,
  outline: "none",
  background: "#FFFFFF",
  color: "#0F172A",
  boxSizing: "border-box",
};

const table: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  tableLayout: "fixed",
  borderCollapse: "collapse",
  border: "1px solid #CBD5E1",
  background: "#FFFFFF",
  boxSizing: "border-box",
};

const mTh: React.CSSProperties = {
  padding: "12px 10px",
  fontSize: 12,
  color: "#FFFFFF",
  fontWeight: 800,
  textAlign: "center",
  background: "#475569", 
  border: "1px solid #334155",
};

// --- 이 부분의 배경색을 원장님 요청대로 더 확실히 구분되게 조정했습니다 ---
const mTd: React.CSSProperties = {
  padding: "12px 10px",
  fontSize: 13,
  textAlign: "center",
  background: "#FFFFFF", // 기본 흰색
  border: "1px solid #E2E8F0",
  verticalAlign: "middle",
  color: "#0F172A",
};


const badge: React.CSSProperties = {
  padding: "3px 6px",
  borderRadius: 6,
  background: "#E2E8F0",
  fontSize: 11,
  fontWeight: 800,
  color: "#334155",
};

const requiredBadge: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  background: "#DBEAFE",
  border: "1px solid #93C5FD",
  fontSize: 11,
  fontWeight: 800,
  color: "#1E40AF",
};

const optionalBadge: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  background: "#F1F5F9",
  border: "1px solid #CBD5E1",
  fontSize: 11,
  fontWeight: 800,
  color: "#475569",
};

const optionalText: React.CSSProperties = {
  fontSize: 12,
  color: "#94A3B8",
  fontWeight: 700,
};


const deleteBtn: React.CSSProperties = {
  height: 30,
  minWidth: 52,
  borderRadius: 6,
  border: "1px solid #FCA5A5",
  background: "#FEF2F2",
  color: "#B91C1C",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const emptyText: React.CSSProperties = {
  textAlign: "center",
  padding: 36,
  color: "#64748B",
  fontSize: 14,
  border: "1px solid #E2E8F0",
  background: "#FFFFFF",
};

const emptyTextBox: React.CSSProperties = {
  textAlign: "center",
  padding: 36,
  color: "#64748B",
  fontSize: 14,
  border: "1px solid #E2E8F0",
  background: "#FFFFFF",
  borderRadius: 12,
};

const groupCard: React.CSSProperties = {
  border: "1px solid #CBD5E1",
  borderRadius: 14,
  background: "#FFFFFF",
  padding: 12,
};

const groupHeaderBtn: React.CSSProperties = {
  width: "100%",
  border: "none",
  background: "transparent",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 12,
};

const summaryPill: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  background: "#E2E8F0",
  color: "#334155",
  fontSize: 12,
  fontWeight: 800,
};

const summaryRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 12,
  marginBottom: 20,
};

const summaryCard: React.CSSProperties = {
  background: "#FFFFFF",
  borderRadius: 16,
  border: "1px solid #E2E8F0",
  padding: 16,
};

const summaryCardWarning: React.CSSProperties = {
  background: "#FDF2F8",
  borderRadius: 16,
  border: "1px solid #f5dae9",
  padding: 16,
};

const summaryCardLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#64748B",
  marginBottom: 6,
};

const summaryCardValue: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 900,
  color: "#0F172A",
  lineHeight: 1,
  marginBottom: 6,
};

const summaryCardSub: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#94A3B8",
};

const dangerPill: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  background: "#FEE2E2",
  color: "#B91C1C",
  border: "1px solid #FCA5A5",
  fontSize: 12,
  fontWeight: 900,
};

const warningPill: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  background: "#FEF3C7",
  color: "#92400E",
  border: "1px solid #FCD34D",
  fontSize: 12,
  fontWeight: 900,
};

const goodPill: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  background: "#E8F5E9", 
  color: "#2E7D32", // 촌스럽지 않은 짙은 녹색
  border: "1px solid #C8E6C9",
  fontSize: 12,
  fontWeight: 900,
};

const completionPill: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  background: "#F1F5F9",
  color: "#334155",
  fontSize: 12,
  fontWeight: 800,
};

const submitWrap: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 6,
};

const submittedText: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#166534",
};

const submitBtn: React.CSSProperties = {
  height: 30,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid #CBD5E1",
  background: "#F8FAFC",
  color: "#334155",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const cancelBtn: React.CSSProperties = {
  height: 26,
  padding: "0 8px",
  borderRadius: 8,
  border: "1px solid #E2E8F0",
  background: "#FFFFFF",
  color: "#94A3B8",
  fontSize: 11,
  fontWeight: 800,
  cursor: "pointer",
};

const summarySplitCard: React.CSSProperties = {
  background: "#FFFFFF",
  borderRadius: 16,
  border: "1px solid #E2E8F0",
  padding: 16,
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  gap: 12,
};

const summarySplitHalf: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
};

const summarySplitDivider: React.CSSProperties = {
  width: 1,
  height: "70%",
  background: "#E2E8F0",
};

const groupMetaText: React.CSSProperties = {
  fontSize: 12,
  color: "#64748B",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const boardInner: React.CSSProperties = {
  width: 1320,
  maxWidth: "100%",
  margin: "0 auto",
};