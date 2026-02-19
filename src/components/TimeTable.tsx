// src/components/TimeTable.tsx
import React, { useMemo } from "react";
import type { StudentLite, DayKey } from "../utils/scheduleEngine";
import {
  DAY_LABEL,
  buildTimeSlots,
  isInStudyHallAt,
  tinyName,
  academyBufferAt,
} from "../utils/scheduleEngine";

type Props = {
  students: StudentLite[];
  startHHMM?: string; // 기본 "13:00"
  endHHMM?: string;   // 기본 "22:00"
  stepMin?: number;   // 기본 30
  vacationMode?: boolean;
};

const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat"];

// ✅ "HH:MM" -> 분(min)
const hmToMin = (hm: string) => {
  const [h, m] = String(hm).split(":").map((v) => Number(v));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
};

export default function TimeTable({
  students,
  startHHMM = "13:00",
  endHHMM = "22:00",
  stepMin = 30,
  vacationMode = false,
}: Props) {
 console.log("blocks sample", students?.[0]?.blocks?.slice(0, 5));
  const slots = useMemo(
    () => buildTimeSlots(startHHMM, endHHMM, stepMin),
    [startHHMM, endHHMM, stepMin]
  );

  const isMS = (s: any) =>
  String(s.gradeLevel || "").includes("중") ||
  String(s.school || "").includes("중");

const isHS = (s: any) =>
  String(s.gradeLevel || "").includes("고") ||
  String(s.school || "").includes("고");

  const grid = useMemo(() => {
  const map: Record<string, StudentLite[]> = {};

  const visible = (students ?? []).filter((s: any) => {
    if (s?.status === "inactive") return false;
    if (s?.deleted) return false;
    return true;
  });

  for (const day of DAY_ORDER) {
    for (const slot of slots) {
      const key = `${day}|${slot}`;

     map[key] = visible
  .filter((s) => isInStudyHallAt(s.blocks ?? [], day, slot))
 .sort((a, b) => {
  const aa: any = a;
  const bb: any = b;

  const aIsMS =
    String(aa.gradeLevel || "").includes("중") ||
    String(aa.school || "").includes("중");

  const bIsMS =
    String(bb.gradeLevel || "").includes("중") ||
    String(bb.school || "").includes("중");

  if (aIsMS && !bIsMS) return -1;
  if (!aIsMS && bIsMS) return 1;
  return 0;
});
    }
  }

  return map;
}, [students, slots]);

  return (
    <div style={{ overflow: "auto" }}>
      <table style={table}>
        <thead>
          <tr>
            <th style={thTime}>시간</th>
            {DAY_ORDER.map((d) => (
              <th key={d} style={th}>
                {DAY_LABEL[d]}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {slots.map((slot) => (
            <tr key={slot}>
              <td style={tdTime}>{slot}</td>

              {DAY_ORDER.map((day) => {
                const list = grid[`${day}|${slot}`] ?? [];

                return (
                  <td key={day} style={td}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{list.length}명</div>
                      <div style={{ fontSize: 10, opacity: 0.6 }} />
                    </div>

                    <div style={namesWrap}>
                      {list.map((s) => {
                        // ✅ 방학모드면 버퍼 계산 굳이 필요 없는데, 있어도 문제 없음
                   

                       const buf = academyBufferAt(s.blocks, day, slot, 15);

const gradeBar: React.CSSProperties =
  isHS(s)
    ? { boxShadow: "inset 0 2px 0 #90abe8" }   // 고등: 파스텔 블루 얇은 라인
    : isMS(s)
    ? { boxShadow: "inset 0 2px 0 #ffe0a3" }   // 중등: 파스텔 골드 얇은 라인
    : {};

const chipStyle: React.CSSProperties = {
  ...nameChip,
  ...gradeBar,

  ...(buf === "BEFORE"
    ? { borderLeft: "4px solid #eb9706", background: "#FFF7ED" }
    : {}),
  ...(buf === "AFTER"
    ? { borderRight: "4px solid #f6673b", background: "#EFF6FF" }
    : {}),
};

                        return (
                          <span
                            key={s.id}
                            style={chipStyle}
                            title={
                              buf
                                ? `학원 ${buf === "BEFORE" ? "이동 예정(-15)" : "이동 후(+15)"}`
                                : ""
                            }
                          >
                            {tinyName(s.name)}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const th: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: "8px",
  textAlign: "center",
  background: "#fafafa",
  fontSize: 13,
};

const thTime: React.CSSProperties = {
  ...th,
  width: 90,
};

const td: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: "6px",
  verticalAlign: "top",
  height: 56,
};

const tdTime: React.CSSProperties = {
  ...td,
  fontWeight: 800,
  fontSize: 12,
  background: "#fcfcfc",
};

const namesWrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  marginTop: 6,
};

const nameChip: React.CSSProperties = {
  fontSize: 9,
  padding: "2px 4px",
  border: "1px solid #eee",
  borderRadius: 6,
  background: "#fff",
};