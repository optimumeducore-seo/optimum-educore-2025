// src/utils/deviceAuth.ts
import { db } from "../firebase";
import { doc, getDoc, setDoc, arrayUnion } from "firebase/firestore";

const LS_KEY = "edu_device_id_v1";

// 기기 고유 ID 생성
function makeId() {
  return "dev_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
}

// 기기 ID 가져오기 (localStorage 유지)
export function getDeviceId(): string {
  let id = localStorage.getItem(LS_KEY);
  if (!id) {
    id = makeId();
    localStorage.setItem(LS_KEY, id);
  }
  return id;
}

// 기기 라벨 (아이폰/PC 구분)
export function getDeviceLabel(): string {
  const ua = navigator.userAgent || "";
  const isIPhone = /iPhone/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isWindows = /Win/i.test(ua);
  const isMac = /Mac/i.test(ua);

  if (isIPhone) return "iPhone";
  if (isAndroid) return "Android";
  if (isWindows) return "Windows PC";
  if (isMac) return "Mac";
  return "Unknown Device";
}

// 학생 문서에서 허용/대기 기기 목록 가져오기
export async function fetchDeviceLists(studentId: string) {
  const ref = doc(db, "students", studentId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : {};

  const allowed = Array.isArray(data.allowedDevices) ? data.allowedDevices : [];
  const pending = Array.isArray(data.pendingDevices) ? data.pendingDevices : [];

  return { allowed, pending };
}

// 승인 요청
export async function requestDeviceApproval(studentId: string) {
  const deviceId = getDeviceId();
  const label = getDeviceLabel();

  const ref = doc(db, "students", studentId);
  await setDoc(
    ref,
    {
      pendingDevices: arrayUnion({
        id: deviceId,
        label,
        at: new Date().toISOString(),
      }),
    },
    { merge: true }
  );
}