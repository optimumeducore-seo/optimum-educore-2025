import {
  collection,
  doc,
  getDocs,
  setDoc,
  Timestamp,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../firebase";

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

type BackupPack = {
  exportedAt: string;
  version: number;
  students: any[];
  printDistributions: any[];
  records: any[];
  studyPlans: Array<{
    studentId: string;
    days: any[];
  }>;
  studentBooks: Array<{
    studentId: string;
    books: any[];
  }>;
  studentExams: Array<{
    studentId: string;
    progress: any[];
  }>;
  consultLogs: Array<{
    studentId: string;
    logs: any[];
  }>;
};

function isTimestampLike(value: any) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.seconds === "number" &&
    typeof value.nanoseconds === "number" &&
    Object.keys(value).length === 2
  );
}

function toBackupJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Timestamp) {
    return {
      __type: "timestamp",
      iso: value.toDate().toISOString(),
    };
  }

  if (Array.isArray(value)) {
    return value.map(toBackupJson);
  }

  if (typeof value === "object") {
    // Firestore에서 읽어온 plain timestamp-like object도 처리
    if (isTimestampLike(value)) {
      return {
        __type: "timestamp",
        iso: new Date(value.seconds * 1000).toISOString(),
      };
    }

    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = toBackupJson(v);
    }
    return out;
  }

  return value;
}

function fromBackupJson(value: any): any {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(fromBackupJson);
  }

  if (typeof value === "object") {
    if (value.__type === "timestamp" && value.iso) {
      return Timestamp.fromDate(new Date(value.iso));
    }

    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = fromBackupJson(v);
    }
    return out;
  }

  return value;
}

export async function exportEducoreBackup() {
  const backup: BackupPack = {
    exportedAt: new Date().toISOString(),
    version: 2,
    students: [],
    printDistributions: [],
    records: [],
    studyPlans: [],
    studentBooks: [],
    studentExams: [],
    consultLogs: [],
  };

  // 1) top-level collections
  const [studentsSnap, printSnap, recordsSnap] = await Promise.all([
    getDocs(collection(db, "students")),
    getDocs(collection(db, "printDistributions")),
    getDocs(collection(db, "records")),
  ]);

  backup.students = studentsSnap.docs.map((d) => ({
    id: d.id,
    ...toBackupJson(d.data()),
  }));

  backup.printDistributions = printSnap.docs.map((d) => ({
    id: d.id,
    ...toBackupJson(d.data()),
  }));

  backup.records = recordsSnap.docs.map((d) => ({
    id: d.id,
    ...toBackupJson(d.data()),
  }));

  // 2) studyPlans/{studentId}/days/*
  // ❌ 부모 컬렉션 studyPlans를 직접 읽으면 subcollection만 있는 구조에서 비어버릴 수 있음
  // ✅ students 기준으로 studentId를 돌면서 직접 days를 읽는다
  for (const student of studentsSnap.docs) {
    const sid = student.id;

    const daysSnap = await getDocs(collection(db, "studyPlans", sid, "days"));

    if (!daysSnap.empty) {
      backup.studyPlans.push({
        studentId: sid,
        days: daysSnap.docs.map((d) => ({
          id: d.id,
          ...toBackupJson(d.data()),
        })),
      });
    }
  }

  // 3) studentBooks/{studentId}/books/*
  // 이것도 부모 문서가 없을 수 있으니 students 기준으로 먼저 시도
  for (const student of studentsSnap.docs) {
    const sid = student.id;

    const booksSnap = await getDocs(collection(db, "studentBooks", sid, "books"));

    if (!booksSnap.empty) {
      backup.studentBooks.push({
        studentId: sid,
        books: booksSnap.docs.map((d) => ({
          id: d.id,
          ...toBackupJson(d.data()),
        })),
      });
    }
  }

  // 4) studentExams/{studentId}/progress/*
  for (const student of studentsSnap.docs) {
    const sid = student.id;

    const progressSnap = await getDocs(
      collection(db, "studentExams", sid, "progress")
    );

    if (!progressSnap.empty) {
      backup.studentExams.push({
        studentId: sid,
        progress: progressSnap.docs.map((d) => ({
          id: d.id,
          ...toBackupJson(d.data()),
        })),
      });
    }
  }

  // 5) students/{studentId}/consultLogs/*
  for (const student of studentsSnap.docs) {
    const sid = student.id;

    const logsSnap = await getDocs(collection(db, "students", sid, "consultLogs"));

    if (!logsSnap.empty) {
      backup.consultLogs.push({
        studentId: sid,
        logs: logsSnap.docs.map((d) => ({
          id: d.id,
          ...toBackupJson(d.data()),
        })),
      });
    }
  }

  // 6) 파일 다운로드
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `educore-full-backup-${stamp}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

export async function importEducoreBackup(file: File) {
  const text = await file.text();
  const backup = JSON.parse(text) as BackupPack;

  if (!backup || !backup.version) {
    throw new Error("백업 파일 형식이 올바르지 않습니다.");
  }

  // 1) students
  for (const row of backup.students || []) {
    const { id, ...raw } = row;
    const data = fromBackupJson(raw);
    await setDoc(doc(db, "students", id), data, { merge: true });
  }

  // 2) printDistributions
  for (const row of backup.printDistributions || []) {
    const { id, ...raw } = row;
    const data = fromBackupJson(raw);
    await setDoc(doc(db, "printDistributions", id), data, { merge: true });
  }

  // 3) records
  for (const row of backup.records || []) {
    const { id, ...raw } = row;
    const data = fromBackupJson(raw);
    await setDoc(doc(db, "records", id), data, { merge: true });
  }

  // 4) studyPlans/{sid}/days/{date}
  for (const pack of backup.studyPlans || []) {
    const sid = pack.studentId;
    for (const row of pack.days || []) {
      const { id, ...raw } = row;
      const data = fromBackupJson(raw);
      await setDoc(doc(db, "studyPlans", sid, "days", id), data, { merge: true });
    }
  }

  // 5) studentBooks/{sid}/books/{bookId}
  for (const pack of backup.studentBooks || []) {
    const sid = pack.studentId;
    for (const row of pack.books || []) {
      const { id, ...raw } = row;
      const data = fromBackupJson(raw);
      await setDoc(doc(db, "studentBooks", sid, "books", id), data, { merge: true });
    }
  }

  // 6) studentExams/{sid}/progress/{examId}
  for (const pack of backup.studentExams || []) {
    const sid = pack.studentId;
    for (const row of pack.progress || []) {
      const { id, ...raw } = row;
      const data = fromBackupJson(raw);
      await setDoc(doc(db, "studentExams", sid, "progress", id), data, { merge: true });
    }
  }

  // 7) students/{sid}/consultLogs/{logId}
  for (const pack of backup.consultLogs || []) {
    const sid = pack.studentId;
    for (const row of pack.logs || []) {
      const { id, ...raw } = row;
      const data = fromBackupJson(raw);
      await setDoc(doc(db, "students", sid, "consultLogs", id), data, { merge: true });
    }
  }
}