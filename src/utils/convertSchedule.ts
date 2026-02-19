// src/utils/convertSchedule.ts
import type { DayKey, ScheduleBlock } from "./scheduleEngine";

// 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토 (Date.getDay() 방식)
const NUM_TO_DAY: Record<number, DayKey> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

const STR_TO_DAY: Record<string, DayKey> = {
  // 한글
  "일": "sun",
  "월": "mon",
  "화": "tue",
  "수": "wed",
  "목": "thu",
  "금": "fri",
  "토": "sat",

  // 영문
  "sun": "sun",
  "mon": "mon",
  "tue": "tue",
  "wed": "wed",
  "thu": "thu",
  "fri": "fri",
  "sat": "sat",

  // 숫자 문자열도 커버
  "0": "sun",
  "1": "mon",
  "2": "tue",
  "3": "wed",
  "4": "thu",
  "5": "fri",
  "6": "sat",
};

const toDayKey = (d: any): DayKey => {
  const n = Number(d);
  if (Number.isFinite(n) && NUM_TO_DAY[n] != null) return NUM_TO_DAY[n];

  const s = String(d).trim().toLowerCase();
  return STR_TO_DAY[s] ?? "mon";
};

// ✅ named export 유지
export function convertPersonalScheduleToBlocks(personalSchedule: any): ScheduleBlock[] {
  const cur = personalSchedule?.current ?? personalSchedule?.data ?? personalSchedule;
  if (!cur) return [];

  const blocks: ScheduleBlock[] = [];

  Object.values(cur).forEach((subject: any) => {
    if (!subject?.slots) return;

    subject.slots.forEach((slot: any) => {
      if (!slot?.from || !slot?.to) return;

      // 디버그(필요할 때만 잠깐 켜)
      // console.log("slot.day raw =", slot.day, "=>", toDayKey(slot.day));

      blocks.push({
        day: toDayKey(slot.day),
        start: String(slot.from),
        end: String(slot.to),
        type: "ACADEMY",
      });
    });
  });

  return blocks;
}