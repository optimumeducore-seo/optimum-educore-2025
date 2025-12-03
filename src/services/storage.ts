// src/services/storage.ts

import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { app } from "../firebase";

// Firebase Storage 초기화
const storage = getStorage(app);

/**
 * 📸 업로드 함수
 * @param file       업로드할 파일
 * @param studentId  학생 ID
 * @returns 업로드된 파일의 다운로드 URL
 */
export async function uploadProof(file: File, studentId: string) {
  try {
    const fileName = `proofs/${studentId}_${Date.now()}.jpg`;
    const fileRef = ref(storage, fileName);

    // 📤 파일 업로드
    await uploadBytes(fileRef, file);

    // 🔗 URL 생성
    const url = await getDownloadURL(fileRef);

    return url; // 가장 중요!
  } catch (err) {
    console.error("❌ 파일 업로드 실패:", err);
    throw err;
  }
}