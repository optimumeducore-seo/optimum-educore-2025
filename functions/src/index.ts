import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

// 🔄 매일 22:00에 자동 하원 처리
exports.autoCheckout = functions.pubsub
  .schedule("0 22 * * *") // 매일 22시
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);

    const snaps = await db.collection("records").get();

    snaps.forEach((docSnap) => {
      const data = docSnap.data();
      const studentId = docSnap.id;

      const isToday = data.date === todayStr;
      const notCheckedOut = !data.outTime;

      if (isToday && notCheckedOut) {
        db.collection("records").doc(studentId).set(
          {
            outTime: `${todayStr}T22:00:00`,
          },
          { merge: true }
        );
      }
    });

    console.log("✔ 자동 하원 처리 완료");
    return null;
  });