// src/firebase.ts (최종본: 중복 없이 깔끔)

import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "optimum-educore-2025.firebaseapp.com",
  projectId: "optimum-educore-2025",
  storageBucket: "optimum-educore-2025.appspot.com",
  messagingSenderId: "717693241717",
  appId: "1:717693241717:web:ecfd474f41271db992eb3c",
};

// Firebase 초기화 (한 번만!)
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// 익명 로그인 보장 (테스트용)
export function ensureSignedIn(): Promise<User | null> {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!user) signInAnonymously(auth);
      resolve(user ?? null);
    });
  });
}

// 임시 저장/불러오기 (테스트용)
export async function loadStore() {
  console.log("📦 loadStore() called (test)");
  return null;
}

export function saveStoreDebounced() {
  console.log("💾 saveStoreDebounced() called (test)");
}