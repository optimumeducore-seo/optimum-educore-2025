// src/services/firestore.ts
import { db } from "../firebase";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";

/* --------------------------------------------
   🔵 grade (학교 성적) 불러오기
-------------------------------------------- */
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

/* --------------------------------------------
   🔵 grade (학교 성적) 저장하기
-------------------------------------------- */
export const saveGrade = async (studentId: string, data: any) => {
  try {
    await setDoc(doc(db, "grades", studentId), data, { merge: true });
    console.log("💾 성적 저장 완료:", studentId);
  } catch (err) {
    console.error("❌ 성적 저장 오류:", err);
  }
};

/* --------------------------------------------
   🔵 mockExams 전체 불러오기
-------------------------------------------- */
export const loadMockExams = async (studentId: string) => {
  try {
    const q = query(
      collection(db, "mockExams"),
      where("studentId", "==", studentId)
    );

    const snap = await getDocs(q);

    const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    console.log("📘 mockExams 불러오기:", list);

    return list;
  } catch (err) {
    console.error("❌ mockExams 불러오기 오류:", err);
    return [];
  }
};