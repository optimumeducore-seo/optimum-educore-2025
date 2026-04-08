// src/firebase.ts (수정된 최종본)

import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp, } from "firebase/firestore";
import { getStorage } from "firebase/storage"

const firebaseConfig = {
  apiKey: "AIzaSyCgMyqtp4Vlg6YWvDbQfRtTkG5xrgUO9x0",
  authDomain: "optimum-educore-2025.firebaseapp.com",
  projectId: "optimum-educore-2025",
 storageBucket: "optimum-educore-2025.firebasestorage.app",
  messagingSenderId: "717693241717",
  appId: "1:717693241717:web:ecfd474f41271db992eb3c"
};

// Firebase 초기화 (한 번만!)
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ✅ Firestore 연결 테스트용 함수
export async function testFirestoreConnection() {
  try {
    await setDoc(doc(db, "connection_test", "hello"), {
      message: "🔥 Firestore 연결 성공!",
      createdAt: serverTimestamp(),
    });
    console.log("✅ Firestore 문서 추가 완료!");
  } catch (err) {
    console.error("❌ Firestore 연결 실패:", err);
  }
}

// 익명 로그인 (테스트용)
export function ensureSignedIn(): Promise<User | null> {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!user) signInAnonymously(auth);
      resolve(user ?? null);
    });
  });
}

// 임시 저장/불러오기
export async function loadStore() {
  console.log("📦 loadStore() called (test)");
  return null;
}

export function saveStoreDebounced() {
  console.log("💾 saveStoreDebounced() called (test)");
}

export const storage = getStorage(app);