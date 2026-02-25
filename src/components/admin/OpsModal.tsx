// src/components/admin/OpsModal.tsx
import React, { useEffect, useMemo, useState } from "react"; 
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

const CabinetIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="6" y="4" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
    <circle cx="15.5" cy="12" r="1" fill="currentColor" />
    <path d="M12 4v16" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
  </svg>
);

type StatusKey = "P" | "L" | "A" | "E";

const STATUS: Record<StatusKey, { label: string; short: string }> = {
  P: { label: "출석", short: "출" },
  L: { label: "지각", short: "지" },
  A: { label: "결석", short: "결" },
  E: { label: "조퇴", short: "조" },
};

function renderStatusText(status?: string, comment?: string) {
  const s = (status || "P") as StatusKey;
  const label = STATUS[s]?.label ?? "출석";
  const c = (comment || "").trim();

  // ✅ 결석일 때만 사유를 같이 보여줌
  if (s === "A" && c) return `${label}(${c})`;
  return label;
}
function renderEduStatusText(status?: string, comment?: string) {
  const s = String(status || "");
  const c = String(comment || "").trim();

  const isAbsent = s === "absent" || s === "A";
  const isLate = s === "late" || s === "L";
  const isOk = s === "ok" || s === "P";

  const label = isAbsent ? "결석" : isLate ? "지각" : isOk ? "출석" : "";

  if (isAbsent && c) return `${label}(${c})`;
  return label;
}

type CanonStatus = "ok" | "late" | "absent" | "";

function canonStatus(raw: any): CanonStatus {
  const s = String(raw || "").trim();

  if (s === "A" || s === "absent") return "absent";
  if (s === "L" || s === "late") return "late";
  if (s === "P" || s === "ok") return "ok";
  return "";
}

function isAbsentStatus(raw: any) {
  return canonStatus(raw) === "absent";
}
function isLateStatus(raw: any) {
  return canonStatus(raw) === "late";
}

export default function OpsModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<"timetable" | "attendance">("timetable");
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [records, setRecords] = useState<Record<string, any>>({});
  const [hall, setHall] = useState<"ms" | "hs">("ms");
  const [vacationMode, setVacationMode] = useState(true);
  const [filterType, setFilterType] = useState<"none" | "noShow" | "noReturn">("none");
  // "HH:MM" -> minutes
  const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(aStart, bStart) < Math.min(aEnd, bEnd);

// ✅ 13:00~13:15(또는 expectedHHMM~expectedHHMM+15) 사이에 학원블록이 있으면 면책
const hasAcademyDuringLateWindow = (s: any, expectedHHMM: string) => {
  const acadArr = Array.isArray(s?.academyBlocks) ? s.academyBlocks : [];
  const todayBlocks = pickTodayAcademyBlocks(acadArr);

  const winStart = toMin(expectedHHMM);
  const winEnd = winStart != null ? winStart + 15 : null;
  if (winStart == null || winEnd == null) return false;

  return (todayBlocks || []).some((b: any) => {
    const st = toMin(b?.start || b?.startHHMM);
    const en = toMin(b?.end || b?.endHHMM);
    if (st == null || en == null) return false;

    // ✅ 학원 판별(너 블록들은 이미 academyBlocks라서 사실 이 조건 없어도 됨)
    return overlaps(st, en, winStart, winEnd);
  });
};
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

 // ✅ 상단 뱃지용: 미등원/미복귀 리스트 (중/고 합쳐서)


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
  });

const now = new Date();            // ✅ Date 객체
const isSunday = now.getDay() === 0;

const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, "0");
const dd = String(now.getDate()).padStart(2, "0");
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
    // ✅ 일요일엔 지각 자동체크(저장) 자체를 안함
    if (new Date().getDay() === 0) return;

    students.forEach(async (s) => {
      const rec = records?.[s.id] || {};
      const actual = rec?.time || rec?.checkInTime || rec?.inTime || rec?.in || "";
      if (actual) return;

      const expected = getLastAcademyEnd(s);
      const expectedMin = toMin(expected || "");
      if (!expectedMin) return;

      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

      // ✅ 학원 가는 애는 late 저장 금지
      const exemptLate = hasAcademyDuringLateWindow(
        s,
        vacationMode ? "13:00" : "15:30"
      );
      if (exemptLate) return;

     const isAbsent =
  rec?.status === "absent" || rec?.status === "A";
const hasReason = (rec?.comment || "").trim().length > 0;

// ✅ 결석/사유 있으면 late 자동저장 금지
if (isAbsent || hasReason) return;

if (!actual && nowMin - expectedMin > 15 && rec?.status !== "late") {
  await setStatus(s.id, "late");
}
    });
  }, 60000);

  return () => clearInterval(interval);
}, [students, records, vacationMode]); // ✅ 이거 추가

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
// ✅ 요일키 (sun~sat)
const dowKey = () => {
  const d = new Date().getDay();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d];
};

// ✅ 오늘 요일에 해당하는 학원 블록만
const pickTodayAcademyBlocks = (acadArr: any[]) => {
 const todayKey = dowKey();
return (acadArr || []).filter((b) => String(b?.day || "").toLowerCase() === todayKey);
};

// ✅ 블록 중 현재 진행중(현재 시간이 start~end 사이)
const pickCurrentBlock = (blocks: any[]) => {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const toMin2 = (t?: string) => {
    const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };

  return (
    (blocks || []).find((b) => {
      const s = toMin2(b?.start || b?.startHHMM);
      const e = toMin2(b?.end || b?.endHHMM);
      if (s == null || e == null) return false;
      return nowMin >= s && nowMin <= e;
    }) || null
  );
};

// ✅ 오늘 마지막 학원(없으면 null)
const pickLastBlock = (blocks: any[]) => (blocks?.length ? blocks[blocks.length - 1] : null);

// ✅ records.segments 에서 “끝나지 않은” 마지막 세그먼트 찾기
const pickCurrentSeg = (rec: any) => {
  const segArr = Array.isArray(rec?.segments) ? rec.segments : [];
  return [...segArr]
    .reverse()
    .find((x) => !x?.endAt && !x?.endedAt && !x?.endTime && !x?.end) || null;
};
// ✅ 마지막으로 "끝난" 세그먼트 가져오기 (없으면 null)
const pickLastEndedSeg = (rec: any) => {
  const segArr = Array.isArray(rec?.segments) ? rec.segments : [];
  const ended = segArr
    .filter((x: any) => x?.endAt || x?.endedAt || x?.endTime || x?.end)
    .sort((a: any, b: any) => {
      const ta = new Date(a.endAt || a.endedAt || a.endTime || a.end).getTime();
      const tb = new Date(b.endAt || b.endedAt || b.endTime || b.end).getTime();
      return tb - ta;
    });
  return ended[0] || null;
};

const isAcademySeg = (seg: any) => {
  const label = String(seg?.label || seg?.title || seg?.subject || seg?.type || "").toLowerCase();
  return label.includes("academy") || label.includes("학원");
};

const minutesSinceSegEnd = (seg: any) => {
  const end = seg?.endAt || seg?.endedAt || seg?.endTime || seg?.end;
  if (!end) return null;
  const tEnd = new Date(end).getTime();
  if (!Number.isFinite(tEnd)) return null;
  const diffMin = Math.floor((Date.now() - tEnd) / 60000);
  return diffMin;
};

const { noShowList, noReturnList } = useMemo(() => {
  const isSunday = new Date().getDay() === 0;

  const expectedHHMM = vacationMode ? "13:00" : "15:30";
  const expectedMin = toMin(expectedHHMM || "");

  const calcNoShow = () => {
    if (isSunday) return [];
    if (expectedMin == null) return [];

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    return students.filter((s: any) => {
      const rec = records?.[s.id] || {};
      const inTime = rec?.time || rec?.checkInTime || rec?.inTime || rec?.in || "";
     const isAbsent =
  rec?.status === "absent" || rec?.status === "A";
      return !isAbsent && !inTime && nowMin > expectedMin + 15;
    });
  };

  const calcNoReturn = () => {
    return students.filter((s: any) => {
      const rec = records?.[s.id] || {};
      const currentSeg = pickCurrentSeg(rec);
      const lastEnded = pickLastEndedSeg(rec);

      const endedAcademy = lastEnded && isAcademySeg(lastEnded);
      const afterAcademyMin = endedAcademy ? minutesSinceSegEnd(lastEnded) : null;

      const returnLate15 =
        endedAcademy && !currentSeg && afterAcademyMin != null && afterAcademyMin > 15;

      return (
        returnLate15 ||
        !!rec?.returnLate ||
        (typeof rec?.returnLateMin === "number" && rec.returnLateMin > 15)
      );
    });
  };

  return {
    noShowList: calcNoShow(),
    noReturnList: calcNoReturn(),
  };
}, [students, records, vacationMode]);

const segLabelOf = (seg: any) =>
  String(seg?.label || seg?.title || seg?.subject || seg?.type || "").trim();
  if (!open) return null;

  const scrollToStudent = (studentId: string) => {
  const el = document.getElementById(`seat-${studentId}`);
  if (el) {
    el.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }
};

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
  고등관(47)
</button>
            </>
          )}
        </div>

       {/* 오른쪽: 공통 버튼 */}
<div style={{ display: "flex", gap: 8, alignItems: "center" }}>

  {/* 방학모드 */}
  <button
    onClick={() => setVacationMode((v) => !v)}
    style={{
      ...pastelBase,
      ...pastelGold,
    }}
  >
    {vacationMode ? "방학 모드 ON" : "방학 모드 OFF"}
  </button>

{/* 출결 탭일 때만 */}
{tab === "attendance" && (
  <>
    {/* 미등원 + 팝업 */}
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setFilterType(filterType === "noShow" ? "none" : "noShow")}
        style={{
          ...pastelBase,
          background: filterType === "noShow" ? "#fee2e2" : "#f1f5f9",
        }}
      >
        미등원 {noShowList.length}
      </button>

      {filterType === "noShow" && (
        <div
          style={{
            position: "absolute",
            top: 46,
            right: 0,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 10,
            minWidth: 180,
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            zIndex: 999,
          }}
        >
          {noShowList.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.6 }}>없음</div>
          ) : (
            noShowList.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  scrollToStudent(s.id);
                  setFilterType("none"); // ✅ 클릭하면 닫히게(원하면 빼)
                }}
                style={{
                  padding: "6px 8px",
                  cursor: "pointer",
                  borderRadius: 8,
                  fontSize: 13,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {s.name}
              </div>
              
            ))
          )}
        </div>
        
      )}
    </div>

    {/* 미복귀 + 팝업 */}
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setFilterType(filterType === "noReturn" ? "none" : "noReturn")}
        style={{
          ...pastelBase,
          background: filterType === "noReturn" ? "#fef3c7" : "#f1f5f9",
        }}
      >
        미복귀 {noReturnList.length}
      </button>

      {filterType === "noReturn" && (
        <div
          style={{
            position: "absolute",
            top: 46,
            right: 0,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 10,
            minWidth: 180,
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            zIndex: 999,
          }}
        >
          {noReturnList.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.6 }}>없음</div>
          ) : (
            noReturnList.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  scrollToStudent(s.id);
                  setFilterType("none"); // ✅ 클릭하면 닫히게(원하면 빼)
                }}
                style={{
                  padding: "6px 8px",
                  cursor: "pointer",
                  borderRadius: 8,
                  fontSize: 13,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {s.name}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  </>
)}

  {/* 프린트 */}
  <button
    onClick={() => window.print()}
    style={{
      ...pastelBase,
      background: "#ffffff",
    }}
  >
    프린트
  </button>

  {/* 닫기 */}
  <button
    onClick={onClose}
    style={{
      ...pastelBase,
      background: "#ffffff",
    }}
  >
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
  <div style={{ padding: 12, width: "100%" }}>

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
  const seatCount = hall === "ms" ? 16 : 47;

const expectedHHMM = vacationMode ? "13:00" : "15:30";

// ✅ 중등 16석: 너가 그린 가로 2줄 + 가운데 door 기둥
const seatLayout16Rows: (number | "door")[][] = [
  [16, 15, 14, 13, "door", 12, 11, 10, 9],
  [8, 7, 6, 5, "door", 4, 3, 2, 1],
];
type Cell = number | "aisle" | "pillar" | "door" | "blank"; 

const hsLayoutRows: Cell[][] = [
  [-1,1,2,3,4,5,6,7],
  ["aisle"],
  [8,9,10,11,12,13,14,15],
  [16,17,18,19,20,21,22,23],
  ["aisle"],
  [24,25,26,27,28,29,30,31],
  [32,33,34,35,36,37,38,39],
  ["aisle"],
  [40,41,42,43,44,45,46,47],
];

// seat -> student 매핑
const seatMap: Record<number, any> = {};
for (const s of hallStudents as any[]) {
  const seatNo = typeof (s as any).seatNo === "number" ? (s as any).seatNo : null;
  if (typeof seatNo === "number") seatMap[seatNo] = s;
}
const isCabinetSeat = (no: number) => no >= 32; // ✅ 32~47
const SeatGrid = () => {
  // ✅ 고등(또는 다른 관)은 기존처럼 1~seatCount 뿌리기
// ✅ 고등관(47) 도면형 렌더
if (hall === "hs") {
  const COLS = 8;     // 7개 줄 + 빈칸 1개
  const CARD_W = 155; // 필요하면 더 줄여
  const CARD_H = "auto";
  const GAP = 8;

  // ✅ 32~47 구분(문달린 1인용 책장)
  const isLockerSeat = (no: number) => no >= 32;

const renderSeatCard = (no: number) => {
  const s = seatMap[no];
  const rec = s ? (records?.[s.id] || {}) : null;
  const statusRaw = rec?.status;
const commentText = String(rec?.comment ?? "").trim();

  // ===== 세그먼트 기반(복귀 15분) =====
  const currentSeg = pickCurrentSeg(rec);
  const lastEnded = pickLastEndedSeg(rec);

  const endedAcademy = lastEnded && isAcademySeg(lastEnded);
  const afterAcademyMin = endedAcademy ? minutesSinceSegEnd(lastEnded) : null;

  const returnLate15 =
    !!s &&
    endedAcademy &&
    !currentSeg &&
    afterAcademyMin != null &&
    afterAcademyMin > 15;

  const segLabel = segLabelOf(currentSeg);

  // ===== 출결/지각(일요일 제외) =====
  const isSunday = new Date().getDay() === 0;

  const inTime = rec?.time || rec?.checkInTime || rec?.inTime || rec?.in || "";
  const outTime = rec?.outTime || rec?.out || "";

 const st = canonStatus(rec?.status);
const isAbsent = st === "absent";
const isLate = st === "late";

  const expectedMin = toMin(expectedHHMM || "");
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const exemptLate = hasAcademyDuringLateWindow(s, expectedHHMM);

 const lateByNoShow =
  !!s && !exemptLate && !inTime && expectedMin != null && nowMin > expectedMin + 15;

  const lateByCheckin =
  !!s && !exemptLate && !!inTime && isLate15(expectedHHMM || "", inTime);

 const eduLate =
  !isAbsent &&
  (isLate || lateByNoShow || lateByCheckin);

const showLate = !isSunday && eduLate;

  // ===== 기타 플래그 =====
  const locker = isLockerSeat(no);

  const returnLateFlag =
    returnLate15 ||
    !!rec?.returnLate ||
    (typeof rec?.returnLateMin === "number" && rec.returnLateMin > 15);
const cabinet = isCabinetSeat(no);
  // ===== 색상(지각은 showLate 기준!) =====
 const bg =
  isAbsent ? "#dbeafe" :
  returnLateFlag ? "#fef3c7" :
  showLate ? "#fee2e2" :
  cabinet ? "#eddec0" :   // ✅ 1인책장 연두
  "#f8fafc";

const bd =
  isAbsent ? "2px solid #2563eb" :
  returnLateFlag ? "2px solid #f59e0b" :
  showLate ? "2px solid #dc2626" :
  cabinet ? "2px solid #84cc16" :  // ✅ 1인책장 테두리 강조
  "1px solid #e2e8f0";

  // ===== 1인책장(extraStyle) =====
  
  const extraStyle: React.CSSProperties = cabinet
    ? {
        border: "2px solid #d89b17",
        boxShadow: "inset 0 0 0 1px rgba(216, 231, 109, 0.15)",
        background: bg,
      }
    : {};

  // ===== 오늘 학원 블록 =====
  const acadArr = Array.isArray(s?.academyBlocks) ? s.academyBlocks : [];
  const todayBlocks = pickTodayAcademyBlocks(acadArr);

  const currentAcad = pickCurrentBlock(todayBlocks);
  const lastTodayAcad = pickLastBlock(todayBlocks);

  const acadName =
    currentAcad?.label ||
    currentAcad?.title ||
    currentAcad?.name ||
    currentAcad?.subject ||
    "학원";

  const acadStart =
    currentAcad?.start || currentAcad?.startHHMM ||
    lastTodayAcad?.start || lastTodayAcad?.startHHMM || "";

  const acadEnd =
    currentAcad?.end || currentAcad?.endHHMM ||
    lastTodayAcad?.end || lastTodayAcad?.endHHMM || "";

   return (
  <div
  
  key={no}
  id={s ? `seat-${s.id}` : undefined}
    style={{
      borderRadius: 12,
      padding: 8,
      height: CARD_H,
      background: bg,
      border: bd,
      overflow: "hidden",
      position: "relative",
      
      ...extraStyle,
    }}
  >
    {returnLateFlag && (
  <div
    style={{
      position: "absolute",
      top: 6,
      left: 8,
      background: "#f59e0b",
      color: "#fff",
      fontSize: 10,
      fontWeight: 900,
      padding: "2px 6px",
      borderRadius: 8,
    }}
  >
    15분 복귀X
  </div>
)}
   
{/* 1줄: 번호 + 상태 */}
<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
  <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.85 }}>
   {no}번
{isCabinetSeat(no) && " · [1인책장]"}
  </div>

  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    {isSunday && (
      <div style={{ fontSize: 12, fontWeight: 900, color: "#9d2182", opacity: 0.75 }}>
        자율
      </div>
    )}

    {showLate && (
      <div style={{ fontSize: 12, fontWeight: 900, color: "#ef4444" }}>
        지각
      </div>
    )}
  </div>
</div>

    {s ? (
      <>
        {/* 2줄: 이름 */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 900,
            marginTop: 4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {s.name}
        </div>
        {(() => {
 
  return null;
})()}

   {isAbsent && commentText && (
  <div
    style={{
      marginTop: 4,
      fontSize: 11,
      fontWeight: 900,
      color: "#37a22b",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    }}
    title={renderEduStatusText(statusRaw, commentText)}
  >
    {renderEduStatusText(statusRaw, commentText)}
  </div>
)}

        {/* 3줄: 등/하원 */}
        <div style={{ fontSize: 11, marginTop: 4 }}>
  {inTime ? (
    <span style={{ color: "#4978df", fontWeight: 700 }}>등원 {inTime}</span>
  ) : (
    <span style={{ color: "#e69215" }}>미체크인</span>
  )}

  {outTime && (
    <span style={{ color: "#16a34a", fontWeight: 700 }}>
      {" · "}하원 {outTime}
    </span>
  )}

  {showLate && (
  <span style={{ color: "#f52a2a", fontWeight: 800 }}>
    {" · "}지각
  </span>
)}
</div>
{currentSeg && (
  <div
    style={{
      fontSize: 11,
      fontWeight: 900,
      marginTop: 4,
      color: "#7c3aed",
    }}
  >
    ▶ {segLabel || "진행중"}
  </div>
)}
        {/* 4줄: 마지막 학원 */}
        {acadName && (
          <div
            style={{
              fontSize: 10,
              opacity: 0.7,
              marginTop: 4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {acadName}
            {acadEnd ? ` · ${acadEnd}` : ""}
          </div>
        )}
     {(todayBlocks || []).map((b: any, i: number) => {
  const sub = b?.subject || b?.label;
  const st = b?.start;
  const en = b?.end;

  if (!sub) return null;

  const isCurrent =
    currentAcad &&
    currentAcad.start === b.start &&
    currentAcad.end === b.end;

  return (
    <div
      key={i}
      style={{
        fontSize: 11,
        marginTop: 2,
        color: isCurrent ? "#e76f2e" : "#3a3e43",
        fontWeight: isCurrent ? 900 : 600
      }}
    >
      {isCurrent && "▶ "}
      {sub} {st}-{en}
    </div>
  );
})}
      </>
    ) : (
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 18 }}>비어있음</div>
    )}
  </div>
);
  };
let aisleSeen = 0;

return (
  <div
    style={{
      position: "relative",
      paddingLeft: 90,          // ✅ 왼쪽 출입문 영역 확보 (60~90 조절)
      width: "fit-content",
      margin: "0 auto",
    }}
  >
    {/* ✅ 왼쪽 세로 "출입문" */}
    <div
      style={{
        position: "absolute",
        left: 18,
        top: 24,                // ✅ 시작 높이 (원하면 18~40 조절)
        fontWeight: 900,
        fontSize: 18,
        color: "#111827",
        letterSpacing: 2,
        lineHeight: 1.05,
        opacity: 0.85,
        userSelect: "none",
      }}
    >
      출<br />입<br />문
    </div>

    {/* ✅ 기존 그리드 */}
    <div
      style={{
        border: "1px solid #eee",
        borderRadius: 12,
        padding: 10,
        background: "#fff",
        marginBottom: 12,
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, ${CARD_W}px)`,
        gap: GAP,
        justifyContent: "center",
        overflow: "hidden",
        maxWidth: "100%",
      }}
    >
      {hsLayoutRows.flatMap((row, rIdx) => {
        // ✅ 복도
        if (row.length === 1 && row[0] === "aisle") {
          aisleSeen += 1;
          const isFirstAisle = aisleSeen === 1; // ✅ 1~7 아래 복도만 문

          return [
            <div
              key={`aisle-${rIdx}`}
              style={{
                gridColumn: `1 / span ${COLS}`,
                height: 28,
                borderRadius: 999,
                background: "#f2f3db",
                border: "1px dashed #cbd5e1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                fontSize: 10,
                fontWeight: 900,
                color: "#393c3f",
              }}
            >
              {/* ✅ 첫 복도에만 왼쪽 "🚪 출입문" 뱃지 */}
              {isFirstAisle && (
                <div
                  style={{
                    position: "absolute",
                    left: -64, // ✅ 복도 왼쪽 바깥으로 빼기 (원하면 -70)
                    top: "50%",
                    transform: "translateY(-50%)",
                    height: 22,
                    padding: "0 10px",
                    borderRadius: 999,
                    background: "#fff7ed",
                    border: "2px solid #fdba74",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 900,
                    color: "#9a3412",
                    whiteSpace: "nowrap",
                    userSelect: "none",
                  }}
                >
                  🚪 출입문
                </div>
              )}

              복도
            </div>,
          ];
        }

        // ✅ 일반 줄: row에 -1 들어있으면 그대로 살리기
        const filled = [...row];

        // 8열 맞추기: 부족하면 -1로 채움
        while (filled.length < COLS) filled.push(-1 as any);

        return filled.map((cell, i) => {
          // ✅ 빈칸(-1)
          if (cell === -1) {
            return (
              <div
                key={`gap-${rIdx}-${i}`}
                style={{ width: CARD_W, height: CARD_H, opacity: 0 }}
              />
            );
          }

          // ✅ 숫자 좌석만 렌더
          if (typeof cell === "number") return renderSeatCard(cell);

          // ✅ 혹시 나중에 "blank" 문자열도 쓰면 대응 (선택)
          if (cell === "blank") {
            return (
              <div
                key={`blank-${rIdx}-${i}`}
                style={{ width: CARD_W, height: CARD_H, opacity: 0 }}
              />
            );
          }

          return null;
        });
      })}
    </div>
  </div>
);
}
  // ✅ ======= 중등(ms) 전용: 9열(door 포함) + 2행 =======
 return (
  <div
    style={{
      width: "100%",
      overflowX: "auto",
      overflowY: "hidden",
      paddingBottom: 8,
      WebkitOverflowScrolling: "touch",
    }}
  >
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(9, 155px)", // ✅ 9열 고정
       justifyContent: "center",
        gap: 10,
        border: "1px solid #eee",
        borderRadius: 12,
        padding: 10,
        background: "#fcfcf9",
        marginBottom: 12,
       
      }}
    >
      {seatLayout16Rows.map((row, r) =>
        row.map((cell, c) => {
          // ✅ door는 “윗줄에서 한 번만” 그리고 세로 2칸(span 2)
          if (cell === "door") {
            if (r !== 0) return null;

            return (
              <div
                key="door"
                style={{
  gridColumn: c + 1,
  gridRow: "1 / span 2",
  borderRadius: 12,
  background: "#f3f4f6",
  border: "2px dashed #cbd5e1",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 900,
  color: "#3a3e43",

  // ✅ 여기 추가
  height: 50,          // <- 숫자 줄이면 더 낮아짐 (예: 130)
  alignSelf: "end",  // ✅ 칸(2줄) 안에서 세로 가운데
}}
              >
                door
              </div>
            );
          }

          const no = cell as number;
          const s = seatMap[no];
          const rec = s ? records?.[s.id] || {} : null;
          const statusRaw = rec?.status;
const commentText = String(rec?.comment ?? "").trim();

          const currentSeg = pickCurrentSeg(rec);
          const lastEnded = pickLastEndedSeg(rec);
const endedAcademy = lastEnded && isAcademySeg(lastEnded);
const afterAcademyMin = endedAcademy ? minutesSinceSegEnd(lastEnded) : null;

// ✅ 학원 끝났는데 지금 세그먼트(복귀)가 없고, 15분 넘었다
const returnLate15 =
  !!s &&
  endedAcademy &&
  !currentSeg &&
  afterAcademyMin != null &&
  afterAcademyMin > 15;
const segLabel = segLabelOf(currentSeg);



// ======= 여기부터 너 기존 카드 로직 그대로 =======
const inTime = rec?.time || rec?.checkInTime || rec?.inTime || rec?.in || "";
const outTime = rec?.outTime || rec?.out || "";

const expectedMin = toMin(expectedHHMM || "");
const now = new Date();
const nowMin = now.getHours() * 60 + now.getMinutes();

const st = canonStatus(rec?.status);
const isAbsent = st === "absent";
const isLate = st === "late";
const exemptLate = hasAcademyDuringLateWindow(s, expectedHHMM);

const lateByNoShow =
  !!s && !exemptLate && !inTime && expectedMin != null && nowMin > expectedMin + 15;

const lateByCheckin =
  !!s && !exemptLate && !!inTime && isLate15(expectedHHMM || "", inTime);
const isSunday = new Date().getDay() === 0;
// ✅ 1) eduLate 먼저!
const eduLate =
  !isAbsent &&
  (isLate || lateByNoShow || lateByCheckin);

const showLate = !isSunday && eduLate;

// ✅ 2) 그 다음 late / 일요일 제어



// ✅ 3) 복귀 15분 미만(세그먼트 기준) 플래그는 여기 그대로
const returnLateFlag =
  returnLate15 ||
  !!rec?.returnLate ||
  (typeof rec?.returnLateMin === "number" && rec.returnLateMin > 15);

// ✅ 4) 색상도 showLate 기준으로(일요일엔 지각색 안 먹게)
const bg =
  isAbsent ? "#e0f2fe" :
  returnLateFlag ? "#fff7ed" :
  showLate ? "#ffe4e6" :
  "#fafafa";

const bd =
  isAbsent ? "1px solid #60a5fa" :
  returnLateFlag ? "1px solid #fdba74" :
  showLate ? "1px solid #fb7185" :
  "1px solid #ddd";

   const acadArr = Array.isArray(s?.academyBlocks) ? s.academyBlocks : [];

// ✅ 오늘 요일에 해당하는 블록만
const todayBlocks = pickTodayAcademyBlocks(acadArr);


// ✅ 지금 시간에 걸린 “진행중 학원” (없으면 null)
const currentAcad = pickCurrentBlock(todayBlocks);

// ✅ 오늘 마지막 학원(없으면 null)
const lastTodayAcad = pickLastBlock(todayBlocks);

const acadName =
  currentAcad?.label ||
  currentAcad?.title ||
  currentAcad?.name ||
  currentAcad?.subject ||
  "학원";

const acadStart =
  currentAcad?.start || currentAcad?.startHHMM ||
  lastTodayAcad?.start || lastTodayAcad?.startHHMM || "";

const acadEnd =
  currentAcad?.end || currentAcad?.endHHMM ||
  lastTodayAcad?.end || lastTodayAcad?.endHHMM || "";

        

          return (
           <div
  key={no}
  id={s ? `seat-${s.id}` : undefined}
             style={{
  borderRadius: 10,
  padding: 8,
  width: 155,
  minHeight: 130,
  position: "relative",
  background: bg,
  border: bd,
}}
            >
             {returnLateFlag && (
  <div
    style={{
      position: "absolute",
      top: 6,
      left: 8,
      background: "#f59e0b",
      color: "#fff",
      fontSize: 10,
      fontWeight: 900,
      padding: "2px 6px",
      borderRadius: 8,
    }}
  >
    15분 복귀X
  </div>
)}

{/* 1줄: 번호 + 상태(우측) */}
<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
  <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.85 }}>
    {no}번
  </div>

  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    {isSunday && (
      <div style={{ fontSize: 12, fontWeight: 800, color: "#9d2182", opacity: 0.75 }}>
        자율
      </div>
    )}

    {showLate && (
      <div style={{ fontSize: 12, fontWeight: 900, color: "#f52a2a" }}>
        지각
      </div>
    )}
  </div>
</div>

{s ? (
  <>
    {/* 2줄: 이름 */}
    <div
      style={{
        fontSize: 13,
        fontWeight: 900,
        marginTop: 4,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {s.name}
    </div>
    {(() => {
  
  return null;
})()}

   {isAbsent && commentText && (
  <div
    style={{
      marginTop: 4,
      fontSize: 11,
      fontWeight: 900,
      color: "#37a22b",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    }}
    title={renderEduStatusText(statusRaw, commentText)}
  >
    {renderEduStatusText(statusRaw, commentText)}
  </div>
)}

    {/* 3줄: 등/하원 */}
    <div style={{ fontSize: 11, marginTop: 4 }}>
      {inTime ? (
        <span style={{ color: "#2563eb", fontWeight: 700 }}>등원 {inTime}</span>
      ) : (
        <span style={{ color: "#e69215" }}>미체크인</span>
      )}

      {outTime && (
        <span style={{ color: "#16a34a", fontWeight: 700 }}>
          {" · "}하원 {outTime}
        </span>
      )}

      {showLate && (
        <span style={{ color: "#ef4444", fontWeight: 800 }}>
          {" · "}지각
        </span>
      )}
    </div>

    {/* 4줄: 진행중 세그먼트 */}
    {currentSeg && (
      <div
        style={{
          fontSize: 11,
          fontWeight: 900,
          marginTop: 4,
          color: "#e76f2e",
        }}
      >
        ▶ {segLabel || "진행중"}
      </div>
    )}

    {/* 5줄: 마지막 학원 */}
    {acadName && (
      <div
        style={{
          fontSize: 10,
          opacity: 0.7,
          marginTop: 4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {acadName}
        {acadEnd ? ` · ${acadEnd}` : ""}
      </div>
    )}

    {/* 6줄+: 오늘 학원 블록 리스트 */}
    {(todayBlocks || []).map((b: any, i: number) => {
      const sub = b?.subject || b?.label;
      const st = b?.start;
      const en = b?.end;
      if (!sub) return null;

      const isCurrent =
        currentAcad &&
        currentAcad.start === b.start &&
        currentAcad.end === b.end;

      return (
        <div
          key={i}
          style={{
            fontSize: 11,
            marginTop: 2,
            color: isCurrent ? "#7c3aed" : "#3a3e43",
            fontWeight: isCurrent ? 900 : 600,
          }}
        >
          {isCurrent && "▶ "}
          {sub} {st}-{en}
        </div>
      );
    })}
  </>
) : (
  <div style={{ fontSize: 11, opacity: 0.55, marginTop: 18 }}>비어있음</div>
)}
              
            </div>
             
          );
          // ======= 여기까지 =======
        })
      )}
    </div>
    </div>
  );
};
const isSundayTop = new Date().getDay() === 0;

// ✅ 미등원: 체크인 없고, (예상시간 + 15분) 지남 (일요일 제외)


      return (
  <>
  

    {/* ✅ 좌석 */}
    <SeatGrid />
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

 width: "100%",
  height: "100vh",
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