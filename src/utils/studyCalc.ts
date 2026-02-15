// src/utils/studyCalc.ts

export type SegmentType =
  | "MATH"
  | "ENGLISH"
  | "KOREAN"
  | "SCIENCE"
  | "OTHER_ACADEMY"
  | "MEAL"
  | "OUTING";

export type Segment = {
  type: SegmentType;
  start: string; // "HH:MM" or ISO
  end?: string | null; // "HH:MM" or ISO
};

function toHM(v: any): string | null {
  if (!v || typeof v !== "string") return null;
  if (v.includes("T")) {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (v.includes(":")) return v.slice(0, 5);
  return null;
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** 순공 */
export function calcNetStudyMin(rec: any): number {
  const inHM = toHM(rec?.time ?? rec?.inTime);
  const outHM = toHM(rec?.outTime);
  if (!inHM || !outHM) return 0;

  let total = hmToMin(outHM) - hmToMin(inHM);
  if (total <= 0) return 0;

  const segs: Segment[] | null = Array.isArray(rec?.segments) ? rec.segments : null;

  if (segs && segs.length > 0) {
    let external = 0;
    for (const s of segs) {
      const stHM = toHM(s?.start);
      const enHM = toHM(s?.end);
      if (!stHM || !enHM) continue;
      const st = hmToMin(stHM);
      const en = hmToMin(enHM);
      if (en > st) external += en - st;
    }
    total -= external;
  } else {
    const aIn = toHM(rec?.academyIn);
    const aOut = toHM(rec?.academyOut);
    if (aIn && aOut) {
      const diff = hmToMin(aOut) - hmToMin(aIn);
      if (diff > 0) total -= diff;
    }
  }

  return Math.max(0, total);
}

/** (호환용) */
export const calcNetStudyMin_SP = calcNetStudyMin;

/** 도넛/요약용: net + 외부합 + 학원합 */
export function calcBreakdown(rec: any): {
  net: number;
  short: number;
  academyOuting: number;
} {
  const segs: Segment[] = Array.isArray(rec?.segments) ? rec.segments : [];

  let short = 0;
  let academyOuting = 0;

  for (const s of segs) {
    const stHM = toHM(s?.start);
    const enHM = toHM(s?.end);
    if (!stHM || !enHM) continue;

    const st = hmToMin(stHM);
    const en = hmToMin(enHM);
    if (en <= st) continue;

    const dur = en - st;
    short += dur;

    if (s.type === "OTHER_ACADEMY") academyOuting += dur;
  }

  return { net: calcNetStudyMin(rec), short, academyOuting };
}

/** 타입별 합계 (학원/식사/외출 분리하려고 필요) */
export function calcByType(rec: any): Record<SegmentType, number> {
  const segs: Segment[] = Array.isArray(rec?.segments) ? rec.segments : [];

  const sums: Record<SegmentType, number> = {
    MATH: 0,
    ENGLISH: 0,
    KOREAN: 0,
    SCIENCE: 0,
    OTHER_ACADEMY: 0,
    MEAL: 0,
    OUTING: 0,
  };

  for (const s of segs) {
    const stHM = toHM(s?.start);
    const enHM = toHM(s?.end);
    if (!stHM || !enHM) continue;

    const st = hmToMin(stHM);
    const en = hmToMin(enHM);
    if (en <= st) continue;

    const dur = en - st;
    const t = s.type as SegmentType;
    if (t && t in sums) sums[t] += dur;
  }

  return sums;
}