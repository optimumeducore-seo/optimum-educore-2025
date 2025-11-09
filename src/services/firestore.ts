// src/services/firestore.ts
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

// ✅ 성적 불러오기
export const loadGrade = async (studentId: string) => {
  try {
    const snap = await getDoc(doc(db, "grades", studentId));
    if (snap.exists()) {
      console.log("📘 불러온 성적:", snap.data());
      return snap.data();
    } else {
      console.log("⚠️ 해당 학생 성적 없음:", studentId);
      return null;
    }
  } catch (err) {
    console.error("❌ 성적 불러오기 오류:", err);
    return null;
  }
};

// ✅ 성적 저장하기 (기존 데이터 병합)
export const saveGrade = async (studentId: string, data: any) => {
  try {
    await setDoc(doc(db, "grades", studentId), data, { merge: true });
    console.log("💾 성적 저장 완료:", studentId);
  } catch (err) {
    console.error("❌ 성적 저장 오류:", err);
  }
};