import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

exports.autoCheckout = functions.pubsub
  .schedule("0 23 * * *")   // 매일 23시
  .timeZone("Asia/Seoul")
  .onRun(async () => {

    const recordsSnap = await db.collection("records").get();

    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5); // "23:00"

    const batch = db.batch();

    recordsSnap.forEach((docSnap) => {
      const d = docSnap.data() as any;

      if (!Array.isArray(d.logs)) return;

      const today = new Date().toISOString().slice(0, 10);

      const idx = d.logs.findIndex((l: any) => l.date === today);

      if (idx === -1) return;        // 오늘 기록 없음
      if (!d.logs[idx].inTime) return;   // 등원 안함
      if (d.logs[idx].outTime) return;   // 이미 하원함

      // 🔥 자동 하원 처리
      d.logs[idx].outTime = hhmm;

      batch.set(docSnap.ref, { logs: d.logs }, { merge: true });
    });

    await batch.commit();
    console.log("🔥 자동 하원 처리 완료");
    return null;
  });