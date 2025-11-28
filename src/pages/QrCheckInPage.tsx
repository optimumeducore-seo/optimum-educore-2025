// src/pages/QrCheckInPage.tsx
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export default function QrCheckInPage() {
  const [msg, setMsg] = useState("확인 중...");

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const studentId = params.get("sid");

      if (!studentId) {
        setMsg("❌ 학생 정보가 없습니다.");
        return;
      }

      // 1) 학생 정보 확인
      const sRef = doc(db, "students", studentId);
      const sSnap = await getDoc(sRef);

      if (!sSnap.exists()) {
        setMsg("❌ 등록되지 않은 학생입니다.");
        return;
      }

      const student = sSnap.data();

      // 2) 체크인 처리 (StudentPage와 동일한 방식)
      const now = new Date();
      const hhmm = now.toTimeString().slice(0, 5);
      const date = now.toISOString().slice(0, 10);

      const ref = doc(db, "records", date);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : {};
      const prev = data[studentId] || {};

      await setDoc(
        ref,
        {
          [studentId]: {
            ...prev,
            time: hhmm, // 첫 등원
            outTime: prev.outTime ?? null,
          },
        },
        { merge: true }
      );

      setMsg(`✅ ${student.name} 학생 등원 완료!`);

      // 3) 3초 후 자동 닫기
      setTimeout(() => {
        window.close();
      }, 2500);
    };

    run();
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f8fafc",
        fontFamily: "Pretendard",
        fontSize: 22,
        fontWeight: 700,
        color: "#1e3a8a",
        padding: 20,
        textAlign: "center",
      }}
    >
      {msg}
    </div>
  );
}