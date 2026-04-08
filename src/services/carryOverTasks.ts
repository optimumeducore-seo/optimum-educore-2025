import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

export async function carryOverTasksForStudent({
  studentId,
  fromDate,
  toDate,
  subjectKey,
}: {
  studentId: string;
  fromDate: string;
  toDate: string;
  subjectKey: string;
}) {
  const fromRef = doc(db, "studyPlans", studentId, "days", fromDate);
  const snap = await getDoc(fromRef);
  if (!snap.exists()) return;

  const data = snap.data();
  const subj = data[subjectKey];
  if (!subj?.teacherTasks) return;

  const todayTasks: any[] = [];
  const nextTasks: any[] = [];

  subj.teacherTasks.forEach((t: any) => {
    if (Array.isArray(t.subtasks)) {
      const doneSubs = t.subtasks.filter((s: any) => s.done);
      const undoneSubs = t.subtasks.filter((s: any) => !s.done);

      if (doneSubs.length > 0) {
        todayTasks.push({
          ...t,
          subtasks: doneSubs,
          done: doneSubs.length === t.subtasks.length,
        });
      }

      if (undoneSubs.length > 0) {
        nextTasks.push({
          ...t,
          subtasks: undoneSubs.map((s: any) => ({ ...s, done: false })),
          done: false,
          carriedFrom: fromDate,
        });
      }
      return;
    }

    if (t.done) {
      todayTasks.push(t);
    } else {
      todayTasks.push({ ...t, carriedFrom: fromDate, done: false });
nextTasks.push({ ...t, done: false });
    }
  });

  if (nextTasks.length === 0) return;

  await setDoc(
    doc(db, "studyPlans", studentId, "days", fromDate),
    {
      [subjectKey]: {
        ...subj,
        teacherTasks: todayTasks,
        updatedAt: serverTimestamp(),
      },
    },
    { merge: true }
  );

  const toRef = doc(db, "studyPlans", studentId, "days", toDate);
const toSnap = await getDoc(toRef);
const toRaw = toSnap.exists() ? toSnap.data() : {};
const toSubj = (toRaw as any)[subjectKey] || {};

await setDoc(
  toRef,
  {
    [subjectKey]: {
      ...toSubj,
      teacherTasks: nextTasks,
      updatedAt: serverTimestamp(),
    },
  },
  { merge: true }
);
}