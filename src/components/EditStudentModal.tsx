import React, { useState } from "react";
import GradeModal from "./GradeModal";
import GradeChartModal from "./GradeChartModal";
import type { Student, AcademyType, WeeklyTime } from "../App";

//rt WeeklySchedulePreview from "./WeeklySchedulePreview";//
import { doc, updateDoc } from "firebase/firestore";
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

  const getTimeSlots = (isWeekend: boolean) => {
  const start = isWeekend ? 9 : 15;
  const end = isWeekend ? 18 : 22;
  const slots: string[] = [];
  for (let h = start; h < end; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
};

  /** ✅ 과목 리스트 */
  const SUBJECTS: AcademyType[] = ["영어", "수학", "국어", "과학", "기타", "외출",];

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

  /** ✅ 학원 시간 저장 함수 (예약 반영 포함) */
  const handleAcademySave = (
  sub: AcademyType,
  day: number | string,
  start: string,
  end: string
) => {
   const dayNum = Number(day || 0); // ⚡ undefined 방지
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const effectiveDate = tomorrow.toISOString().slice(0, 10);

  setSched((prev) => {
    const prevSlots = prev.current[sub]?.slots || [];
    const updatedSlots = [
      ...prevSlots.filter((s) => s.day !== Number(day)),
      { day: Number(day), from: start, to: end },
    ];

    return {
      ...prev,
      next: {
        effectiveDate,
        data: {
          ...(prev.next?.data || {}),
          [sub]: { ...prev.current[sub], slots: updatedSlots },
        },
      },
    };
  });

  // ✅ 요일 표시 정확히 수정
  const dayNames = ["월", "화", "수", "목", "금","토", "일",]
  const idx = Number(day);
  const dayLabel =
    !isNaN(idx) && idx >= 0 && idx < 7 ? dayNames[idx] : "(요일 미정)";
  alert(
    `📅 ${dayLabel}요일 ${start} ~ ${end} 학원 시간이 새로 등록되었습니다!\n(내일부터 적용)`
  );
};

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
                        {[ "월", "화", "수", "목", "금", "토","일"].map(
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
  onClick={async (e) => {
    e.stopPropagation(); // ✅ 클릭 버블링 차단 (중요!)

    if (!slot.from || !slot.to) {
      alert("시간을 입력하세요!");
      return;
    }

    // 🔹 day값이 string일 가능성 방지
    const dayNum =
      slot.day !== undefined && slot.day !== null ? Number(slot.day) : 0;

    // 🔹 로컬 상태 즉시 업데이트
    const prevCurrent = sched.current || {};
    const prevSub = prevCurrent[sub] || { slots: [] };
    const updatedSlots = [
      ...prevSub.slots.filter((s) => Number(s.day) !== dayNum),
      { day: dayNum, from: slot.from, to: slot.to },
    ];

    const nextSched = {
      ...sched,
      current: {
        ...prevCurrent,
        [sub]: { ...prevSub, slots: updatedSlots },
      },
    };

    setSched(nextSched);

    // 🔹 Firestore 저장
    const updated = {
      personalSchedule: {
        current: nextSched.current,
        next: nextSched.next,
      },
    };
    await updateStudent(student.id, updated);

    // 🔹 상위 컴포넌트에도 즉시 반영
    // onSave({   ...student,     ...updated,    }); //

   //alert("✅ 학생 정보가 저장되었습니다!");

    // 요일 안내
    const dayNames = ["월", "화", "수", "목", "금","토", "일",]
    const dayLabel =
      Number.isInteger(dayNum) && dayNum >= 0 && dayNum < 7
        ? dayNames[dayNum]
        : "요일 선택 안됨";

    alert(`📘 ${dayLabel}요일 ${slot.from} ~ ${slot.to} 학원 시간이 저장되었습니다!`);
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
        
{/* 🗓️ 주간 시간표 미리보기 */}
<div style={{ marginTop: 30 }}>
  <h3
    style={{
      fontSize: 14,
      fontWeight: 700,
      color: "#3b2f2f",
      marginBottom: 8,
    }}
  >
    🗓️ 주간 시간표 미리보기
  </h3>

  <div
    style={{
      display: "grid",
      gridTemplateColumns: "60px repeat(7, 1fr)", // 시간 + 월~일
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

    {/* 시간표 */}
    {Array.from({ length: 27 }).map((_, i) => {
      const hour = 9 + Math.floor(i / 2);
      const minute = i % 2 === 0 ? "00" : "30";
      const label = `${String(hour).padStart(2, "0")}:${minute}`;
      const currentTime = hour + (minute === "30" ? 0.5 : 0);

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
            const isWeekend = idx >= 5;
            const activeStart = isWeekend ? 9 : 15.5;
            const activeEnd = isWeekend ? 18 : 22;

            // 🔹 평일/주말 시간대 여부
            const isActive =
              currentTime >= activeStart && currentTime < activeEnd;

            // 🔹 과목별 색상
            const colorMap: Record<string, string> = {
              영어: "#7da2ff",
              수학: "#6dd47e",
              국어: "#ffb347",
              과학: "#a56eff",
              기타: "#b0bec5",
              외출: "#ef5350",
            };

            // 🔹 현재 칸에 해당하는 수업 찾기
            const matchSubject = Object.entries(sched.current || {}).find(
              ([sub, data]) =>
                (data?.slots || []).some(
                  (s) =>
                    ((s.day - 1) === idx && s.from <= label && s.to > label)
                )
            );

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
                    : isActive
                    ? "#fff"
                    : "#f4f4f4",
                  transition: "0.2s",
                }}
              >
                {matchSubject ? matchSubject[0] : ""}
              </div>
            );
          })}
        </React.Fragment>
      );
    })}
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
           <button
  style={btnD}
  onClick={async () => {
    const active = getActiveSchedule();

    // 🔹 active가 최신 상태인지 보장
    await new Promise((r) => setTimeout(r, 100));

    const academySubjects = Object.keys(active).filter(
      (k) => (active[k as AcademyType]?.slots ?? []).length > 0
    ) as AcademyType[];

    // 🔹 personalSchedule 저장 (current/next 구조 유지)
    const updated = {
      ...form,
      personalSchedule: {
        current: sched.current,
        next: sched.next,
      },
      academySubjects,
    } as Partial<Student>;

    onSave(updated);

    // 🔹 Firestore에 동기화
    await updateStudent(student.id, updated);

    alert("✅ 학생 정보가 저장되었습니다!");
    //onClose();//
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