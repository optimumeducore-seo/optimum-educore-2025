// src/utils/scheduleEngine.ts
console.log("scheduleEngine loaded");

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type BlockType = "STUDY_HALL" | "ACADEMY" | "MEAL";

export type ScheduleBlock = {
  day: DayKey;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  type: BlockType;
};

export type StudentLite = {
  id: string;
  name: string;
  level?: "HIGH" | "MID";
  blocks: ScheduleBlock[];
};

export type SeatAssignment = {
  studentId: string;
  hallId: "optimum" | "edu";
  seatId: string;
};

export type SeatStatus =
  | "EMPTY"
  | "PRESENT"
  | "MOVE_BEFORE"
  | "ACADEMY"
  | "MOVE_AFTER"
  | "MEAL"
  | "OUT";

export const DAY_LABEL: Record<DayKey, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function buildTimeSlots(
  startHHMM: string,
  endHHMM: string,
  stepMin = 30
) {
  const start = toMinutes(startHHMM);
  const end = toMinutes(endHHMM);
  const slots: string[] = [];
  for (let t = start; t <= end; t += stepMin) slots.push(minutesToHHMM(t));
  return slots;
}

// 타임테이블(주간/월간): 정독관에 "있는" 사람만 집계
export function isInStudyHallAt(
  blocks: ScheduleBlock[],
  day: DayKey,
  slotHHMM: string
): boolean {
  const t = toMinutes(slotHHMM);
  return blocks.some((b) => {
    if (b.day !== day) return false;
    if (b.type !== "STUDY_HALL") return false;
    const s = toMinutes(b.start),
      e = toMinutes(b.end);
    return t >= s && t < e;
  });
}

// 좌석(출결현황): 지금 시각 기준 상태 계산
export function computeSeatStatusNow(params: {
  now: Date;
  day: DayKey;
  blocks: ScheduleBlock[];
  overrideOut: boolean;
  bufferMin?: number;
}): SeatStatus {
  const { now, day, blocks, overrideOut } = params;
  const bufferMin = params.bufferMin ?? 15;

  if (overrideOut) return "OUT";

  const nowMin = now.getHours() * 60 + now.getMinutes();

  const academyBlock = blocks.find(
    (b) =>
      b.day === day &&
      b.type === "ACADEMY" &&
      nowMin >= toMinutes(b.start) &&
      nowMin < toMinutes(b.end)
  );
  if (academyBlock) return "ACADEMY";

  const mealBlock = blocks.find(
    (b) =>
      b.day === day &&
      b.type === "MEAL" &&
      nowMin >= toMinutes(b.start) &&
      nowMin < toMinutes(b.end)
  );
  if (mealBlock) return "MEAL";

  const academyNear = blocks
    .filter((b) => b.day === day && b.type === "ACADEMY")
    .some((b) => {
      const s = toMinutes(b.start),
        e = toMinutes(b.end);
      return (
        (nowMin >= s - bufferMin && nowMin < s) ||
        (nowMin >= e && nowMin < e + bufferMin)
      );
    });

  if (academyNear) {
    const isBefore = blocks
      .filter((b) => b.day === day && b.type === "ACADEMY")
      .some(
        (b) => nowMin >= toMinutes(b.start) - bufferMin && nowMin < toMinutes(b.start)
      );
    return isBefore ? "MOVE_BEFORE" : "MOVE_AFTER";
  }

  const present = blocks.some((b) => {
    if (b.day !== day) return false;
    if (b.type !== "STUDY_HALL") return false;
    const s = toMinutes(b.start),
      e = toMinutes(b.end);
    return nowMin >= s && nowMin < e;
  });
  if (present) return "PRESENT";

  return "EMPTY";
}

// 이름 “아주 작게” 표시용
export function tinyName(name: string) {
  return (name || "").trim();
}

export type AcademyBuffer = "BEFORE" | "AFTER";

export function academyBufferAt(
  blocks: ScheduleBlock[],
  day: DayKey,
  slotHHMM: string,
  bufferMin = 15
): AcademyBuffer | null {
  const t = toMinutes(slotHHMM);

  for (const b of blocks) {
    if (b.day !== day) continue;
    if (b.type !== "ACADEMY") continue;

    const s = toMinutes(b.start);
    const e = toMinutes(b.end);

    // 학원 시작 전 15분
    if (t >= s - bufferMin && t < s) return "BEFORE";

    // 학원 끝난 후 15분
    if (t >= e && t < e + bufferMin) return "AFTER";
  }
  return null;
}
export function isInAcademyAt(
  blocks: ScheduleBlock[],
  day: DayKey,
  slotHHMM: string
): boolean {
  const t = toMinutes(slotHHMM);
  return blocks.some((b) => {
    if (b.day !== day) return false;
    if (b.type !== "ACADEMY") return false;
    const s = toMinutes(b.start);
    const e = toMinutes(b.end);
    return t >= s && t < e;
  });
}
// ✅ 빈 시간은 STUDY_HALL로 채우기
export function fillStudyHallGaps(
  academyBlocks: ScheduleBlock[],
  openStart: string,
  openEnd: string
): ScheduleBlock[] {

  const result: ScheduleBlock[] = [];

  const days: DayKey[] = ["mon","tue","wed","thu","fri","sat","sun"];

  days.forEach(day => {
    const dayAcademy = academyBlocks.filter(b => b.day === day);

    if (dayAcademy.length === 0) {
      // 학원 없는 날 → 운영시간 전체가 STUDY_HALL
      result.push({
        day,
        start: openStart,
        end: openEnd,
        type: "STUDY_HALL"
      });
      return;
    }

    // 학원 있는 날
    let cursor = openStart;

    dayAcademy
      .sort((a,b) => a.start.localeCompare(b.start))
      .forEach(block => {

        // 학원 시작 전까지 STUDY_HALL
        if (cursor < block.start) {
          result.push({
            day,
            start: cursor,
            end: block.start,
            type: "STUDY_HALL"
          });
        }

        // 학원 블록 그대로 유지
        result.push(block);

        cursor = block.end;
      });

    // 마지막 학원 이후
    if (cursor < openEnd) {
      result.push({
        day,
        start: cursor,
        end: openEnd,
        type: "STUDY_HALL"
      });
    }
  });

  return result;
}