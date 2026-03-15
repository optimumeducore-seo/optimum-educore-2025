
// src/pages/AutoBookAssignPage.tsx
import { useEffect, useState, useMemo } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

// 값(value) import
import {
  loadBooks,
  loadBook,
  autoAssignNextEpisode,
  loadStudentBookProgress,
  saveStudentBookProgress,
} from "../services/firestore";

// 타입(type) import
import type {
  Book,
  BookEpisode,
  BookSubject,
  StudentBookProgress,
} from "../services/firestore";
import { useNavigate } from "react-router-dom";

type Student = {
  id: string;
  name: string;
  grade?: string;
  school?: string;
  hidden?: boolean;
};

const SUBJECT_LABEL: Record<BookSubject, string> = {
  kor: "국어",
  math: "수학",
  eng: "영어",
  sci: "과학",
  soc: "사회",
  hist1: "역사1",
  hist2: "역사2",
  tech: "기술가정",
  hanja: "한자",
  jp: "일본어",
};


export default function AutoBookAssignPage() {
    const navigate = useNavigate();
  const [students, setStudents] = useState<Student[]>([]);
  const [books, setBooks] = useState<Book[]>([]);

  const [selectedGrade, setSelectedGrade] = useState<string>("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string>("");
  const [assignDate, setAssignDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [loading, setLoading] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, any>>({});
  const [selectedStudentBookStatus, setSelectedStudentBookStatus] = useState<
  {
    bookId: string;
    bookName: string;
    subject: BookSubject;
    lastEpisodeIndex: number;
    totalEpisodes: number;
  }[]
>([]);

const focusStudentId =
  selectedStudentIds.length === 1 ? selectedStudentIds[0] : null;

  // 학생/교재 로드
  useEffect(() => {
    const run = async () => {
      const snap = await getDocs(collection(db, "students"));
  const list: Student[] = snap.docs.map((d) => {
  const raw = d.data() as any;

  return {
    id: d.id,
    name: raw.name || "이름 없음",
    grade: raw.grade,
    school: raw.school,
    hidden: raw.removed === true,
  };
});
      setStudents(list);

      const bs = await loadBooks();
      setBooks(bs);
    };

    run();
  }, []);

  useEffect(() => {
  const load = async () => {
    if (!selectedBookId) return;

    const map: Record<string, any> = {};
for (const s of students) {
  map[s.id] = await loadStudentBookProgress(s.id, selectedBookId);
}
    setProgressMap(map);
  };

  load();
}, [students, selectedBookId]);

useEffect(() => {
  const loadSelectedStudentBooks = async () => {
    if (!focusStudentId) {
      setSelectedStudentBookStatus([]);
      return;
    }

    const snap = await getDocs(collection(db, "studentBooks", focusStudentId, "books"));

    const rows = await Promise.all(
      snap.docs.map(async (d) => {
        const progress = d.data() as any;
        const book = await loadBook(d.id);

       return {
  bookId: d.id,
  bookName: book?.name || "교재명 없음",
  subject: (book?.subject || "kor") as BookSubject,
  lastEpisodeIndex: progress?.lastEpisodeIndex ?? 0,
  totalEpisodes: book?.episodes?.length ?? 0,
};
      })
    );

    setSelectedStudentBookStatus(rows);
  };

  loadSelectedStudentBooks();
}, [focusStudentId, loading]);

  const selectedBook = books.find((b) => b.id === selectedBookId) || null;

  const getNextSectionPreview = (studentId: string) => {
  if (!selectedBook) return null;

  const progress = progressMap[studentId];
  const currentIndex = progress?.lastEpisodeIndex ?? 0;

  const nextEpisode = selectedBook.episodes?.[currentIndex];
  return nextEpisode || null;
};

const getNextEpisodeLabel = (studentId: string) => {
  const ep = getNextSectionPreview(studentId);
  if (!ep) return "";

  const progress = progressMap[studentId];
  const nextIndex = progress?.lastEpisodeIndex ?? 0;

  const rawTitle = ep.title || "";

  // "대단원 > 중단원 > 소단원" 구조라면 마지막 제목만 추출
  const parts = rawTitle.split(">").map((v) => v.trim());
  const lastTitle = parts[parts.length - 1] || rawTitle;

  // 대단원/중단원 번호만 뽑기
  const bigNo = parts[0]?.match(/^\d+/)?.[0] || "";
  const midNo = parts[1]?.match(/^\d+/)?.[0] || "";

  const prefix =
    bigNo && midNo ? `${bigNo}-${midNo}. ` :
    bigNo ? `${bigNo}. ` :
    "";

  return `${prefix}${lastTitle}`;
};


  // 학생 체크 토글
  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleAdjustProgress = async (studentId: string) => {
  if (!selectedBook) {
    alert("먼저 교재를 선택하세요.");
    return;
  }

  const currentIndex = progressMap[studentId]?.lastEpisodeIndex ?? 0;
  const input = window.prompt(
    `현재 진도는 ${currentIndex}강입니다.\n변경할 강 번호를 입력하세요.`,
    String(currentIndex)
  );

  if (input === null) return;

  const nextValue = Number(input.trim());

  if (!Number.isFinite(nextValue) || nextValue < 0) {
    alert("올바른 강 번호를 입력하세요.");
    return;
  }

  if (nextValue > selectedBook.episodes.length) {
    alert(`최대 ${selectedBook.episodes.length}강까지 입력 가능합니다.`);
    return;
  }

  try {
    await saveStudentBookProgress(studentId, {
      bookId: selectedBook.id,
      lastEpisodeIndex: nextValue,
    });

    setProgressMap((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        bookId: selectedBook.id,
        lastEpisodeIndex: nextValue,
      },
    }));

    alert(`진도가 ${nextValue}강으로 수정되었습니다.`);
  } catch (err) {
    console.error(err);
    alert("진도 수정 중 오류가 발생했습니다.");
  }
};

  // 자동 배정 실행
  const handleAutoAssign = async () => {
    if (!selectedBook) {
      alert("교재를 선택하세요.");
      return;
    }
    if (!assignDate) {
      alert("날짜를 선택하세요.");
      return;
    }
    if (!selectedStudentIds.length) {
      alert("학생을 1명 이상 선택하세요.");
      return;
    }
    if (!selectedBook.episodes || selectedBook.episodes.length === 0) {
      alert("선택한 교재에 단원이 없습니다. 먼저 단원을 등록하세요.");
      return;
    }
   
for (const sid of selectedStudentIds) {
  const progress = progressMap[sid];
  const currentIndex = progress?.lastEpisodeIndex ?? 0;

  if (currentIndex >= selectedBook.episodes.length) {
    alert("이미 마지막 강까지 완료된 학생이 있습니다.");
    return;
  }
}

    if (
      !window.confirm(
        `선택한 학생 ${selectedStudentIds.length}명에게\n"${selectedBook.name}" 다음 강을 ${assignDate} 과제로 배정할까요?`
      )
    ) {
      return;
    }

    setLoading(true);
    try {
      await Promise.all(
        selectedStudentIds.map((sid) =>
          autoAssignNextEpisode({
            studentId: sid,
            dateStr: assignDate,
            book: selectedBook,
          })
        )
      );

      alert("✅ 자동 배정이 완료되었습니다!");
    } catch (err) {
      console.error(err);
      alert("자동 배정 중 오류가 발생했습니다. 콘솔을 확인해주세요.");
    } finally {
      setLoading(false);
    }
  };

  // 학년 필터링
const filteredStudents = students.filter((s) => {
  if (s.hidden === true) return false;

  if (!selectedGrade) return true;

  const gradeText = String(s.grade || "").replace(/\s/g, "");
  return gradeText.includes(selectedGrade);
});

const selectedStudentNames = filteredStudents
  .filter((s) => selectedStudentIds.includes(s.id))
  .map((s) => s.name);

 return (
  <div
    style={{
      maxWidth: 1200,
      margin: "40px auto",
      padding: "32px", // 여백을 더 줘서 시원하게
      background: "#F8FAFC", // 더 밝고 깨끗한 배경
      borderRadius: 24,
      fontFamily: "Pretendard, -apple-system, sans-serif",
      color: "#1E293B",
    }}
  >
    {/* 상단 헤더 섹션 */}
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        marginBottom: 32,
      }}
    >
      <div>
        <h2
          style={{
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-0.025em",
            margin: 0,
            color: "#0F172A",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 32 }}>🤖</span> 교재 기반 자동 과제 배정
        </h2>
        <p style={{ fontSize: 15, color: "#64748B", marginTop: 8, fontWeight: 500 }}>
          등록된 교재 데이터를 분석하여 학생별 다음 진도를 스마트하게 추천하고 배정합니다.
        </p>
      </div>

      <button
        onClick={() => navigate("/books")}
        style={{
          padding: "12px 20px",
          borderRadius: 14,
          border: "1px solid #E2E8F0",
          background: "#FFFFFF",
          fontSize: 14,
          fontWeight: 700,
          color: "#475569",
          cursor: "pointer",
          transition: "all 0.2s",
          boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
        }}
      >
        📚 교재 관리 시스템
      </button>
    </div>

    {/* 메인 설정 카드 (상단) */}
    <div
      style={{
        marginBottom: 24,
        padding: "28px",
        background: "#FFFFFF",
        borderRadius: 24,
        boxShadow: "0 10px 15px -3px rgba(0,0,0,0.04), 0 4px 6px -2px rgba(0,0,0,0.02)",
        border: "1px solid #F1F5F9",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start" }}>
        {/* 학년 선택 */}
        <div style={{ flex: "0 1 140px" }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#94A3B8", display: "block", marginBottom: 10, paddingLeft: 4 }}>대상 학년</label>
          <select
            value={selectedGrade}
            onChange={(e) => {
              setSelectedGrade(e.target.value);
              setSelectedStudentIds([]);
            }}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid #E2E8F0",
              background: "#F8FAFC",
              fontSize: 15,
              fontWeight: 600,
              outline: "none",
            }}
          >
           <option value="">전체 학년</option>
<option value="중1">중1</option>
<option value="중2">중2</option>
<option value="중3">중3</option>
<option value="고1">고1</option>
<option value="고2">고2</option>
<option value="고3">고3</option>
          </select>
        </div>

        {/* 교재 선택 */}
        <div style={{ flex: "1 1 300px" }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#94A3B8", display: "block", marginBottom: 10, paddingLeft: 4 }}>배정할 교재</label>
          <select
            value={selectedBookId}
            onChange={(e) => setSelectedBookId(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 12,
              border: "2px solid #3B82F6",
              fontSize: 15,
              background: "#F0F9FF",
              color: "#1E40AF",
              fontWeight: 700,
              outline: "none",
            }}
          >
            <option value="">과제용 교재를 선택해 주세요</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                [{SUBJECT_LABEL[b.subject]}] {b.name}
              </option>
            ))}
          </select>
         {selectedBook && (
  <div
    style={{
      marginTop: 10,
      padding: "8px 12px",
      background: "#EFF6FF",
      borderRadius: 8,
      fontSize: 12,
      color: "#2563EB",
      fontWeight: 600,
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      alignItems: "center",
    }}
  >
    <span>📋 총 {selectedBook.episodes.length}개 단원 구성</span>
    <span>• 첫 단원: {selectedBook.episodes[0]?.title}</span>

    {(selectedBook as any).videoPlatform && (
      <span style={{ color: "#64748B" }}>
        • 인강 플랫폼: {(selectedBook as any).videoPlatform}
      </span>
    )}
  </div>
)}
        </div>

        {/* 배정 날짜 */}
        <div style={{ flex: "0 1 200px" }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#94A3B8", display: "block", marginBottom: 10, paddingLeft: 4 }}>배정 예정일</label>
          <input
            type="date"
            value={assignDate}
            onChange={(e) => setAssignDate(e.target.value)}
            style={{
              width: "100%",
              padding: "11px 16px",
              borderRadius: 12,
              border: "1px solid #E2E8F0",
              background: "#F8FAFC",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>
    </div>

    {/* 하단 그리드 레이아웃 */}
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 28 }}>
      
      {/* 왼쪽: 학생 리스트 카드 */}
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 24,
          border: "1px solid #F1F5F9",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)",
        }}
      >
       <div
  style={{
    padding: "24px",
    borderBottom: "1px solid #F1F5F9",
    background: "#FFFFFF",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  }}
>
  <div style={{ fontSize: 18, fontWeight: 800, color: "#0F172A" }}>
    👥 학생 진도 현황 및 대상 선택
  </div>

  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}
  >
 

    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        color: "#1D4ED8",
        background: "#DBEAFE",
        padding: "6px 10px",
        borderRadius: 999,
      }}
    >
      선택 {selectedStudentIds.length}명
    </div>
  </div>
</div>

   
{/* 왼쪽: 학생 리스트 섹션 내 리스트 헤더 부분 */}
<div
  style={{
    display: "grid",
    // 학년 컬럼을 빼고 '다음 예정 단원'에 3fr을 줘서 공간을 대폭 확보
    gridTemplateColumns: "60px 100px 1.5fr 110px 3fr", 
    padding: "14px 24px",
    background: "#F8FAFC",
    fontSize: 13,
    fontWeight: 700,
    color: "#64748B",
    borderBottom: "1px solid #E2E8F0",
    alignItems: "center"
  }}
>
  <div style={{ textAlign: "center" }}>선택</div>
  <div>이름</div>
  <div>소속 정보</div>
  <div style={{ textAlign: "center" }}>학습단계</div>
  <div style={{ paddingLeft: 12 }}>예정 학습</div> {/* 헤더 명칭도 좀 더 직관적으로 변경 */}
</div>

{/* 리스트 바디 */}
<div style={{ flex: 1, maxHeight: 520, overflowY: "auto" }}>
  {filteredStudents.map((s) => {
    const checked = selectedStudentIds.includes(s.id);
    return (
      <label
        key={s.id}
        style={{
          display: "grid",
          gridTemplateColumns: "60px 100px 1.5fr 110px 3fr", // 헤더와 동일 비율
          alignItems: "center",
          padding: "16px 24px",
          borderBottom: "1px solid #F1F5F9",
          cursor: "pointer",
          background: checked ? "#F0F9FF" : "transparent",
          transition: "all 0.2s",
          borderLeft: checked ? "4px solid #3B82F6" : "4px solid transparent",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleStudent(s.id)}
            style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#3B82F6" }}
          />
        </div>
        
        {/* 이름 */}
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1E293B" }}>{s.name}</div>
        
        {/* 소속 정보 (학교/학년 통합) */}
        <div style={{ 
          fontSize: 13, 
          color: "#64748B", 
          whiteSpace: "nowrap", 
          overflow: "hidden", 
          textOverflow: "ellipsis",
          paddingRight: 10 
        }}>
          {s.school || "소속 없음"} {s.grade ? `· ${s.grade}` : ""}
        </div>
        
        {/* 학습 단계 */}
        <div style={{ textAlign: "center" }}>
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
    }}
  >
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 6,
        background: checked ? "#DBEAFE" : "#F1F5F9",
        fontSize: 12,
        fontWeight: 800,
        color: checked ? "#2563EB" : "#475569",
      }}
    >
      {`<${progressMap[s.id]?.lastEpisodeIndex ?? 0}강>`}
    </span>

    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleAdjustProgress(s.id);
      }}
      style={{
        border: "none",
        background: "transparent",
        color: "#2563EB",
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
        padding: 0,
      }}
    >
      수정
    </button>
  </div>
</div>
        
        {/* 다음 예정 학습 내용 - 공간이 아주 넉넉해짐 */}
        <div style={{ paddingLeft: 12, overflow: "hidden" }}>
          <div style={{ 
            fontSize: 13, 
            fontWeight: 600, 
            color: checked ? "#2563EB" : "#334155",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            width: "100%"
          }} title={getNextEpisodeLabel(s.id)}>
            {getNextEpisodeLabel(s.id) || "—"}
          </div>
        </div>
      </label>
);
  })}
      </div>
      </div>

  {/* 오른쪽: 배정 요약 카드 */}
<div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
  <div
    style={{
      background: "#FFFFFF", // 다크 블루에서 화이트로 변경
      borderRadius: 24,
      padding: "28px",
      boxShadow: "0 10px 15px -3px rgba(0,0,0,0.04), 0 4px 6px -2px rgba(0,0,0,0.02)",
      border: "1px solid #E2E8F0", // 테두리 추가로 경계 명확히
    }}
  >
    <div style={{ fontSize: 18, fontWeight: 800, color: "#1E293B", marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ color: '#3B82F6' }}>⚡️</span> 배정 실행 요약
    </div>
    
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 각 항목을 연한 배경 박스로 감싸서 에듀코어 느낌 강조 */}
      {[
        { label: "선택된 학생 수", value: `${selectedStudentIds.length} 명`, color: "#0F172A" },
        { label: "배정 과목", value: selectedBook ? SUBJECT_LABEL[selectedBook.subject] : "미지정", color: "#2563EB" },
        { label: "배정 기준일", value: assignDate, color: "#0F172A" }
      ].map((item, idx) => (
        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: '#F8FAFC', borderRadius: 12, border: '1px solid #F1F5F9' }}>
          <span style={{ color: '#64748B', fontSize: 14, fontWeight: 600 }}>{item.label}</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: item.color }}>{item.value}</span>
        </div>
      ))}

{selectedStudentNames.length > 0 && (
  <div
    style={{
      padding: "12px 16px",
      background: "#F8FAFC",
      borderRadius: 12,
      marginTop: 8
    }}
  >
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: "#475569",
        marginBottom: 8
      }}
    >
      선택 학생
    </div>

    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6
      }}
    >
      {selectedStudentNames.slice(0, 3).map((name) => (
        <span
          key={name}
          style={{
            padding: "5px 10px",
            borderRadius: 999,
            background: "#DBEAFE",
            color: "#1D4ED8",
            fontSize: 12,
            fontWeight: 700
          }}
        >
          {name}
        </span>
      ))}

      {selectedStudentNames.length > 3 && (
        <span
          style={{
            padding: "5px 10px",
            borderRadius: 999,
            background: "#E5E7EB",
            color: "#475569",
            fontSize: 12,
            fontWeight: 700
          }}
        >
          +{selectedStudentNames.length - 3}명
        </span>
      )}
    </div>
  </div>
)}

{focusStudentId && (
  <div
    style={{
      background: "#FFFFFF",
      borderRadius: 20,
      border: "1px solid #E2E8F0",
      padding: "20px",
      boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)",
    }}
  >
    <div
      style={{
        fontSize: 15,
        fontWeight: 800,
        color: "#0F172A",
        marginBottom: 14,
      }}
    >
      📚 선택 학생 문제집 현황
    </div>

    {selectedStudentBookStatus.length === 0 ? (
      <div style={{ fontSize: 13, color: "#94A3B8" }}>
        등록된 문제집 진도가 없습니다.
      </div>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {selectedStudentBookStatus.map((row) => (
          <div
            key={row.bookId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              borderRadius: 12,
              background: "#F8FAFC",
              border: "1px solid #F1F5F9",
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#1E293B",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                [{SUBJECT_LABEL[row.subject]}] {row.bookName}
              </div>
            </div>

          <div
  style={{
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    fontSize: 12,
    fontWeight: 700,
    color: "#1D4ED8",
  }}
>
  <div>
    {row.lastEpisodeIndex} / {row.totalEpisodes}강
  </div>

 <div style={{ fontSize: 11, color: "#64748B" }}>
  {row.lastEpisodeIndex >= row.totalEpisodes
    ? "완료"
    : `다음 ${row.lastEpisodeIndex + 1}강`}
</div>
</div>
          </div>
        ))}
      </div>
    )}
  </div>
)}

      {/* 적용 교재는 정보가 길 수 있으므로 별도 처리 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', background: '#F0F7FF', borderRadius: 12, border: '1px solid #E0F2FE', marginTop: 4 }}>
        <span style={{ color: '#0369A1', fontSize: 13, fontWeight: 700 }}>적용 예정 교재</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#075985', lineHeight: 1.5 }}>
          {selectedBook ? selectedBook.name : "교재를 선택해 주세요"}
        </span>
      </div>
    </div>

    <button
      onClick={handleAutoAssign}
      disabled={loading || !selectedBookId || selectedStudentIds.length === 0}
      style={{
        marginTop: 28,
        width: "100%",
        padding: "18px",
        borderRadius: 16,
        border: "none",
        background: loading ? "#CBD5E1" : (selectedBookId && selectedStudentIds.length > 0 ? "#2563EB" : "#94A3B8"),
        color: "#FFFFFF",
        fontSize: 16,
        fontWeight: 800,
        cursor: loading ? "default" : "pointer",
        transition: 'all 0.2s',
        boxShadow: selectedBookId && selectedStudentIds.length > 0 ? "0 4px 12px rgba(37, 99, 235, 0.2)" : "none",
      }}
    >
      {loading ? "배정 중..." : "🚀 과제 일괄 배정하기"}
    </button>
  </div>

  <div style={{ padding: "20px", background: '#F8FAFC', borderRadius: 20, border: '1px solid #E2E8F0' }}>
    <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6, display: 'flex', gap: 8 }}>
       <span>💡</span>
       <span><b>배정 규칙:</b> 학생의 학습 기록을 기반으로 '그 다음 강'이 자동 생성됩니다.</span>
    </div>
  </div>
</div>
    </div>
  </div>
);
}