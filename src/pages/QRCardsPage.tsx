import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import QRCode from "react-qr-code";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export default function QRCardsPage() {
  const [students, setStudents] = useState<any[]>([]);

  // 🔥 학생 불러오기
  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(collection(db, "students"));
      setStudents(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      );
    };
    load();
  }, []);

  const downloadPDF = async () => {
    const area = document.getElementById("print-area");
    if (!area) return;

    const canvas = await html2canvas(area, { scale: 3 });
    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF("p", "mm", "a4");
    const width = 210;
    const height = (canvas.height * width) / canvas.width;

    pdf.addImage(imgData, "PNG", 0, 0, width, height);
    pdf.save("qr_cards.pdf");
  };

  return (
    <div style={{ padding: 20, fontFamily: "Pretendard" }}>
      <h2 style={{ textAlign: "center", marginBottom: 20 }}>
        📇 학생 QR 카드 자동 생성
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

      {/* A4 출력 영역 */}
      <div
        id="print-area"
        style={{
          width: "210mm",
          minHeight: "297mm",
          padding: "10mm",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "10mm",
          background: "white",
        }}
      >
        {students.map((s) => (
          <div
            key={s.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 10,
              textAlign: "center",
              width: "100%",
              background: "#fafafa",
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                marginBottom: 8,
                color: "#1e3a8a",
              }}
            >
              {s.name}
            </div>

            <QRCode
              value={`https://optimum-educore-2025.web.app/student?id=${s.id}`}
              size={80}
            />

            <div style={{ fontSize: 10, marginTop: 8, color: "#374151" }}>
              Scan → 자동 로그인 페이지 이동
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}