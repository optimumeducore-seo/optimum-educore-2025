// src/config/brand.ts
import { BRAND_OPTIMUM } from "./brand.optimum";
import { BRAND_CLIENT_A } from "./brand.clientA";

// ✅ 배포/납품할 때 여기만 바꾸면 됨
const ACTIVE = "OPTIMUM" as const; // or "CLIENT_A"

export const BRAND = ACTIVE === "OPTIMUM" ? BRAND_OPTIMUM : BRAND_CLIENT_A;
export type Brand = typeof BRAND;