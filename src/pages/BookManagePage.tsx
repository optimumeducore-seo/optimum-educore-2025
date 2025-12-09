// src/pages/BookManagePage.tsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
  loadBooks,
  saveBook,
  migrateEpisodesToChapters,
  flattenChaptersToEpisodes,
} from "../services/firestore";

import type {
  Book,
  BookChapter,
  BookUnit,
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

export default function BookManagePage() {
  const navigate = useNavigate();

  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  // 편집 중인 책 상태
  const [name, setName] = useState("");
  const [subject, setSubject] = useState<BookSubject>("kor");
  const [chapters, setChapters] = useState<BookChapter[]>([]);

  const resetForm = () => {
    setSelectedBookId(null);
    setName("");
    setSubject("kor");
    setChapters([]);
  };

  const loadAllBooks = async () => {
    const list = await loadBooks();
    setBooks(list);
    if (list.length > 0 && !selectedBookId) {
      setSelectedBookId(list[0].id);
    }
  };

  useEffect(() => {
    loadAllBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 교재 선택 시, 폼에 불러오기
  useEffect(() => {
    if (!selectedBookId) {
      setName("");
      setSubject("kor");
      setChapters([]);
      return;
    }

    const b = books.find((x) => x.id === selectedBookId);
    if (!b) return;

    setName(b.name);
    setSubject(b.subject);

    if (b.chapters && b.chapters.length) {
      setChapters(b.chapters);
    } else {
      // 예전 flat episodes만 있는 경우 → 기본 계층 구조로 임시 변환
      setChapters(migrateEpisodesToChapters(b.episodes || []));
    }
  }, [selectedBookId, books]);

  /* ====== 계층 편집 핸들러 ====== */

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

  const updateChapterTitle = (chapterId: string, title: string) => {
    setChapters((prev) =>
      prev.map((ch) =>
        ch.id === chapterId ? { ...ch, title } : ch
      )
    );
  };

  const removeChapter = (chapterId: string) => {
    if (!window.confirm("이 대단원을 삭제할까요? (하위 중단원/소단원도 함께 삭제됩니다)")) {
      return;
    }
    setChapters((prev) => prev.filter((ch) => ch.id !== chapterId));
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

  const updateUnitTitle = (unitId: string, title: string) => {
    setChapters((prev) =>
      prev.map((ch) => ({
        ...ch,
        units: ch.units.map((u) =>
          u.id === unitId ? { ...u, title } : u
        ),
      }))
    );
  };

  const removeUnit = (unitId: string) => {
    if (!window.confirm("이 중단원을 삭제할까요? (하위 소단원도 함께 삭제됩니다)")) {
      return;
    }
    setChapters((prev) =>
      prev.map((ch) => ({
        ...ch,
        units: ch.units.filter((u) => u.id !== unitId),
      }))
    );
  };

  const addSection = (unitId: string) => {
    setChapters((prev) =>
      prev.map((ch) => ({
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
                    startPage: undefined,
                    endPage: undefined,
                    videoTitle: "",
                    videoMin: undefined,
                  } as BookSection,
                ],
              }
            : u
        ),
      }))
    );
  };

  const updateSection = (
    sectionId: string,
    patch: Partial<BookSection>
  ) => {
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

  /* ====== 저장 ====== */

  const handleSave = async () => {
    if (!name.trim()) {
      alert("교재 이름을 입력하세요.");
      return;
    }

    // 빈 제목/완전 빈 소단원 제거하면서 정리
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
                title: s.title.trim(),
              }))
              .filter(
                (s) =>
                  s.title ||
                  s.startPage !== undefined ||
                  s.endPage !== undefined ||
                  s.videoTitle
              ),
          }))
          .filter((u) => u.title || u.sections.length > 0),
      }))
      .filter((ch) => ch.title || ch.units.length > 0);

    const episodes = flattenChaptersToEpisodes(cleanedChapters);

    const id = await saveBook({
      id: selectedBookId || undefined,
      name: name.trim(),
      subject,
      episodes,
      chapters: cleanedChapters,
    });

    alert("교재 저장 완료!");
    setSelectedBookId(id);
    setChapters(cleanedChapters);
    await loadAllBooks();
  };

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
      <div
        style={{
          marginBottom: 18,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 900,
              color: "#1E3A8A",
              marginBottom: 4,
            }}
          >
            📚 교재 / 단원 관리
          </div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>
            숨마, 자이스토리 등 교재를 등록하고{" "}
            <b>대단원 &gt; 중단원 &gt; 소단원</b>별로 페이지/인강 정보를
            입력하세요. 자동 과제 배정에서 활용됩니다.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            onClick={resetForm}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #CBD5E1",
              background: "#FFFFFF",
              fontSize: 12,
            }}
          >
            ➕ 새 교재 입력
          </button>
          <button
            onClick={() => navigate("/auto-assign")}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #CBD5E1",
              background: "#F0F9FF",
              fontSize: 12,
              color: "#0369A1",
            }}
          >
            🤖 자동 배정 페이지
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          gap: 16,
        }}
      >
        {/* 왼쪽: 교재 리스트 */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 14,
            border: "1px solid #E5E7EB",
            padding: 12,
            maxHeight: 540,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              marginBottom: 8,
              color: "#111827",
            }}
          >
            📖 교재 목록
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#6B7280",
              marginBottom: 6,
            }}
          >
            클릭하면 오른쪽에서 계층 구조를 수정할 수 있습니다.
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {books.map((b) => {
              const active = b.id === selectedBookId;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedBookId(b.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 9px",
                    borderRadius: 10,
                    border: active
                      ? "1px solid #1E3A8A"
                      : "1px solid transparent",
                    background: active ? "#EEF2FF" : "#F9FAFB",
                    marginBottom: 6,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}
                  >
                    {b.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#6B7280" }}>
                    {SUBJECT_LABEL[b.subject]} · 단원{" "}
                    {b.episodes?.length || 0}개
                  </div>
                </button>
              );
            })}

            {books.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "#9CA3AF",
                  marginTop: 12,
                }}
              >
                아직 등록된 교재가 없습니다. 오른쪽 상단의{" "}
                <b>“새 교재 입력”</b> 버튼을 눌러 등록을 시작하세요.
              </div>
            )}
          </div>
        </div>

        {/* 오른쪽: 선택 교재 편집 */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 14,
            border: "1px solid #E5E7EB",
            padding: 14,
          }}
        >
          {/* 교재 기본 정보 */}
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#4B5563",
                  marginBottom: 4,
                }}
              >
                교재 이름
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예) 숨마쿰라우데 중학 국어 문법"
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #D1D5DB",
                  padding: "6px 8px",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ width: 160 }}>
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
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value as BookSubject)}
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #D1D5DB",
                  padding: "6px 8px",
                  fontSize: 13,
                }}
              >
                {Object.entries(SUBJECT_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 계층 구조 편집 */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>
              대단원 / 중단원 / 소단원 구조
            </div>
            <button
              onClick={addChapter}
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid #CBD5E1",
                fontSize: 11,
                background: "#F9FAFB",
              }}
            >
              ➕ 대단원 추가
            </button>
          </div>

          <div
            style={{
              maxHeight: 360,
              overflowY: "auto",
              paddingRight: 4,
              borderRadius: 10,
              border: "1px solid #E5E7EB",
            }}
          >
            {chapters.map((ch, chIdx) => (
              <div
                key={ch.id}
                style={{
                  padding: 10,
                  borderBottom:
                    chIdx === chapters.length - 1
                      ? "none"
                      : "1px solid #F3F4F6",
                  background: "#FFFFFF",
                }}
              >
                {/* 대단원 헤더 */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    대단원 #{chIdx + 1}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => addUnit(ch.id)}
                      style={{
                        fontSize: 11,
                        borderRadius: 999,
                        border: "1px solid #CBD5E1",
                        background: "#F9FAFB",
                        padding: "2px 8px",
                      }}
                    >
                      ➕ 중단원 추가
                    </button>
                    <button
                      onClick={() => removeChapter(ch.id)}
                      style={{
                        fontSize: 11,
                        color: "#EF4444",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>

                {/* 대단원 제목 */}
                <div style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#4B5563",
                      marginBottom: 2,
                    }}
                  >
                    대단원명
                  </div>
                  <input
                    value={ch.title}
                    onChange={(e) =>
                      updateChapterTitle(ch.id, e.target.value)
                    }
                    placeholder="예) 품사"
                    style={{
                      width: "100%",
                      borderRadius: 8,
                      border: "1px solid #E5E7EB",
                      padding: "5px 7px",
                      fontSize: 12,
                    }}
                  />
                </div>

                {/* 중단원들 */}
                {ch.units.map((u, uIdx) => (
                  <div
                    key={u.id}
                    style={{
                      marginBottom: 10,
                      padding: 8,
                      borderRadius: 8,
                      background: "#F9FAFB",
                    }}
                  >
                    {/* 중단원 헤더 */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700 }}>
                        중단원 #{uIdx + 1}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => addSection(u.id)}
                          style={{
                            fontSize: 11,
                            borderRadius: 999,
                            border: "1px solid #CBD5E1",
                            background: "#FFFFFF",
                            padding: "2px 8px",
                          }}
                        >
                          ➕ 소단원 추가
                        </button>
                        <button
                          onClick={() => removeUnit(u.id)}
                          style={{
                            fontSize: 11,
                            color: "#EF4444",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    </div>

                    {/* 중단원 제목 */}
                    <div style={{ marginBottom: 6 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#4B5563",
                          marginBottom: 2,
                        }}
                      >
                        중단원명
                      </div>
                      <input
                        value={u.title}
                        onChange={(e) =>
                          updateUnitTitle(u.id, e.target.value)
                        }
                        placeholder="예) 품사의 종류"
                        style={{
                          width: "100%",
                          borderRadius: 8,
                          border: "1px solid #E5E7EB",
                          padding: "5px 7px",
                          fontSize: 12,
                        }}
                      />
                    </div>

                    {/* 소단원들 */}
                    {u.sections.map((s, sIdx) => (
                      <div
                        key={s.id}
                        style={{
                          marginBottom:
                            sIdx === u.sections.length - 1 ? 0 : 8,
                          padding: 8,
                          borderRadius: 8,
                          background: "#FFFFFF",
                          border: "1px solid #E5E7EB",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 4,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: "#4B5563",
                            }}
                          >
                            소단원 #{sIdx + 1}
                          </div>
                          <button
                            onClick={() => removeSection(s.id)}
                            style={{
                              fontSize: 11,
                              color: "#EF4444",
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                            }}
                          >
                            삭제
                          </button>
                        </div>

                        {/* 소단원명 */}
                        <div style={{ marginBottom: 6 }}>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: "#4B5563",
                              marginBottom: 2,
                            }}
                          >
                            소단원명
                          </div>
                          <input
                            value={s.title}
                            onChange={(e) =>
                              updateSection(s.id, {
                                title: e.target.value,
                              })
                            }
                            placeholder="예) 품사의 개념 정리"
                            style={{
                              width: "100%",
                              borderRadius: 8,
                              border: "1px solid #E5E7EB",
                              padding: "5px 7px",
                              fontSize: 12,
                            }}
                          />
                        </div>

                        {/* 페이지 + 인강 */}
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            alignItems: "flex-end",
                          }}
                        >
                          <div style={{ width: 110 }}>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#4B5563",
                                marginBottom: 2,
                              }}
                            >
                              시작 페이지
                            </div>
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
                              placeholder="예) 12"
                              style={{
                                width: "100%",
                                borderRadius: 8,
                                border: "1px solid #E5E7EB",
                                padding: "5px 7px",
                                fontSize: 12,
                              }}
                            />
                          </div>

                          <div style={{ width: 110 }}>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#4B5563",
                                marginBottom: 2,
                              }}
                            >
                              끝 페이지
                            </div>
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
                              placeholder="예) 18"
                              style={{
                                width: "100%",
                                borderRadius: 8,
                                border: "1px solid #E5E7EB",
                                padding: "5px 7px",
                                fontSize: 12,
                              }}
                            />
                          </div>

                          <div style={{ flex: 1, minWidth: 160 }}>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#4B5563",
                                marginBottom: 2,
                              }}
                            >
                              인강 제목 (선택)
                            </div>
                            <input
                              value={s.videoTitle ?? ""}
                              onChange={(e) =>
                                updateSection(s.id, {
                                  videoTitle: e.target.value,
                                })
                              }
                              placeholder="예) 품사 개념 1강"
                              style={{
                                width: "100%",
                                borderRadius: 8,
                                border: "1px solid #E5E7EB",
                                padding: "5px 7px",
                                fontSize: 12,
                              }}
                            />
                          </div>

                          <div style={{ width: 110 }}>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#4B5563",
                                marginBottom: 2,
                              }}
                            >
                              인강 분량(분)
                            </div>
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
                              placeholder="예) 20"
                              style={{
                                width: "100%",
                                borderRadius: 8,
                                border: "1px solid #E5E7EB",
                                padding: "5px 7px",
                                fontSize: 12,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    {u.sections.length === 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#9CA3AF",
                          marginTop: 4,
                        }}
                      >
                        소단원이 없습니다. <b>“소단원 추가”</b>를 눌러
                        등록해 주세요.
                      </div>
                    )}
                  </div>
                ))}

                {ch.units.length === 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#9CA3AF",
                      marginTop: 4,
                    }}
                  >
                    중단원이 없습니다. <b>“중단원 추가”</b> 버튼을 눌러
                    등록해 주세요.
                  </div>
                )}
              </div>
            ))}

            {chapters.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "#9CA3AF",
                  padding: 12,
                }}
              >
                아직 대단원이 없습니다. 오른쪽 상단의{" "}
                <b>“대단원 추가”</b> 버튼을 눌러 처음부터 등록해 주세요.
              </div>
            )}
          </div>

          <button
            onClick={handleSave}
            style={{
              marginTop: 14,
              width: "100%",
              padding: "9px 0",
              borderRadius: 10,
              border: "none",
              background: "#1E3A8A",
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            💾 교재 저장하기
          </button>
        </div>
      </div>
    </div>
  );
}