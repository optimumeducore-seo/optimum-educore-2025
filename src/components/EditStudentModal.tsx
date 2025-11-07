import React, { useState } from "react";
import GradeModal from "./GradeModal";
import GradeChartModal from "./GradeChartModal";
import type { Student, AcademyType, WeeklyTime } from "../App";

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

  /** ✅ 과목 리스트 */
  const SUBJECTS: AcademyType[] = ["영어", "수학", "국어", "과학", "기타", "외출"];

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
  day: number,
  start: string,
  end: string
) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const effectiveDate = tomorrow.toISOString().slice(0, 10);

  setSched((prev) => {
    const prevSlots = prev.current[sub]?.slots || [];
    const updatedSlots = [
      ...prevSlots.filter((s) => s.day !== day),
      { day, from: start, to: end },
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

  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const dayLabel = dayNames[day] ?? "(요일 미정)";

  alert(`📅 ${dayLabel}요일 ${start} ~ ${end} 학원 시간이 새로 등록되었습니다!\n(내일부터 적용)`);
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