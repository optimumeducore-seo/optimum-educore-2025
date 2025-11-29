import { useEffect, useState } from "react";
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
};

export default function QRCardsPage() {
  const [students, setStudents] = useState<Student[]>([]);

  // 학생 불러오기
  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(collection(db, "students"));
      setStudents(
        snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) } as Student)
        )
      );
    };
    load();
  }, []);

  // 배열을 9명씩 나누기
  const chunk = (arr: Student[], size: number): Student[][] =>
    arr.reduce((acc: Student[][], _, i) =>
      (i % size ? acc : [...acc, arr.slice(i, i + size)]), []);

  const groups = chunk(students, 9);

  // PDF 생성
  const downloadPDF = async () => {
    const pdf = new jsPDF("p", "mm", "a4");

    for (let pageIndex = 0; pageIndex < groups.length; pageIndex++) {
      const pageDiv = document.getElementById(`page-${pageIndex}`);
      if (!pageDiv) continue;

      const canvas = await html2canvas(pageDiv, {
        scale: 3,
        backgroundColor: "#fff",
      });

      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const imgData = canvas.toDataURL("image/png");

      if (pageIndex !== 0) pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
    }

    pdf.save("QR_cards.pdf");
  };

  return (
    <div style={{ padding: 20, fontFamily: "Pretendard" }}>
      <h2 style={{ textAlign: "center", marginBottom: 20 }}>
        📇 Optimum Educore QR 명함 자동 생성
      </h2>

      <button
        onClick={downloadPDF}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #2563eb",
          background: "#eff6ff",
          color: "#1e3a8a",
          fontWeight: 700,
          marginBottom: 20,
          cursor: "pointer",
        }}
      >
        📄 PDF 다운로드
      </button>

      {groups.map((group: Student[], idx: number) => (
  <div
    key={idx}
    id={`page-${idx}`}
    style={{
      width: "210mm",
      height: "297mm",
      padding: "8mm",
      background: "#fff",
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gridTemplateRows: "repeat(3, 1fr)",
      gap: "8mm",
    }}
  >
    {group.map((s: Student) => (
      <div
        key={s.id}
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          textAlign: "center",
          padding: "6mm 0 4mm 0",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
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
          <span style={{ color: "#b71c1c", fontSize: 22, fontWeight: 900 }}>
            O
          </span>

          <span
            style={{
              color: "#000000",
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            PTIMUM
          </span>

          <span
            style={{
              color: "#1e3a8a",
              fontSize: 22,
              fontWeight: 900,
              marginLeft: 2,
            }}
          >
            E
          </span>

          <span
            style={{
              color: "#000000",
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            DUCORE
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

  {/* QR 중앙정렬 */}
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
      size={120}
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
      color: "#0f8855",
      fontStyle: "italic",
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
    ))}
  </div>
))}
    </div>
  );
}