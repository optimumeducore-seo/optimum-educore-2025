import React, { useEffect, useMemo, useState } from "react";

// 닉네임과 시스템 명칭 설정
const DEV = "CODE_SJ";
const SYSTEM = "EDUCORE";

type Props = {
  userLabel?: string;
};

export default function SecurityLayer({ userLabel = "unknown" }: Props) {
  const [time, setTime] = useState("");

  // 로그인한 선생님 이메일 우선 사용
  const resolvedUser =
    userLabel ||
    (typeof window !== "undefined"
      ? localStorage.getItem("teacher_email") || "unknown"
      : "unknown");

  // 새로고침마다 고유 세션 ID
  const sessionId = useMemo(
    () => Math.random().toString(36).substring(2, 10).toUpperCase(),
    []
  );

  // 시간 갱신
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setTime(
        `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
          d.getDate()
        ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
          d.getMinutes()
        ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`
      );
    };

    updateTime();
    const t1 = setInterval(updateTime, 1000);

    return () => clearInterval(t1);
  }, []);

  // 단축키 차단
  useEffect(() => {
    const blockKeys = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      // 복사 / 저장 / 소스보기 / 인쇄
      if (ctrlOrMeta && ["c", "u", "s", "p"].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // 개발자도구 일부
      if (ctrlOrMeta && e.shiftKey && ["i", "j", "c"].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // F12
      if (e.key === "F12") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener("keydown", blockKeys, true);
    window.addEventListener("contextmenu", blockContextMenu);

    return () => {
      window.removeEventListener("keydown", blockKeys, true);
      window.removeEventListener("contextmenu", blockContextMenu);
    };
  }, []);

  return (
    <>
      {/* 1. 상단 보안 바: 투명도를 높여 시야 방해 최소화 */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "20px",
          zIndex: 10000,
          background: "rgba(15, 23, 42, 0.7)",
          color: "rgba(148, 163, 184, 0.8)",
          fontSize: "9px",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          letterSpacing: "0.5px",
        }}
      >
        {SYSTEM} SECURED · {resolvedUser} [{sessionId}]
      </div>

      {/* 2. 전체 오버레이: 눈의 피로를 줄인 정적 워터마크 */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        {/* 2-1. 정적인 텍스트 패턴 (애니메이션 제거) */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-around",
            alignContent: "space-around",
            height: "140%",
            width: "140%",
            marginLeft: "-20%",
            marginTop: "-10%",
            transform: "rotate(-20deg)",
          }}
        >
          {Array.from({ length: 32 }).map((_, i) => (
            <div
              key={i}
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "rgba(100, 116, 139, 0.035)",
                whiteSpace: "nowrap",
                padding: "80px 60px",
                userSelect: "none",
              }}
            >
              {DEV} · {resolvedUser} · {sessionId}
            </div>
          ))}
        </div>
      </div>

      {/* 3. 우하단 추적 배지 */}
      <div
        style={{
          position: "fixed",
          right: 70,
          bottom: 20,
          zIndex: 10000,
          background: "rgba(15, 23, 42, 0.6)",
          backdropFilter: "blur(4px)",
          color: "rgba(255, 255, 255, 0.7)",
          padding: "8px 12px",
          borderRadius: "8px",
          fontSize: "9px",
          fontWeight: 500,
          border: "1px solid rgba(255, 255, 255, 0.05)",
          pointerEvents: "none",
          textAlign: "right",
        }}
      >
        <div
          style={{
            color: "#60A5FA",
            fontWeight: 800,
            fontSize: "8px",
            marginBottom: "2px",
          }}
        >
          AUTH_ACTIVE
        </div>
        <div>{resolvedUser}</div>
        <div style={{ opacity: 0.5 }}>{time}</div>
      </div>
    </>
  );
}