import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import QRCode from "react-qr-code";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

type Student = {
  id: string;
  name: string;
  grade: string;
  school: string;
  hidden?: any;
  isHidden?: any;
  hide?: any;
  status?: any;
  active?: any;
    removed?: boolean;
};

export default function QRCardsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(collection(db, "students"));

snap.docs.forEach((d) => {
  console.log("학생데이터:", d.id, d.data());
});
     const list = snap.docs
  .map((d) => ({ id: d.id, ...(d.data() as any) } as Student))
  .filter((s: any) => s.removed !== true);   // ✅ removed:true는 제외

setStudents(list);
      // setSelectedIds(list.map((s) => s.id)); // 처음부터 전부 선택하고 싶으면 주석 해제
    };
    load();
  }, []);

const isHiddenStudent = (s: any) => {
  // active가 false면 숨김
  if (s.active === false) return true;
  if (s.active === "false") return true;
  if (s.active === 0) return true;
  if (s.active === "0") return true;

  return false;
};

  const chunk = (arr: Student[], size: number): Student[][] =>
    arr.reduce(
      (acc: Student[][], _, i) =>
        i % size ? acc : [...acc, arr.slice(i, i + size)],
      []
    );




  const toggleStudent = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedStudents = useMemo(
    () => students.filter((s) => selectedIds.includes(s.id)),
    [students, selectedIds]
  );

  // ✅ 3명/페이지
  const sideGroups = useMemo(() => chunk(selectedStudents, 3), [selectedStudents]);

  // ✅ 이름카드(9cm×3.5cm)용 폰트 자동 조절
const getNameFontSize = (name: string) => {
    const len = (name || "").replace(/\s+/g, "").length;
    if (len <= 2) return 120; // 2글자 (매우 크게)
    if (len === 3) return 100; // 3글자 (꽉 차게)
    if (len === 4) return 85;  // 4글자
    return 70;                 // 5글자 이상
  };

  // ✅ (중요) 네가 만든 QR카드 “그대로” 재사용 컴포넌트
  const QRCard = ({ s }: { s: Student }) => (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        textAlign: "center",
        padding: "6mm 0 4mm 0",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        background: "#fff",
        width: "85mm", // ✅ 3명/페이지용으로 폭만 고정(디자인은 그대로)
      }}
    >
      {/* ==== 텍스트 로고 ==== */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "center",
          gap: 2,
          marginBottom: "4mm",
          userSelect: "none",
        }}
      >
        <span style={{ color: "#b71c1c", fontSize: 18, fontWeight: 900 }}>
          OPTIMUM
        </span>

        <span
          style={{
            color: "#1e3a8a",
            fontSize: 18,
            fontWeight: 900,
            marginLeft: 2,
          }}
        >
          EDUCORE
        </span>
      </div>

      {/* 이름 */}
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "#1e3a8a",
          marginBottom: 4,
        }}
      >
        {s.name}
      </div>

      {/* 학교 + 학년 */}
      <div style={{ fontSize: 11, marginBottom: 8 }}>
        {s.school} · {s.grade}
      </div>

      {/* QR */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          marginTop: 4,
        }}
      >
        <QRCode
          value={`https://optimum-educore-2025.web.app/student?id=${s.id}&auto=1`}
          size={120} // ✅ 너가 쓰던 그대로
        />
      </div>

      {/* 안내문 */}
      <div
        style={{
          fontSize: 10,
          marginTop: 8,
          color: "#374151",
          lineHeight: 1.4,
        }}
      >
        ① QR 스캔 → 자동 로그인
        <br />
        ② 등원 버튼 누르면 끝!
      </div>

      {/* 슬로건 */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#0d5f3d",
          
          marginTop: "auto",
          paddingTop: 8,
          lineHeight: 1.45,
          width: "100%",
          textAlign: "center",
        }}
      >
        Design Your Routine
        <br />
        Own the Result
      </div>
    </div>
  );

  const downloadPDF = async () => {
    if (selectedStudents.length === 0) {
      alert("출력할 학생을 선택해줘!");
      return;
    }

    const pdf = new jsPDF("p", "mm", "a4");
    const pageIds: string[] = [];
    for (let i = 0; i < sideGroups.length; i++) pageIds.push(`side-page-${i}`);

    for (let i = 0; i < pageIds.length; i++) {
      const pageDiv = document.getElementById(pageIds[i]);
      if (!pageDiv) continue;

      const canvas = await html2canvas(pageDiv, {
        scale: 3,
        backgroundColor: "#fff",
      });

      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const imgData = canvas.toDataURL("image/png");

      if (i !== 0) pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
    }

    pdf.save("QRCard_NameCard_3perPage.pdf");
  };

  return (
    <div style={{ padding: 20, fontFamily: "Pretendard" }}>
      <h2 style={{ textAlign: "center", marginBottom: 14 }}>
        📇 Optimum Educore (QR카드 + 이름카드) 3명/페이지
      </h2>

      {/* ✅ 학생 선택 패널 */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 10 }}>
          ✅ 출력할 학생 선택 (클릭)
          <span style={{ marginLeft: 8, color: "#1e3a8a" }}>
            {selectedIds.length}명 선택
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setSelectedIds(students.map((s) => s.id))}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd" }}
          >
            전체선택
          </button>
          <button
            onClick={() => setSelectedIds([])}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd" }}
          >
            선택해제
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 8,
          }}
        >
          {students.map((s) => {
            const on = selectedIds.includes(s.id);
            return (
              <div
                key={s.id}
                onClick={() => toggleStudent(s.id)}
                style={{
                  cursor: "pointer",
                  padding: "10px 10px",
                  borderRadius: 10,
                  border: on ? "2px solid #1e3a8a" : "1px solid #e5e7eb",
                  background: on ? "#eff6ff" : "#fff",
                  fontWeight: 800,
                  textAlign: "center",
                  userSelect: "none",
                }}
              >
                {s.name}
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={downloadPDF}
        disabled={selectedIds.length === 0}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #2563eb",
          background: selectedIds.length === 0 ? "#f3f4f6" : "#eff6ff",
          color: "#1e3a8a",
          fontWeight: 800,
          marginBottom: 20,
          cursor: selectedIds.length === 0 ? "not-allowed" : "pointer",
        }}
      >
        📄 PDF 다운로드 (3명/페이지: QR카드 + 이름카드)
      </button>

      {/* ===================== */}
      {/* ✅ 3명/페이지: 왼쪽 이름카드 + 오른쪽 QR카드(네 디자인 그대로) */}
      {/* ===================== */}
      {sideGroups.map((group: Student[], idx: number) => (
        <div
          key={`side-${idx}`}
          id={`side-page-${idx}`}
          style={{
            width: "210mm",
            height: "297mm",
            padding: "12mm",
            background: "#fff",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "10mm",
            marginBottom: 20,
          }}
        >
          {group.map((s: Student) => (
            <div
              key={s.id}
              style={{
                height: "84mm",
                 
                padding: "10mm",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10mm",
                
              }}
            >
              {/* ✅ 왼쪽: 이름카드 10cm × 3.9cm */}
             <div
  style={{
    width: "100mm",
    height: "39mm",
    border: "0.7px solid #000",
    borderRadius: "4mm",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    background: "#fff",
    flexShrink: 0,
  }}
>
               <div
    style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      // 폰트 크기를 키우고, letterSpacing으로 자간 조절
      fontSize: `${getNameFontSize(s.name)}px`, 
      fontWeight: 800,
      color: "#111",
      lineHeight: 0.8, // 줄간격을 줄여서 글자가 더 꽉 차 보이게
      whiteSpace: "nowrap",
      padding: "0 4mm",
      letterSpacing: "-1mm", // 글자가 너무 벌어지지 않게 약간 조임 (취향껏 조절)
    }}
  >
    {/* split().join(" ")을 제거하여 글자 본연의 크기를 키움 */}
    {s.name}
  </div>

              <div
    style={{
      height: "8mm", // 하단 띠지를 조금 더 두껍게 (안정감)
      background: "#1E3A8A",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      letterSpacing: "1.5px",
      fontWeight: 800,
      flexShrink: 0,
    }}
  >
    OPTIMUM EDUCORE
  </div>
              </div>

              {/* ✅ 오른쪽: QR카드 (네가 만든 그대로) */}
              <QRCard s={s} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}