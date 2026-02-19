// src/components/admin/OpsModal.tsx
import React, { useEffect, useState } from "react";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore"; 
import { db } from "../../firebase";

import TimeTable from "../TimeTable";
import { convertPersonalScheduleToBlocks } from "../../utils/convertSchedule";
import type { StudentLite } from "../../utils/scheduleEngine";
import { fillStudyHallGaps } from "../../utils/scheduleEngine";
import BrandHeader from "../BrandHeader";
import { setDoc } from "firebase/firestore";


type Props = {
  open: boolean;
  onClose: () => void;
};

const pillBase: React.CSSProperties = {
  borderRadius: 999,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 800,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  color: "#111827",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const pillOn: React.CSSProperties = {
  background: "#111827",
  color: "#ffffff",
  borderColor: "#111827",
};

const pillSub: React.CSSProperties = {
  background: "#ffffff",
};

export default function OpsModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<"timetable" | "attendance">("timetable");
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [records, setRecords] = useState<Record<string, any>>({});
  const [hall, setHall] = useState<"ms" | "hs">("ms");
  const [vacationMode, setVacationMode] = useState(true);

 useEffect(() => {
  if (!open) return;

  // ✅ 여기서 한 번만 계산 (중복 제거)
  const openStart = vacationMode ? "13:00" : "15:30";
  const openEnd = "22:00";

  const unsubStudents = onSnapshot(collection(db, "students"), (snap: any) => {
    const list2 = snap.docs
      .filter((docSnap: any) => !docSnap.data()?.removed)
      .map((docSnap: any) => {
        const d = docSnap.data();

        const academyBlocks = convertPersonalScheduleToBlocks(d?.personalSchedule);
        const blocks = fillStudyHallGaps(academyBlocks, openStart, openEnd);

        const seatNoRaw = d?.seatNo;
        const seatNo =
          typeof seatNoRaw === "number"
            ? seatNoRaw
            : typeof seatNoRaw === "string" && seatNoRaw.trim() !== ""
            ? Number(seatNoRaw)
            : null;

        return {
          id: docSnap.id,
          name: d?.name ?? "",
          blocks,
          academyBlocks,

          school: d?.school ?? "",
          gradeLevel: d?.gradeLevel ?? "",
          hall: d?.hall ?? "",

          seatNo: Number.isFinite(seatNo as any) ? seatNo : null,
        } as any;
      });

    setStudents(list2);

    console.log(
      "HALL CHECK",
      list2.slice(0, 20).map((s: any) => ({
        name: s.name,
        hall: s.hall,
        gradeLevel: s.gradeLevel,
        school: s.school,
      }))
    );
  });

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const unsubRecords = onSnapshot(doc(db, "records", dateStr), (snap: any) => {
    if (!snap.exists()) {
      setRecords({});
      return;
    }
    setRecords(snap.data() || {});
  });

  return () => {
    unsubStudents();
    unsubRecords();
  };
}, [open, vacationMode]);

  useEffect(() => {
  const interval = setInterval(() => {
    students.forEach(async (s) => {
      const rec = records?.[s.id] || {};
    const actual =
  rec?.time || rec?.checkInTime || rec?.inTime || rec?.in || "";

      if (actual) return; // 이미 체크인했으면 skip

      const expected = getLastAcademyEnd(s);
      const expectedMin = toMin(expected || "");
      if (!expectedMin) return;

      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

    if (!actual && nowMin - expectedMin > 15 && rec?.status !== "late") {
  await setStatus(s.id, "late");
}
    });
  }, 60000); // 1분마다 검사

  return () => clearInterval(interval);
}, [students, records]);

// "HH:MM" -> minutes
const toMin = (hhmm?: string) => {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return h * 60 + mm;
};

const isLate15 = (expectedHHMM?: string, actualHHMM?: string) => {
  const e = toMin(expectedHHMM);
  const a = toMin(actualHHMM);
  if (e == null || a == null) return false;
  return a - e > 15;
};
const getLastAcademyEnd = (s: any): string | null => {
  const arr = Array.isArray(s.blocks) ? s.blocks : [];
  if (!arr.length) return null;

  const last = arr[arr.length - 1];
  return last?.endHHMM || last?.end || null;
};

const getWeeklyLateCount = (studentId: string) => {
  const now = new Date();
  const day = now.getDay(); // 0(일)~6(토)

  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7)); // 이번주 월요일
  monday.setHours(0, 0, 0, 0);

  let count = 0;

  Object.entries(records).forEach(([dateStr, data]: any) => {
    const d = new Date(dateStr);
    if (d >= monday) {
      if (data?.[studentId]?.status === "late") {
        count++;
      }
    }
  });

  return count;
};

const getLastAcademyName = (s: any): string | null => {
  const arr = Array.isArray(s.blocks) ? s.blocks : [];
  if (!arr.length) return null;

  const last = arr[arr.length - 1];
  return last?.label || last?.title || last?.name || null;
};

// ✅ records 문서에 seatNo / status 저장
const setSeatNo = async (studentId: string, seatNo: number | null) => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const ref = doc(db, "records", dateStr);

  // 문서 없으면 생성
  await setDoc(ref, {}, { merge: true });

  // ✅ studentId 전체를 덮지 말고 seatNo만 수정
  await updateDoc(ref, {
    [`${studentId}.seatNo`]: seatNo,
  });
};

const setStatus = async (studentId: string, status: "late" | "ok" | "absent" | "") => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const ref = doc(db, "records", dateStr);
  await updateDoc(ref, {
    [`${studentId}.status`]: status,
  });
};

  if (!open) return null;

  const blocksTotal = students.reduce((a, s) => a + (s.blocks?.length || 0), 0);

  // ✅ 프린트 전용 스타일: "fixed" 금지, 타임테이블만 출력
  const PrintStyle = () => (
    <style>{`
@media print {
  @page { size: A4 landscape; margin: 6mm; }

  /* 전부 숨김 */
  body * { visibility: hidden !important; }

  /* ✅ 타임테이블 영역만 보이게 */
  #ops-print-area, #ops-print-area * { visibility: visible !important; }

  /* ✅ 프린트 영역 배치 (fixed 쓰지마!) */
  #ops-print-area{
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;

    width: 297mm !important;
    min-height: 210mm !important;

    background: #fff !important;
    overflow: visible !important;
  }

  /* 화면용 UI 숨김 */
  .no-print { display: none !important; }

  /* 표가 최대한 한 장에 들어가게 글씨/여백 줄이기 */
  #ops-print-area table { font-size: 9px !important; }
  #ops-print-area th, #ops-print-area td { padding: 3px !important; }

  /* 표 레이아웃 안정화 */
  #ops-print-area table { table-layout: fixed !important; width: 100% !important; }
  #ops-print-area td { word-break: break-word !important; }

  /* 색상 출력 */
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}

/* 화면(프린트 아님)에는 아무 영향 없게 */
`}</style>
  );

return (
  <div style={backdrop} onMouseDown={onClose}>
    <PrintStyle />

    <div style={modal} onMouseDown={(e) => e.stopPropagation()}>

      {/* ✅ 1) (선택) 맨 위 얇은 헤더줄 - 필요 없으면 통째로 삭제해도 됨 */}
      <div className="no-print" style={header}>
        <div />
      </div>

      {/* ✅ 2) 브랜드헤더: 무조건 중앙 고정 */}
      <div
        className="no-print"
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "center",
          padding: "10px 0 6px",
        }}
      >
        <div style={{ width: "fit-content" }}>
          <BrandHeader isMobile={false} />
        </div>
      </div>

      {/* ✅ 3) 컨트롤바: 탭(왼쪽) / 관버튼(가운데) / 중요버튼(오른쪽) */}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderBottom: "1px solid #eee",
        }}
      >
        {/* 왼쪽: 탭 */}
        <div style={{ display: "flex", gap: 8 }}>
       <button
  onClick={() => setTab("timetable")}
  style={{
    ...pastelBase,
    ...(tab === "timetable" ? pastelBlueOn : pastelBlue),
  }}
>
  타임테이블
</button>
       <button
  onClick={() => setTab("attendance")}
  style={{
    ...pastelBase,
    ...(tab === "attendance" ? pastelBlueOn : pastelBlue),
  }}
>
  출결현황
</button>
        </div>

        {/* 가운데: 출결일 때만 관 버튼 */}
        <div style={{ display: "flex", gap: 8 }}>
          {tab === "attendance" && (
            <>
         <button
  onClick={() => setHall("ms")}
  style={{
    ...pastelBase,
    ...(hall === "ms" ? pastelPinkOn : pastelPink),
  }}
>
  중등관(16)
</button>
            <button
  onClick={() => setHall("hs")}
  style={{
    ...pastelBase,
    ...(hall === "hs" ? pastelPinkOn : pastelPink),
  }}
>
  고등관(43)
</button>
            </>
          )}
        </div>

        {/* 오른쪽: 공통 버튼 */}
        <div style={{ display: "flex", gap: 8 }}>
         <button
  onClick={() => setVacationMode((v) => !v)}
  style={{
    ...pastelBase,
    ...pastelGold,
  }}
>
  {vacationMode ? "방학 모드 ON" : "방학 모드 OFF"}
</button>

          <button style={btn} onClick={() => window.print()}>
            프린트
          </button>

          <button style={btn} onClick={onClose}>
            닫기
          </button>
        </div>
      </div>

      {/* ✅ 내용 */}
      <div style={content}>
        <div className="no-print" style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
          students: {students.length} / blocks: {blocksTotal}
        </div>

          {tab === "timetable" ? (
            // ✅ 프린트는 이 영역만 찍힘
            <div id="ops-print-area">
              <TimeTable
                students={students}
                startHHMM={vacationMode ? "13:00" : "15:30"}
                endHHMM="22:00"
                stepMin={30}
                vacationMode={vacationMode}
              />
            </div>
         ) : (
  <div style={{ padding: 12 }}>

    {/* 좌석 수 선택(현재 16 → 다음달 43 → 그다음 59) */}
   

 {(() => {

const normalizeHall = (raw: any) => {
  const v = String(raw || "").trim();

  // ms/hs 코드
  if (v === "ms") return "중등관";
  if (v === "hs") return "고등관";

  // 완전값
  if (v === "중등관" || v === "고등관") return v;

  // ✅ 느슨하게 허용(실제 저장값이 "중등", "고등", "중", "고" 같은 경우 대응)
  if (v.includes("중")) return "중등관";
  if (v.includes("고")) return "고등관";

  return "";
};

const guessHall = (s: any) => {
  // 1) hall 값 우선
  const h = normalizeHall(s?.hall);
  if (h) return h;

  // 2) 없으면 예전 방식으로 추정(안 사라지게 안전장치)
  const gl = String(s?.gradeLevel || "");
  const sc = String(s?.school || "");
  if (gl.includes("고") || sc.includes("고")) return "고등관";
  if (gl.includes("중") || sc.includes("중")) return "중등관";
  return "";
};

const ms = students.filter((s: any) => guessHall(s) === "중등관");
const hs = students.filter((s: any) => guessHall(s) === "고등관");

const hallStudents = hall === "ms" ? ms : hs;
  const seatCount = hall === "ms" ? 16 : 43;

  const expectedHHMM = vacationMode ? "13:00" : "15:30";


      // seat -> student 매핑 (records에 seatNo가 저장되어 있다고 가정)
    const seatMap: Record<number, any> = {};

for (const s of hallStudents as any[]) {
  const seatNo = typeof (s as any).seatNo === "number" ? (s as any).seatNo : null;
  if (typeof seatNo === "number") seatMap[seatNo] = s;
}

      const SeatGrid = () => (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(10, 1fr)", // 한 화면에 많이 보이게(40석이면 10x4 느낌)
            gap: 6,
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 10,
            background: "#fff",
            marginBottom: 12,
          }}
        >
          {Array.from({ length: seatCount }).map((_, i) => {
            const no = i + 1;
            const s = seatMap[no];
            const rec = s ? (records?.[s.id] || {}) : null;
            if (s) {
            console.log("REC", s.id, rec);
            }
     const inTime =
  rec?.time || rec?.checkInTime || rec?.inTime || rec?.in || "";

const outTime =
  rec?.outTime || rec?.out || "";
const segs = Array.isArray(rec?.segments) ? rec.segments : [];
const currentSeg = segs.find((x: any) => !x?.end);
const subjectMap: Record<string, string> = {
  MATH: "수학",
  ENG: "영어",
  KOR: "국어",
  SCI: "과학",
  SOC: "사회",
};

const currentSubject = currentSeg?.type
  ? subjectMap[currentSeg.type] || currentSeg.type
  : null;

  const acadArr = Array.isArray(s?.academyBlocks) ? s.academyBlocks : [];
const lastAcad = acadArr.at(-1) ?? null;

const expected =  expectedHHMM; // 학원 끝시간 없으면 기본 기대시간
const acadName = lastAcad?.label || lastAcad?.title || lastAcad?.name || "";
const acadEnd = lastAcad?.endHHMM || lastAcad?.end || ""; // ✅ 표시용
const expectedMin = toMin(expected || "");
const now = new Date();
const nowMin = now.getHours() * 60 + now.getMinutes();

const isAbsent = rec?.status === "absent";

const lateByNoShow =
  !!s && !inTime && expectedMin != null && nowMin > expectedMin + 15;

const lateByCheckin =
  !!s && !!inTime && isLate15(expected || "", inTime);

const late = !isAbsent && (lateByNoShow || lateByCheckin);

const weeklyLate = s ? getWeeklyLateCount(s.id) : 0;

            return (
              <div
                key={no}
                style={{
                 
                  borderRadius: 10,
                  padding: 8,
                  minHeight: 56,
                 background: isAbsent ? "#e0f2fe" : late ? "#ffe4e6" : "#fafafa",
border: isAbsent ? "1px solid #60a5fa" : late ? "1px solid #fb7185" : "1px solid #ddd",
                  position: "relative",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.8 }}>
                  {no}번
                </div>
              <div style={{ fontSize: 11, marginTop: 2 }}>
 {inTime ? (
  <span style={{ color: "#2563eb", fontWeight: 600 }}>
    등원 {inTime}
  </span>
) : (
  <span style={{ color: "#9ca3af" }}>
    미체크인
  </span>
)}

{outTime && (
  <span style={{ color: "#16a34a", fontWeight: 600 }}>
    {" · "}하원 {outTime}
  </span>
)}

  {late && (
    <span style={{ color: "#ef4444", fontWeight: 700 }}>
      {" "}· 지각
    </span>
  )}
  {currentSeg && (
  <div style={{ fontSize: 10, marginTop: 2, color: "#7c3aed", fontWeight: 600 }}>
    📚 {currentSeg.type} 진행중
  </div>
  )}
</div>

               {s ? (
  <>
    {/* 이름 */}
    <div
      style={{
        fontSize: 12,
        fontWeight: late ? 900 : 700,
        marginTop: 2,
        color: isAbsent ? "#2563eb" : late ? "#f97316" : "#111",
      }}
    >
      {(s as any).name}
    </div>

    {/* ✅ 학원 + 끝시간 (여기 추가) */}
  
  <div style={{ fontSize: 10, opacity: 0.7 }}>
  {acadName || "-"}
  {acadEnd ? ` · ${acadEnd}` : ""}
</div>
   

 
                    
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        style={{ ...btn, padding: "4px 6px", fontSize: 11 }}
                       onClick={() => setStatus(s.id, "")}
title="지각 해제"
                      >
                        해제
                      </button>

                      <button
                        style={{ ...btn, padding: "4px 6px", fontSize: 11 }}
                        onClick={() => setStatus(s.id, "late")}
                      disabled={!late && !!inTime}
                        title="15분 초과면 지각 처리"
                      >
                        지각
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>
                    비어있음
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );

      const StudentList = ({ title, list }: { title: string; list: any[] }) => (
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fff" }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>{title} ({list.length})</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
            {list.map((s) => {
              const rec = records?.[s.id] || {};
            const actual =
  rec?.time || rec?.checkInTime || rec?.inTime || rec?.in || "";
              const seatNo = rec?.seatNo;
              const late = isLate15(expectedHHMM, actual) 

              return (
                <div
                  key={s.id}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 12,
                    padding: 10,
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>
                      {s.name} {typeof seatNo === "number" ? `· ${seatNo}번` : "· 좌석없음"}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                      기대 {expectedHHMM} / 실제 {actual || "-"} {late ? "· 지각" : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select
                      value={typeof seatNo === "number" ? seatNo : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSeatNo(s.id, v ? Number(v) : null);
                      }}
                      style={{ ...btn, padding: "6px 8px", fontSize: 12 }}
                      title="좌석 지정"
                    >
                      <option value="">좌석</option>
                      {Array.from({ length: seatCount }).map((_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>

                    <button
                      style={{ ...btn, padding: "6px 8px", fontSize: 12 }}
                      onClick={() => setStatus(s.id, "late")}
                      disabled={!late && !!actual}
                      title="15분 초과면 지각 처리"
                    >
                      지각
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );

      return (
        <>
          {/* ✅ 한 화면에 좌석(최대 59까지) 먼저 보이게 */}
          <SeatGrid />

          {/* ✅ 중등 왼쪽 / 고등 오른쪽 */}
         
        </>
      );
    })()}
  </div>
)}
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  zIndex: 9999,
};

const modal: React.CSSProperties = {
  width: "100vw",
  height: "100vh",              // ✅ 원래대로 (화면 스크롤 구조 유지)
  background: "#fff",
  display: "flex",
  flexDirection: "column",
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 14px",
  borderBottom: "1px solid #eee",
  flex: "0 0 auto",
};

const tabs: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "10px 12px",
  borderBottom: "1px solid #eee",
  flex: "0 0 auto",
};

const content: React.CSSProperties = {
  padding: 12,
  flex: "1 1 auto",
  overflow: "auto",            // ✅ 화면 스크롤 살림 (중요)
  minHeight: 0,
};

const btn: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#fff",
  cursor: "pointer",
};

const tabBtn: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 999,
  padding: "8px 12px",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
};

const tabOn: React.CSSProperties = {
  borderColor: "#111",
};

// 🎨 파스텔 버튼 세트
const pastelBase: React.CSSProperties = {
  borderRadius: 999,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 700,
  border: "1px solid rgba(0,0,0,0.05)",
  cursor: "pointer",
  transition: "all 0.2s ease",
  whiteSpace: "nowrap",
};

const pastelBlue = {
  background: "#e8f0ff",
  color: "#2b3a67",
};

const pastelBlueOn = {
  background: "#eff0ba",
  color: "#1f2a4d",
};

const pastelPink = {
  background: "#faeef1",
  color: "#7a3b4b",
};

const pastelPinkOn = {
  background: "#eff0ba",
  color: "#5c2635",
};

const pastelGold = {
  background: "#fff4dc",
  color: "#7a5c1c",
};