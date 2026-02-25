import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

function todayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowHM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export async function ensureCheckInOnOpen(studentId: string) {
  if (!studentId) return;

  const dateStr = todayYYYYMMDD();
  const ref = doc(db, "records", dateStr);

  const snap = await getDoc(ref);
  const all = (snap.exists() ? snap.data() : {}) as any;
  const cur = all?.[studentId] || {};

  // 이미 체크인 되어 있으면 끝
  if (cur?.time || cur?.inTime) return;

  await setDoc(
    ref,
    {
      [studentId]: {
        ...cur,
        time: nowHM(),
        outTime: null,
      },
    },
    { merge: true }
  );
}