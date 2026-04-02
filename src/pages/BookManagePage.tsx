import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DevWatermark from "../components/DevWatermark";
import {
  loadBooks,
  saveBook,
  migrateEpisodesToChapters,
  flattenChaptersToEpisodes,
} from "../services/firestore";

import type {
  Book,
  BookChapter,
  BookSection,
  BookSubject,
} from "../services/firestore";


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
const theme = {
  primary: "#3B82F6",
  primaryLight: "#EFF6FF",
  textMain: "#1E293B",
  textSub: "#64748B",
  bgPage: "#F8FAFC",
  bgCard: "#FFFFFF",
  border: "#E2E8F0",
  inputBorder: "#CBD5E1",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 8,
  fontSize: 13,
  fontWeight: 700,
  color: theme.textMain,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: `1px solid ${theme.inputBorder}`,
  fontSize: 14,
  transition: "all 0.2s",
  outline: "none",
  backgroundColor: "#FFFFFF",
  boxSizing: "border-box",
};

const cardStyle: React.CSSProperties = {
  background: theme.bgCard,
  borderRadius: 16,
  border: `1px solid ${theme.border}`,
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.03)",
  overflow: "hidden",
  marginBottom: 32,
};

const chapterHeaderStyle: React.CSSProperties = {
  padding: "18px 24px",
  background: "#F1F5F9",
  borderBottom: `1px solid ${theme.border}`,
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const badgeStyle: React.CSSProperties = {
  background: theme.primary,
  color: "#fff",
  padding: "4px 10px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
};

const pageInputStyle: React.CSSProperties = {
  width: 40,
  border: "none",
  fontSize: 13,
  textAlign: "center",
  outline: "none",
  background: "transparent",
};

const minuteInputStyle: React.CSSProperties = {
  width: 40,
  border: "none",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "right",
  outline: "none",
  background: "transparent",
};

const sbTheme = {
  bg: "#0F172A",          // 깊은 다크 네이비
  active: "#3B82F6",      // 메인 블루
  hover: "rgba(255, 255, 255, 0.05)",
  border: "rgba(255, 255, 255, 0.08)",
  textMain: "#F1F5F9",
  textMuted: "#94A3B8",
};

const styles = {
  sidebar: {
    width: 280,
    background: "#1E293B", // 투명도 없는 묵직한 슬레이트 네이비
    color: "#FFFFFF",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
  },
  header: {
    padding: "24px",
    borderBottom: "1px solid #334155", // 은은한 구분선
  },
  logo: {
    fontSize: 22,
    fontWeight: 800,
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  masterBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: "#EF4444", // 뱃지 배경 빼고 텍스트 컬러로만 포인트
    border: "1px solid #EF4444",
    padding: "1px 6px",
    borderRadius: "4px",
    letterSpacing: "0.5px",
  },
  searchBox: {
    padding: "16px",
  },
  searchInput: {
    width: "100%",
    padding: "10px 14px",
    borderRadius: "6px",
    border: "1px solid #334155",
    background: "#0F172A", // 인풋창은 더 어둡게 눌러서 가독성 확보
    color: "#FFFFFF",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  },
  bookList: {
    flex: 1,
    overflowY: "auto",
    padding: "0 12px 16px",
  },
  bookItem: (isActive: boolean) => ({
    padding: "12px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "4px",
    background: isActive ? "#3B82F6" : "transparent", // 선택된 것만 확실하게 블루
    transition: "background 0.2s",
  }),
  footer: {
    padding: "16px",
    borderTop: "1px solid #334155",
  },
  addButton: {
    width: "100%",
    padding: "12px",
    borderRadius: "6px",
    background: "#334155",
    color: "#FFFFFF",
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 14,
  }
};

export default function BookManagePage() {
  const navigate = useNavigate();

  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  const [name, setName] = useState("");

  const [publisher, setPublisher] = useState("");
  const [subject, setSubject] = useState<BookSubject>("kor");
  const [gradeGroup, setGradeGroup] = useState<"중1" | "중2" | "중3" | "고1" |"">("");
  const [videoPlatform, setVideoPlatform] = useState("");
  const [videoSeries, setVideoSeries] = useState("");
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [bookSearch, setBookSearch] = useState("");

  const loadAllBooks = async () => {
    const list = await loadBooks();
    setBooks(list);
    if (list.length > 0 && !selectedBookId) {
      setSelectedBookId(list[0].id);
    }
  };

  useEffect(() => {
    loadAllBooks();
  }, []);

  useEffect(() => {
    if (!selectedBookId) {
  setName("");
  setPublisher("");
  setSubject("kor");
  setGradeGroup("");
  setVideoPlatform("");
  setVideoSeries("");
  setChapters([]);
  return;
}

    const b = books.find((x) => x.id === selectedBookId);
    if (!b) return;

    setName(b.name || "");
setPublisher((b as any).publisher || "");
setSubject(b.subject);
setGradeGroup((b as any).gradeGroup || "");
setVideoPlatform((b as any).videoPlatform || "");
setVideoSeries((b as any).videoSeries || "");

    const migrated =
      b.chapters && b.chapters.length
        ? b.chapters
        : migrateEpisodesToChapters(b.episodes || []);

    setChapters(migrated);
  }, [selectedBookId, books]);

  const resetForm = () => {
  setSelectedBookId(null);
  setName("");
  setPublisher("");
  setSubject("kor");
  setGradeGroup("");
  setVideoPlatform("");
  setVideoSeries("");
  setChapters([]);
  setBookSearch("");
};

  const updateChapterTitle = (chapterId: string, title: string) => {
    setChapters((prev) =>
      prev.map((ch) => (ch.id === chapterId ? { ...ch, title } : ch))
    );
  };

  const updateUnitTitle = (unitId: string, title: string) => {
    setChapters((prev) =>
      prev.map((ch) => ({
        ...ch,
        units: ch.units.map((u) => (u.id === unitId ? { ...u, title } : u)),
      }))
    );
  };

  const updateSection = (sectionId: string, patch: Partial<BookSection>) => {
    setChapters((prev) =>
      prev.map((ch) => ({
        ...ch,
        units: ch.units.map((u) => ({
          ...u,
          sections: u.sections.map((s) =>
            s.id === sectionId ? { ...s, ...patch } : s
          ),
        })),
      }))
    );
  };

  const addChapter = () => {
    setChapters((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: "",
        units: [],
      },
    ]);
  };

  const addUnit = (chapterId: string) => {
    setChapters((prev) =>
      prev.map((ch) =>
        ch.id === chapterId
          ? {
              ...ch,
              units: [
                ...ch.units,
                {
                  id: crypto.randomUUID(),
                  title: "",
                  sections: [],
                },
              ],
            }
          : ch
      )
    );
  };

  const addSection = (unitId: string) => {
    setChapters((prev) => {
      const totalSectionCount = prev.reduce((sum, ch) => {
        return (
          sum +
          ch.units.reduce((unitSum, u) => unitSum + u.sections.length, 0)
        );
      }, 0);

      const nextEpisode = `${totalSectionCount + 1}강`;

      return prev.map((ch) => ({
        ...ch,
        units: ch.units.map((u) =>
          u.id === unitId
            ? {
                ...u,
                sections: [
                  ...u.sections,
                  {
                    id: crypto.randomUUID(),
                    title: "",
                    videoEpisode: nextEpisode,
                    startPage: undefined,
                    endPage: undefined,
                    videoTitle: "",
                    videoMin: undefined,
                  } as BookSection,
                ],
              }
            : u
        ),
      }));
    });
  };

  const removeChapter = (chapterId: string) => {
    if (!window.confirm("이 대단원을 삭제할까요?")) return;
    setChapters((prev) => prev.filter((ch) => ch.id !== chapterId));
  };

  const removeUnit = (unitId: string) => {
    if (!window.confirm("이 중단원을 삭제할까요?")) return;
    setChapters((prev) =>
      prev.map((ch) => ({
        ...ch,
        units: ch.units.filter((u) => u.id !== unitId),
      }))
    );
  };

  const removeSection = (sectionId: string) => {
    if (!window.confirm("이 소단원을 삭제할까요?")) return;
    setChapters((prev) =>
      prev.map((ch) => ({
        ...ch,
        units: ch.units.map((u) => ({
          ...u,
          sections: u.sections.filter((s) => s.id !== sectionId),
        })),
      }))
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert("교재명을 입력해주세요.");
      return;
    }

    const cleanedChapters: BookChapter[] = chapters
      .map((ch) => ({
        ...ch,
        title: ch.title.trim(),
        units: ch.units
          .map((u) => ({
            ...u,
            title: u.title.trim(),
            sections: u.sections
              .map((s) => ({
                ...s,
                title: (s.title || "").trim(),
                videoEpisode: (s.videoEpisode || "").trim(),
                videoTitle: (s.videoTitle || "").trim(),
                startPage:
                  s.startPage !== undefined && s.startPage !== null
                    ? s.startPage
                    : undefined,
                endPage:
                  s.endPage !== undefined && s.endPage !== null
                    ? s.endPage
                    : undefined,
                videoMin:
                  s.videoMin !== undefined && s.videoMin !== null
                    ? s.videoMin
                    : undefined,
              }))
              .filter(
                (s) =>
                  s.title ||
                  s.videoEpisode ||
                  s.videoTitle ||
                  s.startPage !== undefined ||
                  s.endPage !== undefined ||
                  s.videoMin !== undefined
              ),
          }))
          .filter((u) => u.title || u.sections.length > 0),
      }))
      .filter((ch) => ch.title || ch.units.length > 0);

      console.log("저장 직전 gradeGroup", gradeGroup);
console.log("저장 직전 selectedBookId", selectedBookId);

    await saveBook({
  id: selectedBookId || undefined,
  name: name.trim(),
  publisher: publisher.trim(),
  subject,
  gradeGroup,
  videoPlatform: videoPlatform.trim(),
  videoSeries: videoSeries.trim(),
  episodes: flattenChaptersToEpisodes(cleanedChapters),
  chapters: cleanedChapters,
});

   alert("에듀코어 시스템에 저장되었습니다.");
await loadAllBooks();

if (selectedBookId) {
  const saved = await loadBooks();
  const current = saved.find((x) => x.id === selectedBookId);
  if (current) {
    setName(current.name || "");
    setPublisher((current as any).publisher || "");
    setSubject(current.subject);
    setGradeGroup((current as any).gradeGroup || "");
    setVideoPlatform((current as any).videoPlatform || "");
    setVideoSeries((current as any).videoSeries || "");

    const migrated =
      current.chapters && current.chapters.length
        ? current.chapters
        : migrateEpisodesToChapters(current.episodes || []);

    setChapters(migrated);
  }
}
  };

 const subjectOrder: BookSubject[] = [
  "kor",
  "math",
  "eng",
  "sci",
  "soc",
  "hist1",
  "hist2",
  "tech",
  "hanja",
  "jp",
];

const groupedBooks = useMemo(() => {
  const keyword = bookSearch.trim().toLowerCase();

  const filtered = books.filter((b) =>
    `${b.name} ${(b as any).publisher || ""} ${SUBJECT_LABEL[b.subject]}`
      .toLowerCase()
      .includes(keyword)
  );

  const grouped: Record<BookSubject, Book[]> = {} as Record<BookSubject, Book[]>;

  subjectOrder.forEach((subjectKey) => {
    const arr = filtered
      .filter((b) => b.subject === subjectKey)
      .sort((a, b) => {
        const publisherA = ((a as any).publisher || "").toLowerCase();
        const publisherB = ((b as any).publisher || "").toLowerCase();

        if (publisherA !== publisherB) {
          return publisherA.localeCompare(publisherB, "ko");
        }

        return a.name.localeCompare(b.name, "ko");
      });

    if (arr.length > 0) {
      grouped[subjectKey] = arr;
    }
  });

  return grouped;
}, [books, bookSearch]);

  return (
    <>
    {/* 🛡️ 보안 워터마크 레이어 (최상단 배치) */}
    <DevWatermark userLabel="Optimum_Admin" />
  <div
    style={{
      display: "flex",
      height: "100vh",
      background: "#F1F5F9",
      overflow: "hidden",
      fontFamily: "Pretendard, Inter, system-ui, sans-serif",
    }}
  >
<aside
  style={{
    width: 280,
    background: "#1E293B",
    color: "#FFFFFF",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
  }}
>
  {/* 로고 영역 */}
  <div style={{ padding: "24px", borderBottom: "1px solid #334155" }}>
    <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
      EDUCORE
      <span style={{ 
        fontSize: 20, 
        fontWeight: 700, 
        color: "#EF4444", 
     
        padding: "1px 6px", 
        borderRadius: 4 
      }}>MASTER</span>
    </h1>
  </div>

  {/* 검색 영역 */}
  <div style={{ padding: "16px" }}>
    <input
      placeholder="교재명, 출판사 검색..."
      value={bookSearch}
      onChange={(e) => setBookSearch(e.target.value)}
      style={{
        width: "100%",
        padding: "10px 14px",
        borderRadius: 6,
        border: "1px solid #334155",
        background: "#0F172A",
        color: "#FFFFFF",
        fontSize: 13,
        outline: "none",
        boxSizing: "border-box",
      }}
    />
    <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 10, paddingLeft: 4 }}>
      총 {books.length}권의 교재
    </div>
  </div>

  {/* 리스트 영역 (문제의 그 부분) */}
  <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
  {subjectOrder.map((subjectKey) => {
    const subjectBooks = groupedBooks[subjectKey];
    if (!subjectBooks || subjectBooks.length === 0) return null;

    return (
      <div key={subjectKey} style={{ marginBottom: 14 }}>
        <div
          style={{
            padding: "8px 10px",
            fontSize: 12,
            fontWeight: 800,
            color: "#94A3B8",
            letterSpacing: "0.3px",
          }}
        >
          {SUBJECT_LABEL[subjectKey]}
        </div>

        {subjectBooks.map((b) => {
          const isActive = selectedBookId === b.id;

          return (
            <div
              key={b.id}
              onClick={() => setSelectedBookId(b.id)}
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                cursor: "pointer",
                marginBottom: 4,
                background: isActive ? "#3B82F6" : "transparent",
                transition: "background 0.2s",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700 }}>{b.name}</div>
              <div
                style={{
                  fontSize: 11,
                  color: isActive ? "#DBEAFE" : "#94A3B8",
                  marginTop: 4,
                }}
              >
                {(b as any).publisher || "-"}
              </div>
            </div>
          );
        })}
      </div>
    );
  })}
</div>

  {/* 하단 버튼 영역 */}
  <div style={{ padding: "16px", borderTop: "1px solid #334155" }}>
    <button
      onClick={resetForm}
      style={{
        width: "100%",
        padding: "12px",
        borderRadius: 6,
        background: "#334155",
        color: "#FFFFFF",
        border: "none",
        cursor: "pointer",
        fontWeight: 700,
        fontSize: 14,
      }}
    >
      + 새 교재 등록
    </button>
  </div>
</aside>
    <main
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "40px 20px",
        backgroundColor: theme.bgPage,
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        {/* 상단 헤더 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 32,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontWeight: 850,
                color: theme.textMain,
                fontSize: 30,
                letterSpacing: "-0.5px",
              }}
            >
              교재 상세 설정
            </h2>
            <div
              style={{
                marginTop: 8,
                color: theme.textSub,
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              교육 콘텐츠의 구조를 체계적으로 관리하고 페이지와 강의 정보를
              매칭합니다.
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => navigate("/auto-assign")}
              style={{
                padding: "12px 20px",
                background: "#fff",
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: 10,
                fontWeight: 700,
                cursor: "pointer",
                color: theme.textMain,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 16 }}>🤖</span>
              자동 배정 도구
            </button>

            <button
              onClick={handleSave}
              style={{
                padding: "12px 28px",
                background: theme.primary,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 10px 15px -3px rgba(59, 130, 246, 0.3)",
              }}
            >
              💾 변경사항 저장하기
            </button>
          </div>
        </div>

        {/* 메인 메타 정보 카드 */}
        <div
          style={{
            ...cardStyle,
            padding: 28,
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 1.2fr",
            gap: 16,
            alignItems: "end",
          }}
        >
          <div>
            <label style={labelStyle}>교재명</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              placeholder="교재 타이틀 입력"
            />
          </div>

          <div>
            <label style={labelStyle}>과목</label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value as BookSubject)}
              style={inputStyle}
            >
              {Object.entries(SUBJECT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          
          <div>
  <label style={labelStyle}>학년</label>
  <select
    value={gradeGroup}
    onChange={(e) =>
      setGradeGroup(e.target.value as "중1" | "중2" | "중3" | "")
    }
    style={inputStyle}
  >
    <option value="">학년 없음</option>
    <option value="중1">중1</option>
    <option value="중2">중2</option>
    <option value="중3">중3</option>
    <option value="고1">고1</option>
  </select>
</div>
           
          <div>
            <label style={labelStyle}>출판사</label>
            <input
              value={publisher}
              onChange={(e) => setPublisher(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>동영상 플랫폼</label>
            <input
              value={videoPlatform}
              onChange={(e) => setVideoPlatform(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>연결 강좌명</label>
            <input
              value={videoSeries}
              onChange={(e) => setVideoSeries(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        {/* 단원 설정 리스트 */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {chapters.map((ch, cIdx) => (
            <div key={ch.id} style={cardStyle}>
              {/* 대단원 헤더 */}
              <div style={chapterHeaderStyle}>
                <div style={badgeStyle}>Chapter {cIdx + 1}</div>

                <input
                  value={ch.title}
                  onChange={(e) => updateChapterTitle(ch.id, e.target.value)}
                  placeholder="대단원 제목을 입력하세요"
                  style={{
                    ...inputStyle,
                    border: "none",
                    background: "transparent",
                    fontWeight: 800,
                    fontSize: 18,
                    padding: "4px 8px",
                    flex: 1,
                  }}
                />

                <button
                  onClick={() => addUnit(ch.id)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: "#E2E8F0",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  + 중단원 추가
                </button>

                <button
                  onClick={() => removeChapter(ch.id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#94A3B8",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  삭제
                </button>
              </div>

              {/* 중단원 영역 */}
              <div style={{ padding: "20px 24px" }}>
                {ch.units.map((u, uIdx) => (
                  <div
                    key={u.id}
                    style={{
                      marginBottom: 30,
                      paddingLeft: 12,
                      borderLeft: `3px solid ${theme.border}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        marginBottom: 16,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 800,
                          color: theme.primary,
                        }}
                      >
                        {cIdx + 1}.{uIdx + 1}
                      </span>

                      <input
                        value={u.title}
                        onChange={(e) => updateUnitTitle(u.id, e.target.value)}
                        placeholder="중단원 제목"
                        style={{ ...inputStyle, width: 360, fontWeight: 600 }}
                      />

                      <button
                        onClick={() => addSection(u.id)}
                        style={{
                          fontSize: 12,
                          color: theme.primary,
                          background: theme.primaryLight,
                          border: "none",
                          padding: "6px 12px",
                          borderRadius: 6,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        + 소단원(강의) 추가
                      </button>

                      <button
                        onClick={() => removeUnit(u.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#94A3B8",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                      >
                        삭제
                      </button>
                    </div>

                    {/* 소단원 그리드 */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(500px, 1fr))",
                        gap: 12,
                        paddingLeft: 20,
                      }}
                    >
                      {u.sections.map((s) => (
                        <div
                          key={s.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            background: "#FBFCFD",
                            padding: "12px",
                            borderRadius: 10,
                            border: `1px solid ${theme.border}`,
                          }}
                        >
                          <input
                            value={s.videoEpisode || ""}
                            onChange={(e) =>
                              updateSection(s.id, {
                                videoEpisode: e.target.value,
                              })
                            }
                            placeholder="회차"
                            style={{
                              width: 60,
                              textAlign: "center",
                              border: "none",
                              background: theme.primaryLight,
                              color: theme.primary,
                              fontWeight: 800,
                              borderRadius: 6,
                              padding: "6px 0",
                              outline: "none",
                            }}
                          />

                          <input
                            value={s.title || ""}
                            onChange={(e) =>
                              updateSection(s.id, { title: e.target.value })
                            }
                            placeholder="강의명"
                            style={{
                              flex: 1,
                              border: "none",
                              background: "transparent",
                              fontSize: 14,
                              fontWeight: 500,
                              outline: "none",
                            }}
                          />

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              background: "#fff",
                              padding: "4px 8px",
                              borderRadius: 6,
                              border: `1px solid ${theme.border}`,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                color: "#94A3B8",
                                fontWeight: 700,
                              }}
                            >
                              P.
                            </span>

                            <input
                              type="number"
                              value={s.startPage ?? ""}
                              onChange={(e) =>
                                updateSection(s.id, {
                                  startPage: e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                })
                              }
                              style={pageInputStyle}
                            />

                            <span style={{ color: theme.border }}>~</span>

                            <input
                              type="number"
                              value={s.endPage ?? ""}
                              onChange={(e) =>
                                updateSection(s.id, {
                                  endPage: e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                })
                              }
                              style={pageInputStyle}
                            />
                          </div>

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 2,
                            }}
                          >
                            <input
                              type="number"
                              value={s.videoMin ?? ""}
                              onChange={(e) =>
                                updateSection(s.id, {
                                  videoMin: e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                })
                              }
                              style={minuteInputStyle}
                            />
                            <span
                              style={{
                                fontSize: 11,
                                color: "#94A3B8",
                              }}
                            >
                              min
                            </span>
                          </div>

                          <button
                            onClick={() => removeSection(s.id)}
                            style={{
                              border: "none",
                              background: "none",
                              color: "#CBD5E1",
                              cursor: "pointer",
                              fontSize: 16,
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <button
            onClick={addChapter}
            style={{
              padding: 24,
              border: `2px dashed ${theme.inputBorder}`,
              borderRadius: 16,
              background: "#fff",
              color: theme.textSub,
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 16,
              transition: "all 0.2s",
            }}
          >
            + 새로운 대단원 추가하기
          </button>
        </div>
      </div>
    </main>
  </div>
  </>
);
}
