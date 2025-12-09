// src/pages/AutoBookAssignPage.tsx
// src/pages/AutoBookAssignPage.tsx
import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

// 값(value) import
import {
  loadBooks,
  autoAssignNextEpisode,
  loadStudentBookProgress,
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

  // 학생/교재 로드
  useEffect(() => {
    const run = async () => {
      const snap = await getDocs(collection(db, "students"));
      const list: Student[] = snap.docs.map((d) => ({
        id: d.id,
        name: (d.data() as any).name || "이름 없음",
        grade: (d.data() as any).grade,
        school: (d.data() as any).school,
      }));
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

  const selectedBook = books.find((b) => b.id === selectedBookId) || null;

  // 학생 체크 토글
  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
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

    if (
      !window.confirm(
        `선택한 학생 ${selectedStudentIds.length}명에게\n"${selectedBook.name}" 다음 단원을 ${assignDate} 과제로 배정할까요?`
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
    if (!selectedGrade) return true;
    const gradeNum = String(s.grade || "")
      .replace(/[^0-9]/g, "")
      .trim();
    return gradeNum === String(selectedGrade);
  });

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "24px auto",
        padding: "20px 18px 40px",
        background: "#F9FAFB",
        borderRadius: 18,
        boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
        fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, system-ui",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          marginBottom: 18,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
    flexWrap: "wrap",
    gap: 12,
  }}
>
  {/* 왼쪽 텍스트 */}
  <div>
    <div
      style={{
        fontSize: 20,
        fontWeight: 900,
        color: "#1E3A8A",
        marginBottom: 4,
      }}
    >
      🤖 교재 기반 자동 과제 배정
    </div>

    <div style={{ fontSize: 13, color: "#6B7280" }}>
      등록해 둔 교재/단원 정보를 바탕으로 자동 배정합니다.
    </div>
  </div>

  {/* 오른쪽 버튼 */}
  <button
    onClick={() => navigate("/books")}
    style={{
      padding: "8px 14px",
      borderRadius: 999,
      border: "1px solid #CBD5E1",
      background: "#FFF8E1",
      fontSize: 12,
      color: "#B45309",
      whiteSpace: "nowrap",
    }}
  >
    📚 교재 관리
  </button>
</div>
      </div>

      {/* 상단 선택 영역 */}
      <div
        style={{
          marginBottom: 18,
          padding: 14,
          background: "#FFFFFF",
          borderRadius: 14,
          border: "1px solid #E5E7EB",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          {/* 학년 */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#4B5563",
                marginBottom: 4,
              }}
            >
              학년
            </div>
            <select
              value={selectedGrade}
              onChange={(e) => {
                setSelectedGrade(e.target.value);
                setSelectedStudentIds([]);
              }}
              style={{
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #CBD5E1",
                fontSize: 13,
              }}
            >
              <option value="">전체</option>
              <option value="1">중1</option>
              <option value="2">중2</option>
              <option value="3">중3</option>
            </select>
          </div>

          {/* 교재 선택 */}
          <div style={{ minWidth: 240 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#4B5563",
                marginBottom: 4,
              }}
            >
              교재 선택
            </div>
            <select
              value={selectedBookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #CBD5E1",
                fontSize: 13,
              }}
            >
              <option value="">교재를 선택하세요</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({SUBJECT_LABEL[b.subject]})
                </option>
              ))}
            </select>
          </div>

          {/* 과목 표시 (read-only) */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#4B5563",
                marginBottom: 4,
              }}
            >
              과목
            </div>
            <div
              style={{
                minWidth: 80,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #E5E7EB",
                background: "#F9FAFB",
                fontSize: 13,
                color: "#111827",
              }}
            >
              {selectedBook
                ? SUBJECT_LABEL[selectedBook.subject]
                : "—"}
            </div>
          </div>

          {/* 날짜 */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#4B5563",
                marginBottom: 4,
              }}
            >
              날짜
            </div>
            <input
              type="date"
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              style={{
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #CBD5E1",
                fontSize: 13,
              }}
            />
          </div>
        </div>

        {/* 교재 단원 개요 */}
        {selectedBook && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "#6B7280",
              background: "#F9FAFB",
              borderRadius: 8,
              padding: "6px 8px",
              border: "1px solid #E5E7EB",
            }}
          >
            단원 수: <b>{selectedBook.episodes.length}</b>개 · 예: 첫 단원{" "}
            {selectedBook.episodes[0]?.title &&
              `“${selectedBook.episodes[0].title}”`}
          </div>
        )}
      </div>

      {/* 학생 선택 + 실행 버튼 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.3fr 1fr",
          gap: 16,
        }}
      >
        {/* 학생 선택 */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 14,
            border: "1px solid #E5E7EB",
            padding: 12,
            maxHeight: 420,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              marginBottom: 6,
              color: "#111827",
            }}
          >
            👥 학생 선택
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#6B7280",
              marginBottom: 8,
            }}
          >
            학년 필터를 바꾼 뒤, 자동 배정할 학생들을 체크하세요.
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              paddingRight: 4,
              borderRadius: 10,
              border: "1px solid #E5E7EB",
            }}
          >
            {filteredStudents.map((s) => {
              const checked = selectedStudentIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    borderBottom: "1px solid #F3F4F6",
                    cursor: "pointer",
                    background: checked ? "#EEF2FF" : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStudent(s.id)}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#111827",
                      }}
                    >
                      {s.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#6B7280",
                      }}
                    >
                      {s.school} {s.grade}
                    </div>
                    <div style={{ fontSize: 11, color: "#6B7280" }}>
  현재: {progressMap[s.id]?.currentEpisodeIndex ?? 0}단원
</div>
                  </div>
                </label>
              );
            })}

            {filteredStudents.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "#9CA3AF",
                  padding: 10,
                }}
              >
                해당 학년에 학생이 없습니다.
              </div>
            )}
          </div>
        </div>

        {/* 실행 박스 */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 14,
            border: "1px solid #E5E7EB",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: "#111827",
                marginBottom: 6,
              }}
            >
              ⚙ 자동 배정 개요
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#4B5563",
                marginBottom: 8,
              }}
            >
              선택된 교재의 <b>“다음 단원”</b>이 각 학생의{" "}
              <b>studyPlans / 날짜 / 과목</b>에 선생님 과제로 추가되고, 학생별
              교재 진도가 한 칸씩 앞으로 나갑니다.
            </div>

            <div
              style={{
                fontSize: 12,
                color: "#6B7280",
                background: "#F9FAFB",
                borderRadius: 8,
                padding: "8px 10px",
                border: "1px solid #E5E7EB",
              }}
            >
              · 대상 학생 수:{" "}
              <b>{selectedStudentIds.length}</b>명
              <br />
              · 교재:{" "}
              <b>{selectedBook ? selectedBook.name : "미선택"}</b>
              <br />
              · 날짜: <b>{assignDate}</b>
              <br />
              {selectedBook && (
                <>
                  · 과목:{" "}
                  <b>{SUBJECT_LABEL[selectedBook.subject]}</b>
                  <br />
                </>
              )}
            </div>
          </div>

          <button
            onClick={handleAutoAssign}
            disabled={loading}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "10px 0",
              borderRadius: 10,
              border: "none",
              background: loading ? "#9CA3AF" : "#1E3A8A",
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "배정 중..." : "✅ 자동 배정 실행하기"}
          </button>
        </div>
      </div>
    </div>
  );
}