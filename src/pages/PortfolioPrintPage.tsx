// src/pages/PortfolioPrintPage.tsx
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

export default function PortfolioPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [student, setStudent] = useState<any | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const snap = await getDoc(doc(db, "students", id));
      if (snap.exists()) setStudent(snap.data());
    };
    load();
  }, [id]);

  const isMiddle = student?.grade && Number(student.grade) <= 3;

  return (
    <div
      style={{
        padding: "16px",
        fontFamily: "Pretendard, 'Noto Sans KR', system-ui",
      }}
    >
      {/* 미리보기 영역 */}
      <div
        style={{
          marginBottom: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            매니지먼트 포트폴리오 (미리보기)
          </div>
          <div style={{ fontSize: 12, color: "#6B7280" }}>ID: {id}</div>
        </div>

        <button
          onClick={() => window.print()}
          style={{
            padding: "8px 14px",
            fontSize: 13,
            borderRadius: 8,
            border: "1px solid #D1D5DB",
            background: "#F9FAFB",
            cursor: "pointer",
          }}
        >
          🖨 인쇄하기
        </button>
      </div>

      {/* 본문 */}
      {isMiddle ? (
        <MiddlePortfolio student={student} />
      ) : (
        <HighPortfolio student={student} />
      )}
    </div>
  );
}

/* ------------------------- 중학생 템플릿 --------------------------- */

function MiddlePortfolio({ student }: { student: any }) {
  return (
    <div
      style={{
        border: "1px solid #D1D5DB",
        borderRadius: 8,
        padding: 16,
        background: "#FFFFFF",
      }}
    >
      <h2
        style={{
          textAlign: "center",
          fontSize: 20,
          fontWeight: 800,
          marginBottom: 12,
        }}
      >
        {student?.name ?? "학생"}의 학습 포트폴리오 (중등)
      </h2>

      <InfoTable student={student} />

      <SectionTitle>▪ 과목별 단원 진도 체크</SectionTitle>
      <PlaceholderBox height={220}>
        (국/영/수/과/사 단원별 진도표 넣기)
      </PlaceholderBox>

      <SectionTitle>▪ 문제집 관리 · 완성도</SectionTitle>
      <PlaceholderBox height={180}>
        (문제집 진도체크/오답률/완성도)
      </PlaceholderBox>

      <SectionTitle>▪ 수행평가 준비 상태</SectionTitle>
      <PlaceholderBox height={140}>
        (수행평가 일정/준비율/결과 기록)
      </PlaceholderBox>

      <SectionTitle>▪ 집중력 · 학습 태도 변화</SectionTitle>
      <PlaceholderBox height={140}>
        (태도 변화, 집중 시간, 루틴)
      </PlaceholderBox>

      <SectionTitle>▪ 선생님 총평</SectionTitle>
      <PlaceholderBox height={120}>
        (코멘트 입력)
      </PlaceholderBox>
    </div>
  );
}

/* ------------------------- 고등학생 템플릿 --------------------------- */

function HighPortfolio({ student }: { student: any }) {
  return (
    <div
      style={{
        border: "1px solid #D1D5DB",
        borderRadius: 8,
        padding: 16,
        background: "#FFFFFF",
      }}
    >
      <h2
        style={{
          textAlign: "center",
          fontSize: 20,
          fontWeight: 800,
          marginBottom: 12,
        }}
      >
        {student?.name ?? "학생"}의 매니지먼트 포트폴리오 (고등)
      </h2>

      <InfoTable student={student} />

      <SectionTitle>▪ 목표 등급 · 약점 분석</SectionTitle>
      <PlaceholderBox height={180}>
        (과목별 목표, 현재 수준, 약점 분석)
      </PlaceholderBox>

      <SectionTitle>▪ 내신 전략표</SectionTitle>
      <PlaceholderBox height={180}>
        (단원별 요약 전략)
      </PlaceholderBox>

      <SectionTitle>▪ 문제집 / 모의고사 관리</SectionTitle>
      <PlaceholderBox height={180}>
        (모의고사 점수, 문제집 진도)
      </PlaceholderBox>

      <SectionTitle>▪ 월간 성취도 요약</SectionTitle>
      <PlaceholderBox height={140}>
        (월간 그래프·성취·태도)
      </PlaceholderBox>

      <SectionTitle>▪ 선생님 총평</SectionTitle>
      <PlaceholderBox height={140}>
        (코멘트 입력)
      </PlaceholderBox>
    </div>
  );
}

/* ------------------------- 공통 요소 --------------------------- */

function InfoTable({ student }: { student: any }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 11,
        marginBottom: 12,
      }}
    >
      <tbody>
        <tr>
          <td style={leftCell}>학생 이름</td>
          <td style={cell}>{student?.name ?? "____"}</td>
          <td style={leftCell}>학교 / 학년</td>
          <td style={cell}>
            {(student?.school ?? "____") +
              " / " +
              (student?.grade ?? "____")}
          </td>
        </tr>
        <tr>
          <td style={leftCell}>담임/과목</td>
          <td style={cell} colSpan={3}>
            (국/영/수 선택 입력 가능)
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/* 공통 스타일 */
const cell: React.CSSProperties = {
  border: "1px solid #D1D5DB",
  padding: "4px 6px",
};

const leftCell: React.CSSProperties = {
  ...cell,
  background: "#F3F4F6",
  fontWeight: 700,
  width: 80,
};

function SectionTitle({ children }: any) {
  return (
    <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 700 }}>
      {children}
    </div>
  );
}

function PlaceholderBox({
  children,
  height,
}: {
  children?: any;
  height?: number;
}) {
  return (
    <div
      style={{
        border: "1px solid #E5E7EB",
        height: height ?? 160,
        fontSize: 11,
        padding: 8,
        marginBottom: 14,
        color: "#6B7280",
      }}
    >
      {children}
    </div>
  );
}