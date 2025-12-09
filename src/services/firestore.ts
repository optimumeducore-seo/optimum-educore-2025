// src/services/firestore.ts
import { db } from "../firebase";
import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";



// --------------------------------------
//  C: 과제 자동 주기(Assignment Cycle)
// --------------------------------------

export interface TaskItem {
  text: string;
  done: boolean;
  subtasks?: {
    text: string;
    done: boolean;
  }[];
}

export const normalizeTasks = (arr: any[]): TaskItem[] => {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && typeof x.text === "string")
    .map((x) => ({
      text: x.text,
      done: !!x.done,
    }));
};

// 요일 타입
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

// 학생별 과목 규칙 타입
export interface SubjectRule {
  days: Weekday[];
  examMode?: boolean;
  disabled?: boolean;
}

// 전체 규칙 구조
export interface AssignmentRules {
  [subject: string]: SubjectRule;
}

// 규칙 저장
export const saveAssignmentRules = async (
  studentId: string,
  rules: AssignmentRules
) => {
  const batch = writeBatch(db);

  Object.entries(rules).forEach(([subject, rule]) => {
    const ref = doc(db, "students", studentId, "assignmentRules", subject);
    batch.set(ref, rule, { merge: true });
  });

  await batch.commit();
};

// 규칙 불러오기
export const loadAssignmentRules = async (
  studentId: string
): Promise<AssignmentRules> => {
  const colRef = collection(db, "students", studentId, "assignmentRules");
  const snap = await getDocs(colRef);

  const result: AssignmentRules = {};

  snap.docs.forEach((d) => {
    result[d.id] = d.data() as SubjectRule;
  });

  return result;
};

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

/* ============================================================
   📚 교재/단원 + 학생별 진도 + 자동 배정 서비스
   ============================================================ */

export type BookSubject =
  | "kor"
  | "math"
  | "eng"
  | "sci"
  | "soc"
  | "hist1"
  | "hist2"
  | "tech"
  | "hanja"
  | "jp";

// 단원/에피소드
export interface BookEpisode {
  id: string;          // uuid 같은 단원 id
  title: string;       // 단원명 (예: "품사 기본")
  startPage?: number;  // 시작 페이지
  endPage?: number;    // 끝 페이지
  videoTitle?: string; // 인강 제목 (선택)
  videoMin?: number;   // 인강 분량 (선택)
}

/* ====== 새 계층 구조 ====== */

// 소단원(실제 과제 단위)
export interface BookSection {
  id: string;
  title: string;
  startPage?: number;
  endPage?: number;
  videoTitle?: string;
  videoMin?: number;
}

// 중단원
export interface BookUnit {
  id: string;
  title: string;
  sections: BookSection[];
}

// 대단원
export interface BookChapter {
  id: string;
  title: string;
  units: BookUnit[];
}

// 교재
export interface Book {
  id: string;
  name: string;                 // 교재 이름 (숨마 국어 문법 등)
  subject: BookSubject;         // 과목 키 (kor, math...)
  episodes: BookEpisode[];      // 🔹 자동 배정용 flat 리스트 (그대로 유지)
  chapters?: BookChapter[];     // 🔹 새 계층 구조 (선택)
  createdAt?: any;
  updatedAt?: any;
}

// 학생별 교재 진도
export interface StudentBookProgress {
  bookId: string;
  lastEpisodeIndex: number;     // 다음에 풀 에피소드 index
}

// 계층 구조를 flat episodes로 펴주는 함수
export const flattenChaptersToEpisodes = (
  chapters?: BookChapter[]
): BookEpisode[] => {
  if (!chapters || !chapters.length) return [];

  const result: BookEpisode[] = [];

  chapters.forEach((ch) => {
    ch.units.forEach((u) => {
      u.sections.forEach((s) => {
        result.push({
          id: s.id,
          // 제목은 "대단원 > 중단원 > 소단원" 식으로 합쳐서 저장
          title: [ch.title, u.title, s.title].filter(Boolean).join(" > "),
          startPage: s.startPage,
          endPage: s.endPage,
          videoTitle: s.videoTitle,
          videoMin: s.videoMin,
        });
      });
    });
  });

  return result;
};




// 기존 episodes → 기본 chapter 구조로 변환
export const migrateEpisodesToChapters = (episodes: any[]) => {
  if (!episodes || !episodes.length) return [];

  return [
    {
      id: "ch-default",
      title: "기본 단원",
      units: [
        {
          id: "unit-default",
          title: "기본 중단원",
          sections: episodes.map((ep) => ({
            id: ep.id,
            title: ep.title,
            startPage: ep.startPage,
            endPage: ep.endPage,
            videoTitle: ep.videoTitle,
            videoMin: ep.videoMin,
          })),
        },
      ],
    },
  ];
};

/* ------------------- 교재 CRUD ------------------- */

// 교재 저장 (신규/수정 공용)
export const saveBook = async (book: Omit<Book, "id"> & { id?: string }) => {
  const id = book.id || crypto.randomUUID();
  const ref = doc(db, "books", id);

  // 계층 구조 정리
  const chapters =
    book.chapters && book.chapters.length ? book.chapters : undefined;

  // episodes가 넘어오면 그대로 사용, 아니면 chapters를 펴서 생성
  const episodes: BookEpisode[] =
    book.episodes && book.episodes.length
      ? book.episodes
      : flattenChaptersToEpisodes(chapters);

  const data: Book = {
    id,
    name: book.name,
    subject: book.subject,
    episodes: episodes || [],
    chapters,
    createdAt: (book as any).createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(ref, data, { merge: true });
  return id;
};

// 교재 하나 불러오기
export const loadBook = async (bookId: string): Promise<Book | null> => {
  const snap = await getDoc(doc(db, "books", bookId));
  if (!snap.exists()) return null;
  return snap.data() as Book;
};

// 전체 교재 목록 불러오기
export const loadBooks = async (): Promise<Book[]> => {
  const snap = await getDocs(collection(db, "books"));
  return snap.docs.map((d) => d.data() as Book);
};

/* ---------------- 학생별 교재 진도 ---------------- */

// 학생별 교재 진도 불러오기
export const loadStudentBookProgress = async (
  studentId: string,
  bookId: string
): Promise<StudentBookProgress> => {
  const ref = doc(db, "studentBooks", studentId, "books", bookId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return {
      bookId,
      lastEpisodeIndex: 0,
    };
  }
  return snap.data() as StudentBookProgress;
};

// 학생별 교재 진도 저장
export const saveStudentBookProgress = async (
  studentId: string,
  progress: StudentBookProgress
) => {
  const ref = doc(db, "studentBooks", studentId, "books", progress.bookId);
  await setDoc(ref, progress, { merge: true });
};



/* ---------------- 자동 배정 핵심 로직 ---------------- */


export const autoAssignNextEpisode = async (params: {
  studentId: string;
  dateStr: string;
  book: Book;
}) => {
  const { studentId, dateStr, book } = params;

  if (!book.episodes || book.episodes.length === 0) return;

  // 1) 학생의 현재 진도
  const progress = await loadStudentBookProgress(studentId, book.id);
  const idx = progress.lastEpisodeIndex || 0;

  if (idx >= book.episodes.length) return;

  const ep = book.episodes[idx];

  // -------------------------------------------
  // 🔵 StudyPlanPage가 읽을 수 있는 형태로 변환
  // -------------------------------------------
  const taskList: { text: string; done: boolean }[] = [];

  // 메인 과제 제목
  taskList.push({ text: `📘 ${ep.title}`, done: false });

  // 문제집
  if (ep.startPage || ep.endPage) {
    const p1 = ep.startPage ?? "";
    const p2 = ep.endPage ?? ep.startPage ?? "";
    const pageText =
      p1 && p2 && p1 !== p2 ? `${p1}~${p2}쪽` : `${p1}쪽`;

    taskList.push({
      text: `문제집: ${pageText}`,
      done: false,
    });
  }

  // 인강
  if (ep.videoTitle) {
    const minText = ep.videoMin ? ` (${ep.videoMin}분)` : "";
    taskList.push({
      text: `인강: ${ep.videoTitle}${minText}`,
      done: false,
    });
  }

  // 노트 정리
  taskList.push({
    text: `노트 정리(핵심 내용 정리)`,
    done: false,
  });

  // -------------------------------------------
  // 🔵 StudyPlan 구조 맞추기
  // -------------------------------------------
  const planRef = doc(db, "studyPlans", studentId, "days", dateStr);
  const snap = await getDoc(planRef);
  const raw = snap.exists() ? snap.data() as any : {};

  const subjectKey = book.subject;
  const prevSubj = raw[subjectKey] || {};

  const prevTeacher = Array.isArray(prevSubj.teacherTasks)
    ? prevSubj.teacherTasks
    : [];

  const mergedSubject = {
    teacherTasks: [...prevTeacher, ...taskList],  // 🔥 UI가 읽을 수 있는 구조!
    studentPlans: prevSubj.studentPlans || [],
    memo: prevSubj.memo || "",
    done: prevSubj.done || false,
    proofImages: prevSubj.proofImages || [],
    proofMemo: prevSubj.proofMemo || "",
    wordTest: prevSubj.wordTest || { correct: 0, total: 0 },
    updatedAt: serverTimestamp(),
  };

  await setDoc(
    planRef,
    {
      date: dateStr,
      [subjectKey]: mergedSubject,
    },
    { merge: true }
  );

  // -------------------------------------------
  // 🔵 다음 에피소드로 진도 이동
  // -------------------------------------------
  await saveStudentBookProgress(studentId, {
    bookId: book.id,
    lastEpisodeIndex: idx + 1,
  });
};