import React, { useState, useEffect } from "react";
import GradeModal from "./GradeModal";
import GradeChartModal from "./GradeChartModal";
import type { Student, AcademyType, WeeklyTime } from "../App";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

async function updateStudent(studentId: string, patch: any) {
  try {
    const ref = doc(db, "students", studentId);
    await updateDoc(ref, patch);
    console.log("✅ 학생 정보 Firestore 업데이트 완료");
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
    current: (student.personalSchedule as any)?.current ?? student.personalSchedule ?? {},
  });
const [timeBlocks, setTimeBlocks] = useState<
  { day: string; start: string; end: string; subject: string }[]
>([]);
// ✅ 페이지 로드 시 localStorage에서 불러오기
useEffect(() => {
  const saved = localStorage.getItem("timeBlocks");
  if (saved) setTimeBlocks(JSON.parse(saved));
}, []);

// ✅ 변경될 때마다 자동 저장
useEffect(() => {
  localStorage.setItem("timeBlocks", JSON.stringify(timeBlocks));
}, [timeBlocks]);
  /** ✅ 학원 시간 저장 함수 (예약 반영 포함) */
const handleAcademySave = async (
  sub: AcademyType,
  day: number,
  start: string,
  end: string
) => {
  // 🕐 React state 비동기 업데이트 대기 (요일 값 반영 시간 확보)
  await new Promise((r) => setTimeout(r, 50));

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const effectiveDate = tomorrow.toISOString().slice(0, 10);

  setSched((prev) => {
    // ✅ 기존 current/next 둘 다 복사
    const currentData = JSON.parse(JSON.stringify(prev.current));
    const nextData = JSON.parse(JSON.stringify(prev.next?.data || {}));

    // ✅ 해당 과목의 기존 슬롯을 전부 가져옴
    const baseSlots = nextData[sub]?.slots || currentData[sub]?.slots || [];

    // ✅ 같은 요일 슬롯 제거 후, 새로운 슬롯 추가
    const updatedSlots = [
      ...baseSlots.filter((s: any) => s.day !== day),
      { day, from: start, to: end },
    ];

    // ✅ 내일부터 적용되는 구조
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


  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const dayLabel = dayNames[day] ?? "(요일 미정)";
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
                          newSlots[i].day = Number(e.target.value);
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
                          handleAcademySave(
                            sub as AcademyType,
                            slot.day,
                            slot.from,
                            slot.to
                          );
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

        {/* 학생 개별 시간 입력 UI 추가 */}
<div style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#3b2f2f", marginBottom: 8 }}>
        🕓 개별 시간 설정
      </h3>

      {/* 입력된 시간 블록 목록 */}
{/* 입력된 시간 블록 목록 */}
{timeBlocks.map((block, i) => (
  <div
    key={i}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      marginBottom: 6,
    }}
  >
    {/* 요일 선택 */}
    <select
      value={block.day || ""}
      onChange={(e) => {
        const updated = [...timeBlocks];
        updated[i].day = e.target.value;
        setTimeBlocks(updated);
      }}
      style={{
        padding: "4px 6px",
        borderRadius: 4,
        border: "1px solid #ccc",
      }}
    >
      <option value="">요일</option>
      <option value="1">월</option>
      <option value="2">화</option>
      <option value="3">수</option>
      <option value="4">목</option>
      <option value="5">금</option>
      <option value="6">토</option>
      <option value="0">일</option>
    </select>

    {/* 시작 시간 */}
    <input
      type="time"
      value={block.start}
      onChange={(e) => {
        const updated = [...timeBlocks];
        updated[i].start = e.target.value;
        setTimeBlocks(updated);
      }}
    />

    <span>~</span>

    {/* 종료 시간 */}
    <input
      type="time"
      value={block.end}
      onChange={(e) => {
        const updated = [...timeBlocks];
        updated[i].end = e.target.value;
        setTimeBlocks(updated);
      }}
    />

    {/* 과목명 입력 */}
    <input
      type="text"
      placeholder="과목명"
      value={block.subject}
      onChange={(e) => {
        const updated = [...timeBlocks];
        updated[i].subject = e.target.value;
        setTimeBlocks(updated);
      }}
      style={{
        flex: 1,
        padding: "4px 6px",
        border: "1px solid #ccc",
        borderRadius: 4,
      }}
    />

    {/* 삭제 버튼 */}
    <button
      onClick={() => {
        const updated = timeBlocks.filter((_, idx) => idx !== i);
        setTimeBlocks(updated);
      }}
      style={{
        border: "none",
        background: "transparent",
        color: "#b71c1c",
        fontWeight: 700,
        fontSize: 16,
        cursor: "pointer",
      }}
    >
      ✕
    </button>
  </div>
))}

{/* 추가 버튼 */}
<button
  onClick={() =>
    setTimeBlocks([
      ...timeBlocks,
      { day: "", start: "", end: "", subject: "" },
    ])
  }
  style={{
    marginTop: 6,
    padding: "5px 10px",
    borderRadius: 4,
    border: "1px solid #ccc",
    background: "#f9f9f9",
    cursor: "pointer",
  }}
>
  + 시간 추가
</button>
    </div>


      {/* 🗓️ 주간 시간표 미리보기 */}
{/* 🗓️ 주간 시간표 미리보기 */}
<div style={{ marginTop: 30 }}>
  {/* PDF 저장할 전체 영역 */}
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
        <span style={{ color: "#1e3a8a", fontSize: 26, fontWeight: 900 }}>  E</span>
        <span style={{ color: "#000", fontSize: 18, fontWeight: 600 }}>DUCORE</span>
        <span style={{color: "#444", fontSize: 18, fontWeight: 800}}>   시간표</span>
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
              const colorMap: Record<string, string> = {
                영어: "#7da2ff",
                수학: "#6dd47e",
                국어: "#ffb347",
                과학: "#a56eff",
                기타: "#b0bec5",
                학교: "#fdd54f",
              };

              const dayIndex = (idx + 1) % 7;

              const mergedSchedule = {
                ...(sched.current || {}),
                ...(sched.next?.data || {}),
              };

              const matchSubject = Object.entries(mergedSchedule).find(
                ([sub, data]) =>
                  (data?.slots || []).some(
                    (s) => s.day === dayIndex && s.from <= label && s.to > label
                  )
              );
             
              // 🕓 timeBlocks 반영 (요일 상관없이 표시)
const customBlock = timeBlocks.find(
  (b) => b.start <= label && b.end > label
);

const subjectName =
  (matchSubject && matchSubject[0]) || (customBlock && customBlock.subject);


              return (
                <div
                  key={`${day}-${label}`}
                  style={{
                    height: 20,
                    borderTop: "1px solid #eee",
                    borderRight: "1px solid #ddd",
                    textAlign: "center",
                    fontSize: 10,
                    color: matchSubject ? "#fff" : "#555",
                    background: matchSubject
                      ? colorMap[matchSubject[0]] || "#3b2f2f"
                      : "#fff",
                  }}
                >
                  {subjectName ? subjectName : ""}
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
            <button style={btn} onClick={() => setShowGradeChart(true)}>
              📈 그래프 보기
            </button>
          </div>

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
await setDoc(doc(db, "students", student.id), {
  ...student,
  personalSchedule: {
    current: JSON.parse(JSON.stringify(sched.current)), // 현재 화면 상태 그대로 저장
    next: JSON.parse(JSON.stringify(sched.next ?? null)),
  },
  academySubjects: Object.keys(active).filter(
    (k) => (active[k as AcademyType]?.slots ?? []).length > 0
  ) as AcademyType[],
}, { merge: false });

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