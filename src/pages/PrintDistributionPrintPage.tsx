import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { useSearchParams } from "react-router-dom";
import { db } from "../firebase";

type SchoolLevel = "middle" | "high" | "all";
type ViewMode = "grouped" | "rows";
type PrintKind = "required" | "optional";
type StatusFilter = "all" | "pending" | "optionalOnly" | "completed";

type StudentRow = {
  id: string;
  name?: string;
  school?: string;
  grade?: string;
  hidden?: boolean;
  isActive?: boolean;
  removed?: boolean;
};

type PrintDistribution = {
  id: string;
  distributedDate: string;
  subject: string;
  title: string;
  studentId: string;
  studentName: string;
  school: string;
  grade: string;
  schoolLevel: "middle" | "high";
  kind: PrintKind;
  submittedDate?: string;
};

type GroupedStudentRows = {
  studentId: string;
  studentName: string;
  school: string;
  grade: string;
  total: number;
  requiredCount: number;
  optionalCount: number;
  pendingSubmit: number;
  completionRate: number;
  status: "danger" | "warning" | "good";
  items: PrintDistribution[];
};

const SUBJECT_OPTIONS = [
  { key: "kor", label: "국어" },
  { key: "math", label: "수학" },
  { key: "eng", label: "영어" },
  { key: "sci", label: "과학" },
  { key: "soc", label: "사회" },
  { key: "hist1", label: "역사1" },
  { key: "hist2", label: "역사2" },
  { key: "tech", label: "기술가정" },
  { key: "hanja", label: "한자" },
  { key: "jp", label: "일본어" },
];

export default function PrintDistributionPrintPage() {
  const [params] = useSearchParams();

  const filterSubject = params.get("subject") || "";
  const filterSchoolLevel = (params.get("schoolLevel") || "") as SchoolLevel | "";
  const filterGrade = params.get("grade") || "";
  const filterSchool = params.get("school") || "";
  const filterStudentName = params.get("studentName") || "";
  const filterDateFrom = params.get("from") || "";
  const filterDateTo = params.get("to") || "";
  const filterKind = (params.get("kind") || "") as PrintKind | "";
  const statusFilter = (params.get("status") || "all") as StatusFilter;
  const viewMode = (params.get("viewMode") || "grouped") as ViewMode;

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [rows, setRows] = useState<PrintDistribution[]>([]);
  const [loading, setLoading] = useState(true);

  const getSubjectLabel = (key: string) =>
    SUBJECT_OPTIONS.find((s) => s.key === key)?.label || key;

  const levelLabel = (level: SchoolLevel) => {
    if (level === "middle") return "중등";
    if (level === "high") return "고등";
    return "전체";
  };

  const kindLabel = (kind: PrintKind) => {
    return kind === "required" ? "제출필수" : "참고자료";
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [studentSnap, rowSnap] = await Promise.all([
        getDocs(collection(db, "students")),
        getDocs(
          query(collection(db, "printDistributions"), orderBy("distributedDate", "desc"))
        ),
      ]);

      const studentList = studentSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as StudentRow[];

      const rowList = rowSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ...data,
          kind: data.kind === "optional" ? "optional" : "required",
        };
      }) as PrintDistribution[];

      setStudents(studentList);
      setRows(rowList);
    } catch (e) {
      console.error("print page load error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const activeStudentIds = useMemo(() => {
    return new Set(
      students
        .filter((s) => s.hidden !== true && s.isActive !== false && s.removed !== true)
        .map((s) => s.id)
    );
  }, [students]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!activeStudentIds.has(row.studentId)) return false;

      if (filterSubject && row.subject !== filterSubject) return false;
      if (filterSchoolLevel && row.schoolLevel !== filterSchoolLevel) return false;
      if (filterGrade && row.grade !== filterGrade) return false;
      if (filterSchool && row.school !== filterSchool) return false;
      if (filterKind && row.kind !== filterKind) return false;

      if (
        filterStudentName &&
        !String(row.studentName || "")
          .toLowerCase()
          .includes(filterStudentName.toLowerCase())
      ) {
        return false;
      }

      if (filterDateFrom && row.distributedDate < filterDateFrom) return false;
      if (filterDateTo && row.distributedDate > filterDateTo) return false;

      if (statusFilter === "pending") {
        return row.kind === "required" && !row.submittedDate;
      }

      if (statusFilter === "optionalOnly") {
        return row.kind === "optional";
      }

      if (statusFilter === "completed") {
        return row.kind === "required" && !!row.submittedDate;
      }

      return true;
    });
  }, [
    rows,
    activeStudentIds,
    filterSubject,
    filterSchoolLevel,
    filterGrade,
    filterSchool,
    filterStudentName,
    filterDateFrom,
    filterDateTo,
    filterKind,
    statusFilter,
  ]);

  const groupedRows = useMemo(() => {
    const map: Record<string, GroupedStudentRows> = {};

    filteredRows.forEach((row) => {
      if (!map[row.studentId]) {
        map[row.studentId] = {
          studentId: row.studentId,
          studentName: row.studentName || "",
          school: row.school || "",
          grade: row.grade || "",
          total: 0,
          requiredCount: 0,
          optionalCount: 0,
          pendingSubmit: 0,
          completionRate: 0,
          status: "good",
          items: [],
        };
      }

      map[row.studentId].items.push(row);
    });

    const result = Object.values(map).map((group) => {
      const sortedItems = [...group.items].sort((a, b) =>
        a.distributedDate.localeCompare(b.distributedDate)
      );

      const requiredItems = sortedItems.filter((x) => x.kind === "required");
      const optionalItems = sortedItems.filter((x) => x.kind === "optional");
      const pendingSubmit = requiredItems.filter((x) => !x.submittedDate).length;
      const completedCount = requiredItems.filter((x) => !!x.submittedDate).length;

      const completionRate =
        requiredItems.length === 0
          ? 100
          : Math.round((completedCount / requiredItems.length) * 100);

      let status: "danger" | "warning" | "good" = "good";
      if (pendingSubmit >= 3) status = "danger";
      else if (pendingSubmit >= 1) status = "warning";

      return {
        ...group,
        items: sortedItems,
        total: sortedItems.length,
        requiredCount: requiredItems.length,
        optionalCount: optionalItems.length,
        pendingSubmit,
        completionRate,
        status,
      };
    });

    return result.sort((a, b) => {
      const aIsMiddle = a.grade.startsWith("중") ? 0 : 1;
      const bIsMiddle = b.grade.startsWith("중") ? 0 : 1;

      if (aIsMiddle !== bIsMiddle) return aIsMiddle - bIsMiddle;
      if (b.pendingSubmit !== a.pendingSubmit) return b.pendingSubmit - a.pendingSubmit;

      const rank = { danger: 0, warning: 1, good: 2 };
      if (rank[a.status] !== rank[b.status]) {
        return rank[a.status] - rank[b.status];
      }

      return a.studentName.localeCompare(b.studentName, "ko");
    });
  }, [filteredRows]);

  const getRowCellStyle = (idx: number): React.CSSProperties => ({
    ...mTd,
    background: idx % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
  });

  const filterSummary = [
    filterSubject ? `과목: ${getSubjectLabel(filterSubject)}` : "과목: 전체",
    filterSchoolLevel ? `구분: ${levelLabel(filterSchoolLevel)}` : "구분: 전체",
    filterGrade ? `학년: ${filterGrade}` : "학년: 전체",
    filterSchool ? `학교: ${filterSchool}` : "학교: 전체",
    filterKind ? `자료구분: ${kindLabel(filterKind)}` : "자료구분: 전체",
    filterStudentName ? `학생명: ${filterStudentName}` : "학생명: 전체",
    filterDateFrom || filterDateTo
      ? `기간: ${filterDateFrom || "처음"} ~ ${filterDateTo || "끝"}`
      : "기간: 전체",
    statusFilter === "pending"
      ? "상태: 미제출만"
      : statusFilter === "optionalOnly"
      ? "상태: 참고자료만"
      : statusFilter === "completed"
      ? "상태: 제출완료"
      : "상태: 전체",
    viewMode === "grouped" ? "보기: 학생별" : "보기: 전체 로그",
  ].join("  |  ");

  return (
    <div className="print-page-bg" style={pageBg}>
      <style>{printStyle}</style>

      <div className="no-print" style={topBar}>
        <div style={{ fontWeight: 900 }}>프린트 배부 인쇄</div>
        <button onClick={() => window.print()} style={printBtn}>
          인쇄 / PDF 저장
        </button>
      </div>

      <div className="print-page" style={page}>
        <div style={headerSection}>
          <div>
            <h1 style={mainTitle}>
              PRINTS <span style={{ color: "#2C4C9D" }}>DISTRIBUTION</span>
            </h1>
            <div style={subTitle}>학생별 프린트 배부 및 제출 관리표</div>
          </div>
          <div style={dateText}>출력일 {new Date().toLocaleDateString("ko-KR")}</div>
        </div>

        <div style={filterBox}>{filterSummary}</div>

        {loading ? (
          <div style={emptyBox}>데이터 로드 중...</div>
        ) : viewMode === "grouped" ? (
          groupedRows.length === 0 ? (
            <div style={emptyBox}>배부 데이터가 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {groupedRows.map((group) => (
                <div key={group.studentId} className="group-card" style={groupCard}>
                  <div style={groupHeader}>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={riskBadgeStyle(group.status)}>{riskLabel(group.status)}</span>
                        <span style={{ fontSize: 15, fontWeight: 900, color: "#0F172A" }}>
                          {group.studentName}
                        </span>
                        <span style={{ color: "#64748B", fontWeight: 700, fontSize: 12 }}>
                          {group.grade} | {group.school}
                        </span>
                        <span style={groupMetaText}>
                          {group.pendingSubmit > 0
                            ? `제출필수 ${group.requiredCount}개 중 미제출 ${group.pendingSubmit}개`
                            : `제출필수 ${group.requiredCount}개 모두 제출 완료`}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={summaryPill}>{`배포 ${group.total}`}</span>
                      <span style={{ ...summaryPill, background: "#DBEAFE", color: "#1D4ED8" }}>
                        {`필수 ${group.requiredCount}`}
                      </span>
                      <span style={{ ...summaryPill, background: "#F1F5F9", color: "#475569" }}>
                        {`참고 ${group.optionalCount}`}
                      </span>
                      <span style={{ ...summaryPill, background: "#FDF2F8", color: "#BE185D" }}>
                        {`미제출 ${group.pendingSubmit}`}
                      </span>
                      <span style={completionPill}>{`완료율 ${group.completionRate}%`}</span>
                    </div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <table style={table}>
                      <thead>
                        <tr>
                          <th style={{ ...mTh, width: 82 }}>배부일</th>
                          <th style={{ ...mTh, width: 92 }}>자료구분</th>
                          <th style={{ ...mTh, width: 60 }}>과목</th>
                          <th style={mTh}>프린트명</th>
                          <th style={{ ...mTh, width: 82 }}>제출일</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((row, idx) => (
                          <tr key={row.id}>
                            <td style={getRowCellStyle(idx)}>{row.distributedDate}</td>
                            <td style={getRowCellStyle(idx)}>
                              <span
                                style={row.kind === "required" ? requiredBadge : optionalBadge}
                              >
                                {kindLabel(row.kind)}
                              </span>
                            </td>
                            <td style={getRowCellStyle(idx)}>{getSubjectLabel(row.subject)}</td>
                            <td
                              style={{
                                ...getRowCellStyle(idx),
                                textAlign: "left",
                                paddingLeft: 10,
                                fontWeight: 700,
                                whiteSpace: "normal",
                                wordBreak: "keep-all",
                                lineHeight: 1.35,
                              }}
                            >
                              {row.title}
                            </td>
                            <td
                              style={{
                                ...mTd,
                                background: idx % 2 === 0 ? "#F8FAFC" : "#F1F5F9",
                              }}
                            >
                              {row.kind === "required"
                                ? row.submittedDate || "________"
                                : "해당없음"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div style={{ overflow: "hidden" }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={{ ...mTh, width: 78 }}>배부일</th>
                  <th style={{ ...mTh, width: 76 }}>학생명</th>
                  <th style={{ ...mTh, width: 88 }}>학교</th>
                  <th style={{ ...mTh, width: 56 }}>학년</th>
                  <th style={{ ...mTh, width: 52 }}>구분</th>
                  <th style={{ ...mTh, width: 84 }}>자료구분</th>
                  <th style={{ ...mTh, width: 56 }}>과목</th>
                  <th style={mTh}>프린트명</th>
                  <th style={{ ...mTh, width: 80 }}>제출일</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={emptyText}>
                      배부 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, idx) => (
                    <tr key={row.id}>
                      <td style={getRowCellStyle(idx)}>{row.distributedDate}</td>
                      <td style={{ ...getRowCellStyle(idx), fontWeight: 800 }}>
                        {row.studentName || "-"}
                      </td>
                      <td style={getRowCellStyle(idx)}>{row.school || "-"}</td>
                      <td style={getRowCellStyle(idx)}>{row.grade || "-"}</td>
                      <td style={getRowCellStyle(idx)}>
                        <span style={badge}>{levelLabel(row.schoolLevel)}</span>
                      </td>
                      <td style={getRowCellStyle(idx)}>
                        <span style={row.kind === "required" ? requiredBadge : optionalBadge}>
                          {kindLabel(row.kind)}
                        </span>
                      </td>
                      <td style={getRowCellStyle(idx)}>{getSubjectLabel(row.subject)}</td>
                      <td
                        style={{
                          ...getRowCellStyle(idx),
                          textAlign: "left",
                          paddingLeft: 10,
                          fontWeight: 700,
                          whiteSpace: "normal",
                          wordBreak: "keep-all",
                          lineHeight: 1.35,
                        }}
                      >
                        {row.title}
                      </td>
                      <td
                        style={{
                          ...mTd,
                          background: idx % 2 === 0 ? "#F8FAFC" : "#F1F5F9",
                        }}
                      >
                        {row.kind === "required"
                          ? row.submittedDate || "________"
                          : "해당없음"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div style={footer}>OPTIMUM EDUCORE · PRINT DISTRIBUTION LOG</div>
      </div>
    </div>
  );
}

const riskBadgeStyle = (
  status: GroupedStudentRows["status"]
): React.CSSProperties => {
  if (status === "danger") return dangerPill;
  if (status === "warning") return warningPill;
  return goodPill;
};

const riskLabel = (status: GroupedStudentRows["status"]) => {
  if (status === "danger") return "위험";
  if (status === "warning") return "주의";
  return "정상";
};

const printStyle = `
  @media print {
    .no-print { display: none !important; }

    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: white !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    @page {
      size: A4 landscape;
      margin: 8mm;
    }

    table {
      page-break-inside: auto;
    }

    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    .print-page-bg {
      background: white !important;
      padding: 0 !important;
      min-height: auto !important;
    }

    .print-page {
      margin: 0 auto !important;
      min-height: auto !important;
      box-shadow: none !important;
      border: none !important;
    }

    .group-card {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
`;

const pageBg: React.CSSProperties = {
  background: "#F3F6FA",
  padding: "20px 0 36px",
};

const topBar: React.CSSProperties = {
  width: "297mm",
  margin: "0 auto 10px",
  background: "#0F172A",
  color: "#FFFFFF",
  borderRadius: 12,
  padding: "12px 16px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  boxSizing: "border-box",
};

const printBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: "#1D4ED8",
  color: "#FFFFFF",
  fontWeight: 800,
  cursor: "pointer",
};

const page: React.CSSProperties = {
  width: "297mm",
  margin: "0 auto",
  background: "#FFFFFF",
  border: "1px solid #CBD5E1",
  boxSizing: "border-box",
  padding: "10mm",
};

const headerSection: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  marginBottom: 12,
  borderBottom: "2px solid #334155",
  paddingBottom: 10,
};

const mainTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  fontWeight: 900,
  color: "#0F172A",
  letterSpacing: "-0.4px",
};

const subTitle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "#64748B",
};

const dateText: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  fontWeight: 700,
};

const filterBox: React.CSSProperties = {
  background: "#F1F5F9",
  border: "1px solid #94A3B8",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 12,
  color: "#334155",
  lineHeight: 1.5,
  marginBottom: 12,
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed",
  border: "1px solid #CBD5E1",
};

const mTh: React.CSSProperties = {
  padding: "10px 8px",
  fontSize: 11,
  color: "#FFFFFF",
  fontWeight: 800,
  textAlign: "center",
  background: "#334155",
  border: "1px solid #475569",
};

const mTd: React.CSSProperties = {
  padding: "10px 8px",
  fontSize: 11,
  textAlign: "center",
  background: "#FFFFFF",
  border: "1px solid #E2E8F0",
  verticalAlign: "middle",
  color: "#0F172A",
};

const badge: React.CSSProperties = {
  padding: "3px 6px",
  borderRadius: 6,
  background: "#E2E8F0",
  fontSize: 10,
  fontWeight: 800,
  color: "#334155",
};

const requiredBadge: React.CSSProperties = {
  padding: "3px 7px",
  borderRadius: 6,
  background: "#DBEAFE",
  border: "1px solid #93C5FD",
  fontSize: 10,
  fontWeight: 800,
  color: "#1D4ED8",
};

const optionalBadge: React.CSSProperties = {
  padding: "3px 7px",
  borderRadius: 6,
  background: "#F1F5F9",
  border: "1px solid #CBD5E1",
  fontSize: 10,
  fontWeight: 800,
  color: "#475569",
};

const emptyText: React.CSSProperties = {
  textAlign: "center",
  padding: 28,
  color: "#64748B",
  fontSize: 13,
  border: "1px solid #E2E8F0",
  background: "#FFFFFF",
};

const emptyBox: React.CSSProperties = {
  textAlign: "center",
  padding: 40,
  color: "#64748B",
  border: "1px solid #E2E8F0",
  borderRadius: 8,
  background: "#FFFFFF",
};

const footer: React.CSSProperties = {
  marginTop: 10,
  textAlign: "right",
  fontSize: 10,
  color: "#94A3B8",
  fontWeight: 700,
};

const groupCard: React.CSSProperties = {
  border: "1px solid #CBD5E1",
  borderRadius: 12,
  background: "#FFFFFF",
  padding: 10,
};

const groupHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const summaryPill: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 999,
  background: "#E2E8F0",
  color: "#334155",
  fontSize: 11,
  fontWeight: 800,
};

const dangerPill: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 999,
  background: "#FEE2E2",
  color: "#B91C1C",
  border: "1px solid #FCA5A5",
  fontSize: 10,
  fontWeight: 900,
};

const warningPill: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 999,
  background: "#FEF3C7",
  color: "#92400E",
  border: "1px solid #FCD34D",
  fontSize: 10,
  fontWeight: 900,
};

const goodPill: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 999,
  background: "#DCFCE7",
  color: "#166534",
  border: "1px solid #86EFAC",
  fontSize: 10,
  fontWeight: 900,
};

const completionPill: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 999,
  background: "#EEF2FF",
  color: "#3730A3",
  fontSize: 11,
  fontWeight: 800,
};

const groupMetaText: React.CSSProperties = {
  fontSize: 11,
  color: "#64748B",
  fontWeight: 700,
};