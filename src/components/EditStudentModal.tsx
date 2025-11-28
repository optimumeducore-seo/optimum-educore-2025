import React, { useState, useEffect } from "react";
import GradeModal from "./GradeModal";
import GradeChartModal from "./GradeChartModal";
import type { AcademyType, WeeklyTime } from "../App";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useNavigate } from "react-router-dom";

type PersonalSchedule = {
  current: Partial<Record<AcademyType, WeeklyTime>>;
  next?: {
    effectiveDate: string;
    data: Partial<Record<AcademyType, WeeklyTime>>;
  };
  history?: { date: string; data: Partial<Record<AcademyType, WeeklyTime>> }[];

  // ✅ 개별 시간표 (학교, 자습, 직접입력 등)
  timeBlocks?: {
    day?: string;         // 단일 요일
    days?: string[];      // 복수 요일
    start: string;
    end: string;
    subject: string;
    customSubject?: string;
  }[];
};

type Student = {
  id: string;
  name: string;
  grade?: string;
  school?: string;
  gradeLevel?: string;
  studentPhone?: string;
  parentPhone?: string;
  englishScore?: number;
  mathScore?: number;
  scienceScore?: number;
  koreanScore?: number;
  personalSchedule?: PersonalSchedule;
};


type AnyStudent = any; // 타입 경고 임시 무시용
async function updateStudent(
  studentId: string,
  sched: any,
  student: AnyStudent,
  timeBlocks: any[] // ✅ 추가
) {
  try {
    const ref = doc(db, "students", studentId);

    // 🔹 내일부터 적용
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    // 🔹 과거 데이터 백업용
    const historyEntry = {
      date: new Date().toISOString().slice(0, 10),
      data: JSON.parse(JSON.stringify(sched.current || {})),
    };

    // 🔹 Firestore에 기존 history 추가
    await updateDoc(ref, {
      "personalSchedule.history": [
        ...(student.personalSchedule?.history ?? []),
        historyEntry,
      ],
    });

    // 🔹 current 중복제거
    const cleaned = JSON.parse(JSON.stringify(sched.current || {}));
    Object.keys(cleaned).forEach((subject) => {
      if (cleaned[subject]?.slots) {
        cleaned[subject].slots = cleaned[subject].slots.filter(
          (slot: any, index: number, self: any[]) =>
            index ===
            self.findIndex(
              (s) =>
                s.day === slot.day &&
                s.from === slot.from &&
                s.to === slot.to
            )
        );
      }
    });

    // 🔹 최종 Firestore 업데이트
    await updateDoc(ref, {
      "personalSchedule.history": [
        ...(student.personalSchedule?.history ?? []),
        historyEntry,
      ],
      "personalSchedule.current": cleaned,
      "personalSchedule.next": {
        effectiveDate: tomorrow.toISOString().slice(0, 10),
        data: JSON.parse(JSON.stringify(sched.next?.data ?? {})),
      },

      // ✅ 여기 추가: 개별 시간표 병합
      "personalSchedule.timeBlocks": timeBlocks ?? [],

      // 활성 과목만 저장
      academySubjects: Object.keys(cleaned).filter(
        (k) => (cleaned[k]?.slots ?? []).length > 0
      ),
    });

    console.log("✅ Firestore 업데이트 완료 (timeBlocks 포함)");
  } catch (err) {
    console.error("❌ Firestore 업데이트 실패:", err);
  }
}

/** ========= 학생 정보 수정 모달 ========= */
function EditStudentModal({
  student,
  onClose,
  onSave,
}: {
  student: Student;
  onClose: () => void;
  onSave: (patch: Partial<Student>) => void;
}) {
  const [showGradeModal, setShowGradeModal] = React.useState(false);
  const [showGradeChart, setShowGradeChart] = React.useState(false);
  const navigate = useNavigate();
  const [form, setForm] = React.useState({
    name: student.name || "",
    grade: student.grade || "",
    school: student.school || "",
    gradeLevel: (student as any).gradeLevel || "",
    studentPhone: student.studentPhone || "",
    parentPhone: student.parentPhone || "",
    koreanScore: student.koreanScore ?? 0,
    englishScore: student.englishScore ?? 0,
    mathScore: student.mathScore ?? 0,
    scienceScore: student.scienceScore ?? 0,
     entryDate: (student as any).entryDate || "",
  });

 /** ✅ 과목 리스트 */
const SUBJECTS: AcademyType[] = [
  
  "영어",
  "수학",
  "국어",
  "과학",
  "기타",
  "학교",
];

  /** ✅ 시간표 구조를 ‘현재/예약(next)’으로 확장 */
  const [sched, setSched] = useState<{
  current: Partial<Record<AcademyType, WeeklyTime>>;
  next?: {
    effectiveDate: string;
    data: Partial<Record<AcademyType, WeeklyTime>>;
  };
}>({
  current: student.personalSchedule?.current ?? {},
  next: student.personalSchedule?.next ?? undefined, // ← null 절대 넣지 말기
});
const [timeBlocks, setTimeBlocks] = useState<
  {
    day?: string;          // 기존 필드
    days?: string[];       // 여러 요일용 (월·수·금)
    start: string;
    end: string;
    subject: string;
    customSubject?: string; // ✅ 직접입력용 새 필드 추가
  }[]
>([]);

// 🔥 학생 정보 최신 Firestore 로딩 (모달 열릴 때 자동 반영)
// === Firestore의 최신 학생 정보 불러오기 ===
useEffect(() => {
  if (!student?.id) return;

  async function loadFullStudent() {
    const ref = doc(db, "students", student.id);
    const snap = await getDoc(ref);

    if (!snap.exists()) return;
    const data = snap.data();

    // 1) 기본 정보
    setForm(prev => ({ ...prev, ...data }));

    // 2) 스케줄
    setSched({
      current: data.personalSchedule?.current ?? {},
      next: data.personalSchedule?.next ?? undefined,
    });

    // 3) 개별 시간표
    if (Array.isArray(data.personalSchedule?.timeBlocks)) {
      setTimeBlocks(data.personalSchedule.timeBlocks);
      localStorage.setItem(
        `timeBlocks_${student.id}`,
        JSON.stringify(data.personalSchedule.timeBlocks)
      );
    } else {
      setTimeBlocks([]);
      localStorage.removeItem(`timeBlocks_${student.id}`);
    }
  }

  loadFullStudent();
}, [student?.id]);
// === 여기까지 ===


// ✅ Firestore에 저장된 개별시간 불러오기
// 🔥 Firestore → timeBlocks 정확히 가져오기
// 🔥 Firestore → timeBlocks 정확히 가져오기
useEffect(() => {
  if (!student?.id) return;

  const fire = student.personalSchedule?.timeBlocks;

  // Firestore에 있는 데이터 그대로 사용
  if (Array.isArray(fire)) {
    setTimeBlocks(fire);
    localStorage.setItem(`timeBlocks_${student.id}`, JSON.stringify(fire));
    return;
  }

  // 없으면 빈 배열
  setTimeBlocks([]);
  localStorage.removeItem(`timeBlocks_${student.id}`);
}, [student]);



// ✅ 변경 시 localStorage 동기화
useEffect(() => {
  if (!student?.id) return;
  localStorage.setItem(`timeBlocks_${student.id}`, JSON.stringify(timeBlocks));
}, [student.id, timeBlocks]);



/** ✅ 학원 시간 저장 함수 (예약 반영 포함) */
const handleAcademySave = async (
  sub: AcademyType,
  day: number | string,
  start: string,
  end: string
) => {
  // ✅ day를 안전하게 숫자로 변환 (공백·문자·NaN 방지)
  const dayIndex = Math.max(0, Math.min(6, Number(String(day).trim()) || 0));

  // 🕐 React state 비동기 업데이트 대기 (요일 값 반영 시간 확보)
  await new Promise((r) => setTimeout(r, 50));

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const effectiveDate = tomorrow.toISOString().slice(0, 10);

  setSched((prev) => {
    // ✅ 기존 current/next 둘 다 복사
    const currentData = JSON.parse(JSON.stringify(prev.current));
    const nextData = JSON.parse(JSON.stringify(prev.next?.data || {}));

    // ✅ 기존 슬롯 가져오기 (undefined 방지)
    const baseSlots = Array.isArray(nextData[sub]?.slots)
      ? nextData[sub].slots
      : Array.isArray(currentData[sub]?.slots)
      ? currentData[sub].slots
      : [];

    // ✅ 같은 요일 중복 제거 후 새 슬롯 추가
    const updatedSlots = [
      ...baseSlots.filter((s: any) => s.day !== dayIndex),
      { day: dayIndex, from: start, to: end },
    ];

    // ✅ 내일부터 적용
    return {
      ...prev,
      next: {
        effectiveDate,
        data: {
          ...nextData,
          [sub]: { ...(nextData[sub] || {}), slots: updatedSlots },
        },
      },
    };
  });

  // ✅ 안내 메시지
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const dayLabel = dayNames[dayIndex] ?? "(요일 미정)";

  alert(
    `📅 ${dayLabel}요일 ${start} ~ ${end} 학원 시간이 새로 등록되었습니다!\n(내일부터 적용)`
  );
};


/** ✅ PDF로 시간표 저장 함수 */
async function printScheduleToPDF() {
 const element = document.getElementById("schedule-container");
  if (!element) {
    alert("❗ 출력할 시간표 영역을 찾을 수 없습니다.");
    return;
  }

  // 고해상도 캡처
  const canvas = await html2canvas(element as HTMLElement, {
    scale: 3,
    backgroundColor: "#ffffff",
  });

  const imgData = canvas.toDataURL("image/png");

  // A4 가로 (landscape)
  const pdf = new jsPDF("landscape", "mm", "a4");
  const pdfWidth = pdf.internal.pageSize.getWidth(); // 297mm
  const pdfHeight = pdf.internal.pageSize.getHeight(); // 210mm


    // 🧭 위치 및 크기 조정 (왼쪽 반만)
  const targetWidth = pdfWidth / 2 - 15;  // 절반 폭에서 약간 여백
  const targetHeight = pdfHeight - 30;    // 위아래 여백
  const xOffset = 10;                     // 왼쪽 여백
  const yOffset = 10;                     // 상단 여백

  
  // 📅 3️⃣ 시간표 이미지 (왼쪽 반에 꽉 채우기)
  pdf.addImage(imgData, "PNG", xOffset, yOffset, targetWidth, targetHeight);

  // 중앙 구분선
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.line(pdfWidth / 2, 10, pdfWidth / 2, pdfHeight - 10);

  // 저장
  pdf.save(`시간표_${form.name || "학생"}.pdf`);
}



  /** ✅ activeSchedule = 오늘 이후 자동 분기 */
  const getActiveSchedule = () => {
    if (sched.next && new Date() >= new Date(sched.next.effectiveDate)) {
      return sched.next.data;
    }
    return sched.current;
  };

  const activeSchedule = getActiveSchedule();

  /** 공통 입력 핸들러 */
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const key = e.target.name as keyof Student;
    const value =
      e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const inp: React.CSSProperties = {
    padding: "6px 8px",
    border: "1px solid #e5d9c7",
    borderRadius: 8,
    background: "#fff",
    width: "100%",
    fontSize: 13,
  };

  const btn: React.CSSProperties = {
    padding: "6px 8px",
    border: "1px solid #e5d9c7",
    borderRadius: 8,
    background: "#f3e7d0",
    cursor: "pointer",
    fontSize: 12,
    color: "#3b2f2f",
  };

  const btnD: React.CSSProperties = {
    ...btn,
    background: "#d8b98a",
    borderColor: "#b08968",
    color: "#fff",
  };

    const [showHistory, setShowHistory] = useState(false);

  const handleSave = () => {
    // 기존 저장 로직
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        pointerEvents: "auto",
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: "relative",
          zIndex: 61,
          width: 900,
          maxWidth: "92vw",
          background: "#fdfaf5",
          borderRadius: 12,
          padding: 18,
          boxShadow: "0 10px 30px rgba(0,0,0,.2)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, marginBottom: 10, color: "#3b2f2f" }}>
          👤 학생 정보 수정
        </h3>


        {/* 기본 정보 입력 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            columnGap: 16,
            rowGap: 10,
          }}
        >
          <input
            name="name"
            value={form.name}
            onChange={handleChange}
            style={inp}
            placeholder="이름"
          />
          <select name="grade" value={form.grade} onChange={handleChange} style={inp}>
            <option value="">학년 선택</option>
            <option value="중1">중1</option>
            <option value="중2">중2</option>
            <option value="중3">중3</option>
            <option value="고1">고1</option>
            <option value="고2">고2</option>
            <option value="고3">고3</option>
          </select>
          <input
            name="school"
            value={form.school}
            onChange={handleChange}
            style={inp}
            placeholder="학교 이름"
          />
          <select
            name="gradeLevel"
            value={form.gradeLevel}
            onChange={handleChange}
            style={inp}
          >
            <option value="">학교급</option>
            <option value="중학교">중학교</option>
            <option value="고등학교">고등학교</option>
          </select>
          <input
            name="studentPhone"
            value={form.studentPhone}
            onChange={handleChange}
            style={inp}
            placeholder="학생 연락처"
          />
          <input
            name="parentPhone"
            value={form.parentPhone}
            onChange={handleChange}
            style={inp}
            placeholder="부모님 연락처"
          />

          <input
  type="date"
  name="entryDate"
  value={form.entryDate || ""}
  onChange={handleChange}
  style={inp}
  placeholder="입학일"
/>
        </div>




        {/* 개인 시간표 */}
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              marginBottom: 8,
              color: "#3b2f2f",
            }}
          >
            🗓️ 개인시간(기본 시간표)
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 6,
            }}
          >
            {SUBJECTS.map((sub) => (
              <div
                key={sub}
                style={{
                  background: "#fff",
                  border: "1px solid #e5d9c7",
                  borderRadius: 8,
                  padding: 8,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#3b2f2f",
                    marginBottom: 4,
                  }}
                >
                  {sub}
                </div>

                {(activeSchedule[sub]?.slots ?? [{ day: 1, from: "", to: "" }]).map(
                  (slot, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        marginBottom: 4,
                      }}
                    >
                      <select
                        value={slot.day}
                      onChange={(e) => {
  const newSlots = [...(activeSchedule[sub]?.slots ?? [])];
  newSlots[i].day = parseInt(e.target.value, 10); // ✅ 문자열 → 확실한 숫자 변환

  setSched((s) => ({
    ...s,
    current: {
      ...s.current,
      [sub]: { ...s.current[sub], slots: newSlots },
    },
  }));
}}
                        style={{
                          width: 42,
                          height: 30,
                          fontSize: 12,
                          fontWeight: 500,
                          padding: "3px 4px",
                          borderRadius: 6,
                          border: "1px solid #d1bfa3",
                          background: "#f9f7f2",
                          textAlign: "center",
                        }}
                      >
                        {["일", "월", "화", "수", "목", "금", "토"].map(
                          (d, idx) => (
                            <option key={idx} value={idx}>
                              {d}
                            </option>
                          )
                        )}
                      </select>

                      {/* 시작시간 */}
                      <input
                        type="time"
                        step="60"
                        value={slot.from || ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          const newSlots = [...(activeSchedule[sub]?.slots ?? [])];
                          newSlots[i] = { ...newSlots[i], from: v };
                          setSched((s) => ({
                            ...s,
                            current: {
                              ...s.current,
                              [sub]: { ...s.current[sub], slots: newSlots },
                            },
                          }));
                        }}
                        style={{
                          flex: 1,
                          fontSize: 12,
                          border: "1px solid #ccc",
                          borderRadius: 6,
                          padding: "3px 6px",
                          minWidth: 80,
                        }}
                      />

                      {/* 종료시간 */}
                      <input
                        type="time"
                        step="60"
                        value={slot.to || ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          const newSlots = [...(activeSchedule[sub]?.slots ?? [])];
                          newSlots[i] = { ...newSlots[i], to: v };
                          setSched((s) => ({
                            ...s,
                            current: {
                              ...s.current,
                              [sub]: { ...s.current[sub], slots: newSlots },
                            },
                          }));
                        }}
                        style={{
                          flex: 1,
                          fontSize: 12,
                          border: "1px solid #ccc",
                          borderRadius: 6,
                          padding: "3px 6px",
                          minWidth: 80,
                        }}
                      />

                      {/* 저장 */}
                      <button
  onClick={() => {
    if (!slot.from || !slot.to) {
      alert("시간을 입력해주세요!");
      return;
    }

    // ✅ 최신 요일 값을 바로 가져오기 (state 지연 방지)
    const latestDay = Number(
      (activeSchedule[sub]?.slots ?? [])[i]?.day ?? slot.day ?? 0
    );

    handleAcademySave(sub as AcademyType, latestDay, slot.from, slot.to);
  }}
                        style={{
                          height: 30,
                          marginTop: 2,
                          background: "#dae8fc",
                          color: "#2f3b52",
                          borderRadius: 6,
                          padding: "3px 10px",
                          border: "1px solid #b9c6ec",
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        저장
                      </button>
                      {/* 삭제 */}
                      <button
                        onClick={() => {
                          const confirmDelete = confirm("이 시간을 삭제하시겠습니까?");
                          if (!confirmDelete) return;
                          const newSlots = (
                            activeSchedule[sub]?.slots ?? []
                          ).filter((_, idx) => idx !== i);
                          setSched((s) => ({
                            ...s,
                            current: {
                              ...s.current,
                              [sub]: { ...s.current[sub], slots: newSlots },
                            },
                          }));
                        }}
                        style={{
                          height: 30,
                          marginTop: 2,
                          background: "#f9d6d5",
                          color: "#5a2a2a",
                          borderRadius: 6,
                          padding: "3px 8px",
                          border: "1px solid #e4b6b5",
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  )
                )}

                {/* 시간 추가 버튼 */}
                <button
                  onClick={() => {
                    const newSlots = [
                      ...(activeSchedule[sub]?.slots ?? []),
                      { day: 1, from: "", to: "" },
                    ];
                    setSched((s) => ({
                      ...s,
                      current: {
                        ...s.current,
                        [sub]: { ...s.current[sub], slots: newSlots },
                      },
                    }));
                  }}
                  style={{
                    fontSize: 11,
                    border: "1px solid #e5d9c7",
                    borderRadius: 6,
                    padding: "2px 5px",
                    background: "#f3e7d0",
                    color: "#3b2f2f",
                    marginTop: 4,
                  }}
                >
                  ➕ 시간 추가
                </button>
              </div>
            ))}
          </div>
        </div>

{/* 🕓 개별 시간 설정 */}
<div style={{ marginTop: 20 }}>
  <h3
    style={{
      fontSize: 14,
      fontWeight: 700,
      color: "#3b2f2f",
      marginBottom: 8,
    }}
  >
    🕓 개별 시간 설정
  </h3>

  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: 6,
    }}
  >
    {timeBlocks.map((block, i) => (
      <div
        key={i}
        style={{
          background: "#fff",
          border: "1px solid #e5d9c7",
          borderRadius: 8,
          padding: 8,
          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#3b2f2f",
            marginBottom: 4,
          }}
        >
          {block.subject || "개별 과목"}
        </div>

        {/* ✅ 요일 다중 선택 */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {["일", "월", "화", "수", "목", "금", "토"].map((d, idx) => (
            <label key={idx} style={{ fontSize: 11, display: "flex", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={block.days?.includes(idx.toString()) || false}
                onChange={(e) => {
                  const updated = [...timeBlocks];
                  let days = updated[i].days || [];
                  if (e.target.checked) days = [...days, idx.toString()];
                  else days = days.filter((v) => v !== idx.toString());
                  updated[i].days = days;
                  setTimeBlocks(updated);
                }}
                style={{ marginRight: 3 }}
              />
              {d}
            </label>
          ))}
        </div>

        {/* 시간 입력 */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
          <input
            type="time"
            value={block.start || ""}
            onChange={(e) => {
              const updated = [...timeBlocks];
              updated[i].start = e.target.value;
              setTimeBlocks(updated);
            }}
            style={{
              flex: 1,
              fontSize: 12,
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "3px 6px",
            }}
          />
          <span style={{ fontSize: 11, color: "#777" }}>~</span>
          <input
            type="time"
            value={block.end || ""}
            onChange={(e) => {
              const updated = [...timeBlocks];
              updated[i].end = e.target.value;
              setTimeBlocks(updated);
            }}
            style={{
              flex: 1,
              fontSize: 12,
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "3px 6px",
            }}
          />
        </div>

{/* 과목 선택 or 직접입력 */}
<div style={{ display: "flex", flex: 1, gap: 4 }}>
  <select
    value={block.subject}
    onChange={(e) => {
      const updated = [...timeBlocks];
      updated[i].subject = e.target.value;
      // 직접입력 선택 시 기본값 유지
      if (e.target.value !== "직접입력") updated[i].customSubject = "";
      setTimeBlocks(updated);
    }}
    style={{
      flex: 1,
      padding: "4px 6px",
      borderRadius: 4,
      border: "1px solid #ccc",
      background: "#f9f9f9",
    }}
  >
    <option value="">과목</option>
    {["국어", "수학", "영어", "학교", "자습"].map((s) => (
      <option key={s} value={s}>
        {s}
      </option>
    ))}
    <option value="직접입력">직접입력</option>
  </select>

  {/* 직접입력 입력창 */}
  {block.subject === "직접입력" && (
    <input
      type="text"
      placeholder="과목명 입력"
      value={block.customSubject || ""}
      onChange={(e) => {
        const updated = [...timeBlocks];
        updated[i].customSubject = e.target.value;
        setTimeBlocks(updated);
      }}
      autoFocus
      style={{
        flex: 1,
        padding: "4px 6px",
        border: "1px solid #ccc",
        borderRadius: 4,
      }}
    />
  )}
</div>

        {/* 버튼들 */}
        <div style={{ display: "flex", gap: 4 }}>
          {/* 저장 */}
          <button
            onClick={() => {
              const updated = [...timeBlocks];
              const days = block.days || [];
              if (!days.length) {
                alert("요일을 하나 이상 선택하세요.");
                return;
              }
              days.forEach((d) => {
                console.log(
                  `✅ ${block.subject || "과목"}: ${["일","월","화","수","목","금","토"][+d]} ${block.start} ~ ${block.end}`
                );
              });
              alert(
                `${block.subject || "과목"}이 ${days.length}개 요일에 등록되었습니다.`
              );
            }}
            style={{
              flex: 1,
              height: 28,
              background: "#dae8fc",
              color: "#2f3b52",
              borderRadius: 6,
              border: "1px solid #b9c6ec",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            저장
          </button>

          {/* 삭제 */}
          <button
            onClick={() => {
              const confirmDelete = confirm("이 항목을 삭제하시겠습니까?");
              if (!confirmDelete) return;
              const updated = timeBlocks.filter((_, idx) => idx !== i);
              setTimeBlocks(updated);
            }}
            style={{
              flex: 1,
              height: 28,
              background: "#f9d6d5",
              color: "#5a2a2a",
              borderRadius: 6,
              border: "1px solid #e4b6b5",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            삭제
          </button>
        </div>
      </div>
    ))}

    {/* ➕ 시간 추가 */}
    <button
      onClick={() =>
        setTimeBlocks([
          ...timeBlocks,
          { days: [], start: "", end: "", subject: "" },
        ])
      }
      style={{
        fontSize: 11,
        border: "1px solid #e5d9c7",
        borderRadius: 6,
        padding: "8px 5px",
        background: "#f3e7d0",
        color: "#3b2f2f",
        fontWeight: 600,
      }}
    >
      ➕ 시간 추가
    </button>
  </div>
</div>

      {/* 🗓️ 주간 시간표 미리보기 */}
{/* 🗓️ 주간 시간표 미리보기 */}
<div style={{ marginTop: 30 }}>
  <div
    id="schedule-container"
    style={{
      width: "100%",
      background: "#fff",
      padding: 20,
      borderRadius: 10,
      textAlign: "center",
    }}
  >
    {/* Optimum 헤더 */}
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "inline-block" }}>
        <span style={{ color: "#b71c1c", fontSize: 26, fontWeight: 900 }}>O</span>
        <span style={{ color: "#000", fontSize: 18, fontWeight: 600 }}>PTIMUM</span>
        <span style={{ color: "#1e3a8a", fontSize: 26, fontWeight: 900 }}> E</span>
        <span style={{ color: "#000", fontSize: 18, fontWeight: 600 }}>DUCORE</span>
        <span style={{ color: "#444", fontSize: 18, fontWeight: 800 }}> 시간표</span>
      </div>
    </div>

    {/* 실제 시간표 grid */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "60px repeat(7, 1fr)",
        border: "1px solid #ccc",
        fontSize: 11,
      }}
    >
      {/* 헤더 */}
      {["시간", "월", "화", "수", "목", "금", "토", "일"].map((h, i) => (
        <div
          key={i}
          style={{
            background: "#f7f7f7",
            textAlign: "center",
            padding: "6px 0",
            fontWeight: 600,
            borderRight: "1px solid #ddd",
          }}
        >
          {h}
        </div>
      ))}

      {/* 시간표 본문 */}
      {Array.from({ length: 27 }).map((_, i) => {
        const hour = 9 + Math.floor(i / 2);
        const minute = i % 2 === 0 ? "00" : "30";
        const label = `${String(hour).padStart(2, "0")}:${minute}`;

        return (
          <React.Fragment key={i}>
            {/* 왼쪽 시간축 */}
            <div
              style={{
                textAlign: "center",
                padding: "2px 0",
                borderTop: "1px solid #eee",
                borderRight: "1px solid #ddd",
                color: "#444",
              }}
            >
              {label}
            </div>

            {/* 요일별 칸 */}
            {["월", "화", "수", "목", "금", "토", "일"].map((day, idx) => {
              // 공통 변수 (한 번만 선언)
              const dayIndex = (idx + 1) % 7; // ✅ 그대로 사용 (보정하지 않음)
              const colorMap: Record<string, string> = {
                영어: "#7da2ff",
                수학: "#6dd47e",
                국어: "#ffb347",
                과학: "#a56eff",                
                기타: "#fdd54f",
                학교: "#b0bec5",
              };

              // 시간 범위 판별 함수
              const inRange = (t: string, from?: string, to?: string) =>
                !!from && !!to && from <= t && t < to;

              // 기존 스케줄 병합
              const mergedSchedule = {
                ...(sched.current || {}),
                ...(sched.next?.data || {}),
              };

              // 기본 스케줄에서 해당 시간대 과목 찾기
              const matchSubject = Object.entries(mergedSchedule).find(
                ([sub, data]) =>
                  (data?.slots || []).some(
                    (s) => s.day === dayIndex && inRange(label, s.from, s.to)
                  )
              );

              // 개별 시간 블록 확인
              const customBlock = timeBlocks.find((b) => {
                const matchDay =
                  (Array.isArray(b.days) && b.days.includes(String(dayIndex))) ||
                  (b.day !== undefined && b.day === String(dayIndex));
                return matchDay && inRange(label, b.start, b.end);
              });

              // 우선순위: 개인 블록 > 기본 스케줄
             const subjectName =
  customBlock?.customSubject ||
  customBlock?.subject ||
  matchSubject?.[0];
              const background = subjectName
                ? colorMap[subjectName] ?? "#b0bec5"
                : "#fff";
              const isFilled = !!subjectName;

              return (
                <div
                  key={`${day}-${label}`}
                  style={{
                    height: 20,
                    borderTop: "1px solid #eee",
                    borderRight: "1px solid #ddd",
                    textAlign: "center",
                    fontSize: 10,
                    color: isFilled ? "#fff" : "#555",
                    background,
                  }}
                >
                  {subjectName ?? ""}
                </div>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  </div>
</div>

{/* 버튼 영역 */}
<div
  style={{
    marginTop: 20,
    paddingTop: 10,
    borderTop: "1px solid #e5d9c7",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  }}
>
  <div style={{ display: "flex", gap: 8 }}>
    <button style={btn} onClick={() => setShowGradeModal(true)}>
      📘 성적 입력
    </button>
    <button
  style={btn}
  onClick={() => navigate(`/exam/${student.id}`)}
>
  모의고사 성적 입력
</button>
    <button style={btn} onClick={() => setShowGradeChart(true)}>
      📈 그래프 보기
    </button>
    <button style={btn} onClick={() => setShowHistory(!showHistory)}>
      {showHistory ? "📜 이력 닫기" : "📜 변경 이력 보기"}
    </button>
  </div>

  {showHistory && (
    <div
      style={{
        border: "1px solid #ccc",
        padding: 8,
        borderRadius: 8,
        maxHeight: 250,
        overflowY: "auto",
        background: "#fff8e7",
        marginTop: 10,
      }}
    >
      <h4 style={{ margin: "4px 0", fontSize: 13 }}>📜 변경 이력</h4>
      {student.personalSchedule?.history?.length ? (
        student.personalSchedule.history
          .slice()
          .reverse()
          .map((h: any, i: number) => (
            <div
              key={i}
              style={{
                borderBottom: "1px solid #ddd",
                padding: "4px 0",
                fontSize: 11,
              }}
            >
              <strong>{h.date}</strong>
              <pre
                style={{
                  fontSize: 10,
                  background: "#f9f9f9",
                  padding: 4,
                  borderRadius: 4,
                  whiteSpace: "pre-wrap",
                  marginTop: 4,
                }}
              >
                {JSON.stringify(h.data, null, 2)}
              </pre>
            </div>
          ))
      ) : (
        <p style={{ fontSize: 11, color: "#666" }}>기록 없음</p>
      )}
    </div>
  )}



          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn} onClick={onClose}>
              취소
            </button>
           {/* PDF로 저장 버튼 추가 */}
  <button style={btn} onClick={printScheduleToPDF}>
    📄 PDF로 저장
  </button>

          <button
  style={btnD}
  onClick={async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 자정 기준 비교용

    // 🔹 현재 스케줄 상태 불러오기
    const active =
      sched.next && new Date() >= new Date(sched.next.effectiveDate)
        ? sched.next.data
        : sched.current;

    // 🔹 영어 등 과목 중 공백 슬롯 제거 (from, to 없는 것 필터링)
    Object.keys(active).forEach((subj) => {
      const data = active[subj as AcademyType];
      if (data?.slots) {
        data.slots = data.slots.filter((s) => s.from && s.to);
      }
    });

    // 🔹 내일부터 적용될 새 스케줄 만들기
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const updated = {
      ...form,
       entryDate: form.entryDate || null,
      personalSchedule: {
        current: sched.current, // 오늘까지 유지
        next: {
          effectiveDate: tomorrow.toISOString(),
          data: JSON.parse(JSON.stringify(active)), // 내일부터 적용
        },
      },
      academySubjects: Object.keys(active).filter(
        (k) => (active[k as AcademyType]?.slots ?? []).length > 0
      ) as AcademyType[],
    };

    // ✅ Firestore 완전 덮어쓰기 (이전 요일 데이터 제거용)
await setDoc(
  doc(db, "students", student.id),
  {
    ...student,
    personalSchedule: {
      current: {
        ...sched.current,
        // ✅ 영어 중복 제거 로직
        영어: {
          ...sched.current.영어,
          slots: (sched.current.영어?.slots || []).filter(
            (slot, index, self) =>
              index ===
              self.findIndex(
                (s) =>
                  s.day === slot.day &&
                  s.from === slot.from &&
                  s.to === slot.to
              )
          ),
        },
      },
     next: sched.next ? JSON.parse(JSON.stringify(sched.next)) : undefined,

      // ✅ 개별 시간(timeBlocks) 함께 저장
      timeBlocks: JSON.parse(JSON.stringify(timeBlocks || [])),
    },

    // ✅ 활성 과목 목록 업데이트
    academySubjects: Object.keys(active).filter(
      (k) => (active[k as AcademyType]?.slots ?? []).length > 0
    ) as AcademyType[],
  },
  { merge: true } // 🔹 과거 데이터(history 등 유지)
);

// ✅ 로컬 상태도 즉시 반영
const newStudent = { ...student, ...updated }; // 새 객체로 복사 (참조 끊기)
onSave(newStudent);

alert("✅ Firestore에 완전 반영되었습니다.\n(이전 요일 데이터 모두 초기화됨)");
  }}
>
  저장
</button>
          </div>
        </div>

        {showGradeModal && (
          <GradeModal
            studentId={student.id ?? ""}
            gradeLevel={student.gradeLevel ?? "중1"}
            onClose={() => setShowGradeModal(false)}
          />
        )}

        {showGradeChart && (
          <GradeChartModal onClose={() => setShowGradeChart(false)} grades={{}} />
        )}
      </div>
    </div>
    
  );
}

export default EditStudentModal;