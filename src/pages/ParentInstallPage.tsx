import { useEffect } from "react";

export default function ParentInstallPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("sid");
    const name = params.get("name") || "학생";

    if (sid) {
      localStorage.setItem("educore_parent_sid", sid);
    }

    const el = document.getElementById("studentName");
    if (el) el.textContent = `${name} 학부모앱`;
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        margin: 0,
        fontFamily: "system-ui",
        background: "#f3f4f6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "white",
          padding: 28,
          borderRadius: 16,
          boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
          textAlign: "center",
          width: 320,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>
          EDUCORE 부모앱
        </div>

        <div
          id="studentName"
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#2563eb",
            marginTop: 8,
            marginBottom: 20,
          }}
        >
          학생 확인 중...
        </div>

        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>
          안드로이드 : Chrome 메뉴 → 홈 화면에 추가
          <br />
          <br />
          아이폰 : Safari 공유 → 홈 화면에 추가
          <br />
          <br />
          설치 후 앱을 열면 자녀 리포트로 바로 연결됩니다.
        </div>
      </div>
    </div>
  );
}