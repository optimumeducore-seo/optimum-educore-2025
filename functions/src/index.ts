
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

export const autoCheckout = onSchedule(
  {
    schedule: "0 23 * * *",
    timeZone: "Asia/Seoul",
  },
  async () => {
    const recordsSnap = await db.collection("records").get();

    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);

    const batch = db.batch();

    recordsSnap.forEach((docSnap) => {
      const d = docSnap.data() as any;
      if (!Array.isArray(d.logs)) return;

      const today = new Date().toISOString().slice(0, 10);
      const idx = d.logs.findIndex((l: any) => l.date === today);

      if (idx === -1) return;
      if (!d.logs[idx].inTime) return;
      if (d.logs[idx].outTime) return;

      d.logs[idx].outTime = hhmm;
      batch.set(docSnap.ref, { logs: d.logs }, { merge: true });
    });

    await batch.commit();
    console.log("🔥 자동 하원 처리 완료");
  }
);

