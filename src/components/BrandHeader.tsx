// src/components/BrandHeader.tsx
import React from "react";
import { BRAND } from "../config/brand";

export default function BrandHeader({ isMobile }: { isMobile: boolean }) {
  return (
    <div
      style={{
        textAlign: "center",
        paddingBottom: isMobile ? 18 : 26,
        borderBottom: `1px solid ${BRAND.colors.border}`,
        marginBottom: isMobile ? 22 : 32,
      }}
    >
      {/* 로고 라인 */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: isMobile ? 30 : 44,
            fontWeight: 900,
            letterSpacing: 2,
            color: BRAND.colors.primary,
          }}
        >
          {BRAND.academyMain}
        </span>

        <span
          style={{
            fontSize: isMobile ? 30 : 44,
            fontWeight: 900,
            letterSpacing: 2,
            color: BRAND.colors.secondary,
          }}
        >
          {BRAND.academySub}
        </span>
      </div>

      {/* 슬로건 */}
      <span
        style={{
          marginTop: isMobile ? 4 : 0,
          marginLeft: isMobile ? 0 : 10,
          color: BRAND.colors.gold,
          fontSize: isMobile ? 12 : 18,
          fontStyle: "normal",
          fontWeight: 700,
          textAlign: "center",
          lineHeight: 1.2,
          letterSpacing: 0.4,
          display: "inline-block",
        }}
      >
        {BRAND.slogan}
      </span>

      <div
        style={{
          width: isMobile ? 120 : 240,
          height: 1,
          margin: "10px auto 6px",
          background:
            "linear-gradient(90deg, rgba(184,150,46,0.1), rgba(184,150,46,0.6), rgba(184,150,46,0.1))",
        }}
      />

      {/* 서브 */}
      <div
        style={{
          marginTop: 12,
          fontSize: isMobile ? 10 : 12,
          fontWeight: 600,
          letterSpacing: 1.8,
          color: BRAND.colors.gray,
        }}
      >
        {BRAND.subLabel}
      </div>
    </div>
  );
}