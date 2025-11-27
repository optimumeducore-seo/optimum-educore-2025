// src/pages/ExamManagePage.tsx
import React, { useEffect, useState } from "react";
import { collection, doc, getDocs, setDoc, query, where, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

// 학생 타입 (느슨하게 any로 써도 되지만, 기본 구조만 정의)
type Student = {
  id: string;
  name: string;
  school?: string;
  grade?: string;
};

type ExamSubject = {
  key: string;        // "math"
  name: string;       // "수학"
  range: string;      // "1단원~3단원, p.10~35"
};

type Exam = {
  id: string;
  school: string;
  grade: string;
  title: string;
  start: string;   // "YYYY-MM-DD"
  end: string;     // "YYYY-MM-DD"
  memo?: string;
  subjects: ExamSubject[];
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

export default function ExamManagePage() {
  // 전체 학생
  const [students, setStudents] = useState<Student[]>([]);

  // 학교/학년 리스트 & 선택값
  const [schools, setSchools] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>("");
  const [selectedGrade, setSelectedGrade] = useState<string>("");

  // 선택된 조건(학교+학년)의 시험 목록
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);

  // 폼 상태
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [memo, setMemo] = useState("");
  const [subjectRanges, setSubjectRanges] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);

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
          start: data.start,
          end: data.end,
          memo: data.memo || "",
          subjects: data.subjects || [],
        };
      });

      setExams(list);
      setSelectedExamId(null);
      resetForm();
    };

    loadExams();
  }, [selectedSchool, selectedGrade]);

  /* ------------------------------------------------------------------ */
  /* 🔹 4. 폼 리셋 */
  /* ------------------------------------------------------------------ */

  const resetForm = () => {
    setTitle("");
    setStart("");
    setEnd("");
    setMemo("");
    setSubjectRanges({});
  };

  /* ------------------------------------------------------------------ */
  /* 🔹 5. 시험 클릭 시 폼에 로드 */
  /* ------------------------------------------------------------------ */

  const handleSelectExam = (exam: Exam) => {
    setSelectedExamId(exam.id);
    setTitle(exam.title || "");
    setStart(exam.start || "");
    setEnd(exam.end || "");
    setMemo(exam.memo || "");

    const ranges: Record<string, string> = {};
    (exam.subjects || []).forEach((sub) => {
      ranges[sub.key] = sub.range;
    });
    setSubjectRanges(ranges);
  };

  /* ------------------------------------------------------------------ */
  /* 🔹 6. 폼에서 과목 범위 입력 처리 */
  /* ------------------------------------------------------------------ */

  const handleChangeRange = (key: string, value: string) => {
    setSubjectRanges((prev) => ({
      ...prev,
      [key]: value,
    }));
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
    if (!start || !end) {
      alert("시험 시작일과 종료일을 모두 입력하세요.");
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

      // 2) subjects 배열 만들기 (범위가 있는 과목만)
      const subjects: ExamSubject[] = SUBJECTS.map((s) => {
        const range = (subjectRanges[s.key] || "").trim();
        if (!range) return null;
        return {
          key: s.key,
          name: s.label,
          range,
        };
      }).filter(Boolean) as ExamSubject[];

      const examData = {
        school: selectedSchool,
        grade: selectedGrade,
        title: title.trim(),
        start,
        end,
        memo: memo.trim(),
        subjects,
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
      for (const st of targetStudents) {
        const ref = doc(collection(db, "studentExams", st.id, "exams"), examId!);
        await setDoc(
          ref,
          {
            examId,
            studentId: st.id,
            studentName: st.name,
            school: selectedSchool,
            grade: selectedGrade,
            title: title.trim(),
            start,
            end,
            memo: memo.trim(),
            subjects,
            appliedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 6) 로컬 state 갱신
      const newExam: Exam = {
        id: examId!,
        school: selectedSchool,
        grade: selectedGrade,
        title: title.trim(),
        start,
        end,
        memo: memo.trim(),
        subjects,
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

  /* ------------------------------------------------------------------ */
  /* 🔹 UI 렌더링 */
  /* ------------------------------------------------------------------ */

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "32px auto",
        padding: "24px 24px 32px",
        background: "#FFFFFF",
        borderRadius: 18,
        boxShadow: "0 8px 22px rgba(15,23,42,0.15)",
        fontFamily: "Pretendard, system-ui",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          marginBottom: 20,
          padding: "14px 18px",
          borderRadius: 14,
          background:
            "linear-gradient(135deg, rgba(219,234,254,0.9), rgba(239,246,255,0.95))",
          border: "1px solid #BFDBFE",
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 900,
            color: "#1E3A8A",
            marginBottom: 4,
          }}
        >
          OPTIMUM EDUCORE · 시험 관리 시스템
        </div>
        <div style={{ fontSize: 13, color: "#4B5563" }}>
          학교·학년별 시험 일정을 한 번만 입력하면, 해당 학생들의 플래너에 자동 반영됩니다.
        </div>
      </div>

      {/* 상단: 학교/학년 선택 */}
      <div
        style={{
          marginBottom: 18,
          padding: "10px 14px",
          borderRadius: 12,
          border: "1px solid #E5E7EB",
          background: "#F9FAFB",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
          대상 선택
        </div>

        <select
          value={selectedSchool}
          onChange={(e) => setSelectedSchool(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #D1D5DB",
            fontSize: 13,
            background: "#FFFFFF",
          }}
        >
          <option value="">학교 선택</option>
          {schools.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={selectedGrade}
          onChange={(e) => setSelectedGrade(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #D1D5DB",
            fontSize: 13,
            background: "#FFFFFF",
          }}
        >
          <option value="">학년 선택</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>

        <div style={{ fontSize: 12, color: "#6B7280" }}>
          학생 수:{" "}
          <b>
            {
              students.filter(
                (s) => s.school === selectedSchool && s.grade === selectedGrade
              ).length
            }
            명
          </b>
        </div>
      </div>

      {/* 메인 레이아웃: 좌측 시험 목록 / 우측 폼 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.9fr 1.6fr",
          gap: 18,
        }}
      >
        {/* 왼쪽: 시험 목록 */}
        <div
          style={{
            padding: 14,
            borderRadius: 14,
            border: "1px solid #E5E7EB",
            background: "#F9FAFB",
            minHeight: 260,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#1E3A8A",
              marginBottom: 10,
            }}
          >
            📘 등록된 시험
          </div>

          <button
            onClick={() => {
              setSelectedExamId(null);
              resetForm();
            }}
            style={{
              width: "100%",
              padding: "7px 10px",
              marginBottom: 10,
              borderRadius: 8,
              border: "1px dashed #93C5FD",
              background: "#EFF6FF",
              fontSize: 12,
              fontWeight: 700,
              color: "#1D4ED8",
              cursor: "pointer",
            }}
          >
            + 새 시험 추가
          </button>

          {(!selectedSchool || !selectedGrade) && (
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                color: "#9CA3AF",
              }}
            >
              학교와 학년을 먼저 선택하세요.
            </div>
          )}

          {selectedSchool && selectedGrade && exams.length === 0 && (
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                color: "#9CA3AF",
              }}
            >
              아직 등록된 시험이 없습니다.
            </div>
          )}

          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
            {exams.map((ex) => (
              <button
                key={ex.id}
                onClick={() => handleSelectExam(ex)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border:
                    selectedExamId === ex.id
                      ? "1px solid #1D4ED8"
                      : "1px solid #E5E7EB",
                  background:
                    selectedExamId === ex.id ? "#DBEAFE" : "#FFFFFF",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: "#111827",
                    marginBottom: 2,
                  }}
                >
                  {ex.title}
                </div>
                <div style={{ color: "#6B7280", fontSize: 11 }}>
                  {ex.start} ~ {ex.end}
                </div>
                <div style={{ color: "#94A3B8", fontSize: 11 }}>
                  과목 {ex.subjects?.length || 0}개
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 오른쪽: 시험 상세 폼 */}
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            border: "1px solid #E5E7EB",
            background: "#FFFFFF",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#1E3A8A",
              marginBottom: 10,
            }}
          >
            📝 시험 정보 입력
          </div>

          {/* 제목 + 기간 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 0.8fr 0.8fr",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <input
              type="text"
              placeholder="시험명 (예: 1학기 중간고사)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #D1D5DB",
                fontSize: 13,
              }}
            />
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #D1D5DB",
                fontSize: 13,
              }}
            />
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #D1D5DB",
                fontSize: 13,
              }}
            />
          </div>

          {/* 메모 */}
          <textarea
            placeholder="비고 / 메모 (예: 범위 조정 예정, 수행평가 포함 등)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #E5E7EB",
              fontSize: 12,
              background: "#F9FAFB",
              marginBottom: 12,
              resize: "vertical",
            }}
          />

          {/* 과목별 범위 입력 */}
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#374151",
              marginBottom: 6,
            }}
          >
            📚 과목별 시험 범위
          </div>

          <div
            style={{
              maxHeight: 280,
              overflowY: "auto",
              borderRadius: 10,
              border: "1px solid #E5E7EB",
              padding: 8,
            }}
          >
            {SUBJECTS.map((s) => (
              <div
                key={s.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "0.4fr 1.6fr",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#1F2937",
                    paddingLeft: 4,
                  }}
                >
                  {s.label}
                </div>
                <input
                  type="text"
                  placeholder="예) 1~3단원, 문제집 p.45~70, 서술형 프린트 포함"
                  value={subjectRanges[s.key] || ""}
                  onChange={(e) => handleChangeRange(s.key, e.target.value)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid #E5E7EB",
                    fontSize: 12,
                  }}
                />
              </div>
            ))}
          </div>

          {/* 저장 버튼 */}
          <button
            onClick={handleSaveExam}
            disabled={saving}
            style={{
              marginTop: 14,
              width: "100%",
              padding: "10px 0",
              borderRadius: 10,
              border: "none",
              background: saving ? "#9CA3AF" : "#1E3A8A",
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 800,
              cursor: saving ? "default" : "pointer",
            }}
          >
            {saving ? "저장 중..." : "💾 시험 저장 + 학생들에게 반영"}
          </button>

          {selectedExamId && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "#6B7280",
                textAlign: "right",
              }}
            >
              선택된 시험 ID: {selectedExamId}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}