import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, runTransaction } from "firebase/firestore";
import { db } from "../firebase";

// ---------- types ----------
type Task = { key: string; label: string; target: number; done: number };

type Range = {
  id: string;
  big: string;
  small: string;
  pages: string;
  tasks: Task[];
};

type Subject = {
  key: string;
  name: string;
  progress?: number;
  // ✅ 이제 ranges가 진짜 배열
  ranges?: Range[];
};

type StudentExamDoc = {
  title: string;
  examStart?: string;
  totalProgress?: number;
  subjects: Subject[];
};

// ---------- utils ----------
const clamp = (min: number, v: number, max: number) =>
  Math.max(min, Math.min(v, max));

const ddayDiff = (targetYmd?: string) => {
  if (!targetYmd) return null;
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const t1 = new Date(targetYmd + "T00:00:00").getTime();
  if (isNaN(t1)) return null;
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
};

const ddayLabel = (diff: number | null) => {
  if (diff === null) return "";
  if (diff === 0) return "D-DAY";
  if (diff > 0) return `D-${diff}일`;
  return `D+${Math.abs(diff)}일`;
};

const getDdayColorByDiff = (diff: number | null, fallback: string) => {
  if (diff === null) return fallback;
  if (diff <= 0) return "#22C55E"; // D-DAY / 지남: 초록
  if (diff <= 2) return "#EF4444"; // 1~2일: 빨강
  if (diff <= 7) return "#F59E0B"; // 3~7일: 주황
  return fallback; // 8일~: 기본
};

// ✅ subjects/tasks 정규화 (배열/객체 둘 다 대응)
const normalizeExamDoc = (raw: any): StudentExamDoc => {
  const subjectsArr: any[] = Array.isArray(raw?.subjects)
    ? raw.subjects
    : Object.values(raw?.subjects || {});

  const subjects: Subject[] = subjectsArr.map((s: any) => {
    const rangesArr: any[] = Array.isArray(s?.ranges)
      ? s.ranges
      : Object.values(s?.ranges || {});

    const ranges: Range[] = rangesArr.map((rg: any, idx: number) => {
      const tasksArr: any[] = Array.isArray(rg?.tasks)
        ? rg.tasks
        : Object.values(rg?.tasks || {});

      const tasks: Task[] = tasksArr.map((t: any) => ({
        key: String(t?.key ?? ""),
        label: String(t?.label ?? ""),
        target: Number(t?.target ?? 0),
        done: Number(t?.done ?? 0),
      }));

      return {
        id: String(rg?.id ?? `${String(s?.key ?? "sub")}-${idx}`),
        big: String(rg?.big ?? ""),
        small: String(rg?.small ?? ""),
        pages: String(rg?.pages ?? ""),
        tasks,
      };
    });

    return {
      key: String(s?.key ?? ""),
      name: String(s?.name ?? ""),
      progress: Number(s?.progress ?? 0),
      ranges,
    };
  });

  return {
    title: String(raw?.title ?? "시험 플랜"),
    examStart: String(raw?.examStart ?? ""),
    totalProgress: Number(raw?.totalProgress ?? 0),
    subjects,
  };
};

// ✅ 진행률 재계산(학생 done만 반영)
const updateProgress = (docData: StudentExamDoc) => {
  const subjects = Array.isArray(docData.subjects) ? docData.subjects : [];
  let totalDone = 0;
  let totalTarget = 0;

  subjects.forEach((sub) => {
    let subDone = 0;
    let subTarget = 0;

    (sub.ranges || []).forEach((rg) => {
      (rg.tasks || []).forEach((t) => {
        subDone += Number(t.done || 0);
        subTarget += Number(t.target || 0);
      });
    });

    sub.progress = subTarget > 0 ? Math.round((subDone / subTarget) * 100) : 0;

    totalDone += subDone;
    totalTarget += subTarget;
  });

  docData.totalProgress = totalTarget > 0 ? Math.round((totalDone / totalTarget) * 100) : 0;
};

// ---------- UI Tokens ----------
const COLORS = {
  main: "#0F172A",
  primary: "#3B82F6",
  accent: "#8B5CF6",
  success: "#10B981",
  warning: "#F59E0B",
  bg: "#F8FAFC",
  card: "#FFFFFF",
  border: "rgba(226, 232, 240, 0.9)",
  textMain: "#1E293B",
  textSub: "#64748B",
};

export default function StudentExamMode() {
  const { studentId: paramStudentId, examId } = useParams<{ studentId: string; examId: string }>();
  const studentId = paramStudentId || localStorage.getItem("studentId") || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<StudentExamDoc | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [openSubKey, setOpenSubKey] = useState<string | null>(null);

  // 1) fetch
  const fetchData = async () => {
    if (!studentId || !examId) return;
    setLoading(true);
    setErr("");

    try {
      const ref = doc(db, "studentExams", studentId, "exams", examId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("시험 데이터를 찾지 못했어요.");

      const raw = snap.data();
      const payload = normalizeExamDoc(raw);

      // 화면 계산용 progress 재계산(원하면 DB도 맞추려면 transaction 때 저장)
      updateProgress(payload);

      setData(payload);
    } catch (e: any) {
      setErr(e?.message || "불러오기 실패");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, examId]);

  // 2) D-day
  const diff = useMemo(() => ddayDiff(data?.examStart), [data?.examStart]);
  const ddayText = useMemo(() => ddayLabel(diff), [diff]);
  const ddayColor = useMemo(() => getDdayColorByDiff(diff, COLORS.primary), [diff]);

  // 3) numbers safe
  const totalP = clamp(0, Number(data?.totalProgress ?? 0), 100);


  // 4) toggle (subjectKey/taskKey 기반)
  const toggleTask = async (subjectKey: string, rangeId: string, taskKey: string) => {
    if (!studentId || !examId) return;
    if (updatingKey) return;

    const lockKey = `${subjectKey}:${rangeId}:${taskKey}`;
    setUpdatingKey(lockKey);

    try {
      const ref = doc(db, "studentExams", studentId, "exams", examId);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("시험 데이터를 찾지 못했어요.");

        const latest = snap.data();
        const latestData = normalizeExamDoc(latest);

        // ✅ 과목 찾기
        const sub = latestData.subjects.find((s) => s.key === subjectKey);
        if (!sub) throw new Error("과목을 찾지 못했어요.");

        // ✅ 소단원(range) 찾기
        const rg = (sub.ranges || []).find((r) => r.id === rangeId);
        if (!rg) throw new Error("소단원을 찾지 못했어요.");

        // ✅ 소단원 안 task 찾기
        const task = (rg.tasks || []).find((t) => t.key === taskKey);
        if (!task) throw new Error("과제 항목을 찾지 못했어요.");

        // ✅ done < target 이면 +1, 꽉차면 0 리셋
        const doneNow = Number(task.done ?? 0);
        const targetNow = Number(task.target ?? 0);

        if (targetNow <= 0) task.done = 0;
        else if (doneNow < targetNow) task.done = doneNow + 1;
        else task.done = 0;

        // ✅ progress 재계산 (ranges 기준으로 바꿔둔 updateProgress여야 함)
        updateProgress(latestData);

        // ✅ 저장
        tx.update(ref, {
          subjects: latestData.subjects,
          totalProgress: Number(latestData.totalProgress ?? 0),
        });

        // ✅ UI 업데이트
        setData(latestData);
      });
    } catch (e: any) {
      alert(e?.message || "진도 저장 실패");
      fetchData();
    } finally {
      setUpdatingKey(null);
    }
  };

  // ---------- views ----------
  if (loading) return <div style={{ padding: 50, textAlign: "center", fontWeight: 900 }}>Loading Plan...</div>;

  if (err) {
    return (
      <div style={{ padding: 50, textAlign: "center" }}>
        <div style={{ fontWeight: 900, color: "#B91C1C" }}>오류</div>
        <div style={{ marginTop: 8, color: "#7F1D1D" }}>{err}</div>
      </div>
    );
  }

  if (!data) return <div style={{ padding: 50, textAlign: "center" }}>데이터를 찾을 수 없습니다.</div>;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "Pretendard, -apple-system, system-ui, sans-serif", color: COLORS.textMain }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: fadeIn 0.35s ease-out forwards; }
      `}</style>

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "20px 16px" }}>
        {/* HERO */}
        <div className="animate-in" style={{
          background: `linear-gradient(135deg, ${COLORS.main} 0%, #1E293B 100%)`,
          borderRadius: 28, padding: "26px 22px", color: "#fff",
          boxShadow: "0 18px 34px rgba(0,0,0,0.14)", marginBottom: 14, position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, background: COLORS.primary, filter: "blur(55px)", opacity: 0.35 }} />

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.65 }}>{data.title}</div>
              <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950, letterSpacing: "-0.8px" }}>오늘의 몰입 🔥</div>
            </div>

            <span style={{
              display: "inline-flex", alignItems: "center", padding: "7px 12px",
              borderRadius: 999, background: "rgba(255,255,255,0.10)",
              border: `1px solid ${ddayColor}`, color: ddayColor,
              fontSize: 14, fontWeight: 950, flex: "0 0 auto", height: 34,
            }}>
              {ddayText}
            </span>
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 900, opacity: 0.9, marginBottom: 8 }}>
              <span>전체 달성도</span>
              <span>{totalP}%</span>
            </div>

            <div style={{ width: "100%", height: 10, background: "rgba(255,255,255,0.12)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{
                width: `${totalP}%`, height: "100%",
                background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.accent})`,
                borderRadius: 999, transition: "width 0.4s ease-out",
              }} />
            </div>
          </div>
        </div>

        {/* KPI */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>

        </div>

        {/* SUBJECTS */}
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 950, paddingLeft: 4 }}>과목별 미션</div>

          {data.subjects.map((sub) => {
  const isOpen = openSubKey === sub.key;

  // ✅ ranges 안전하게 꺼내기
  const ranges: Range[] = Array.isArray(sub.ranges) ? sub.ranges : [];

  // ✅ 남은 개수: ranges 안의 task 기준
  const remain = ranges.reduce((acc, rg) => {
    const left = (rg.tasks || []).reduce((a, t) => {
      const done = Number(t.done ?? 0);
      const target = Number(t.target ?? 0);
      return a + Math.max(0, target - done);
    }, 0);
    return acc + left;
  }, 0);

  // ✅ 소단원 개수
const rangeCount = ranges.length;

// ✅ 체크리스트 총 개수
const totalChecklist = ranges.reduce((acc, rg) => {
  return acc + (rg.tasks?.length || 0);
}, 0);

  const subP = clamp(0, Number(sub.progress ?? 0), 100);

  return (
    <div
      key={sub.key}
      className="animate-in"
      style={{
        background: COLORS.card,
        borderRadius: 24,
        border: `1px solid ${COLORS.border}`,
        boxShadow: "0 6px 16px rgba(15,23,42,0.04)",
        overflow: "hidden",
      }}
    >
      {/* ✅ 헤더(항상 보임) */}
      <button
        type="button"
        onClick={() => setOpenSubKey(isOpen ? null : sub.key)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "16px 16px 14px",
          border: "none",
          background:
            "linear-gradient(180deg, rgba(59,130,246,0.06) 0%, rgba(255,255,255,0) 100%)",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 950, color: COLORS.textMain }}>
            {sub.name}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 950,
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(15,23,42,0.06)",
                color: COLORS.textMain,
              }}
            >
              소단원 {rangeCount} · 체크 {totalChecklist} · 남은 {remain}
            </span>

            <span style={{ fontSize: 13, fontWeight: 950, color: COLORS.primary }}>
              {subP}%
            </span>

            <span
              style={{
                fontSize: 16,
                transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease",
                opacity: 0.8,
              }}
            >
              ▼
            </span>
          </div>
        </div>

        <div style={{ marginTop: 10, width: "100%", height: 8, background: "rgba(255,255,255,0.6)", borderRadius: 999, overflow: "hidden" }}>
          <div
            style={{
              width: `${subP}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.accent})`,
              borderRadius: 999,
              transition: "width 0.25s ease",
            }}
          />
        </div>

        {/* ✅ sub.ranges는 배열이라 trim 금지 */}
        {ranges.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: COLORS.textSub, fontWeight: 700, lineHeight: 1.4 }}>
            소단원 {ranges.length}개
          </div>
        )}
      </button>

      {/* ✅ 내용(열렸을 때만) */}
      {isOpen && (
        <div style={{ padding: "10px 14px 16px", display: "grid", gap: 10 }}>
          {ranges.length === 0 ? (
            <div style={{ padding: 12, borderRadius: 16, border: "1px dashed rgba(15,23,42,0.18)", background: "#F8FAFC", color: COLORS.textSub, fontSize: 12, fontWeight: 800 }}>
              아직 등록된 소단원이 없어요.
            </div>
          ) : (
            ranges.map((rg) => (
              <div key={rg.id} style={{ border: `1px solid rgba(15,23,42,0.06)`, borderRadius: 16, background: "#FFFFFF", overflow: "hidden" }}>
                <div style={{ padding: "12px 12px 10px", background: "#F8FAFC", borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                  <div style={{ fontSize: 13, fontWeight: 950, color: COLORS.textMain }}>
                    {(rg.big || "").trim() ? rg.big : "단원"} {(rg.small || "").trim() ? `- ${rg.small}` : ""}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, color: COLORS.textSub }}>
                    {(rg.pages || "").trim() ? `쪽수: ${rg.pages}` : ""}
                  </div>
                </div>

                <div style={{ padding: 10, display: "grid", gap: 10 }}>
                  {(rg.tasks || []).length === 0 ? (
                    <div style={{ padding: 10, borderRadius: 14, background: "#F8FAFC", color: COLORS.textSub, fontSize: 12, fontWeight: 800 }}>
                      이 소단원에 체크리스트가 없어요.
                    </div>
                  ) : (
                    (rg.tasks || []).map((task) => {
                      const done = Number(task.done ?? 0);
                      const target = Number(task.target ?? 0);
                      const isFull = target > 0 && done >= target;
                      const isBusy = updatingKey === `${sub.key}:${rg.id}:${task.key}`;

                      return (
                        <div
                          key={task.key}
                          onClick={() => toggleTask(sub.key, rg.id, task.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "14px 14px",
                            background: isFull ? "rgba(16,185,129,0.08)" : "#F8FAFC",
                            borderRadius: 16,
                            cursor: "pointer",
                            border: isFull ? `1px solid rgba(16,185,129,0.25)` : `1px solid rgba(15,23,42,0.06)`,
                            opacity: isBusy ? 0.55 : 1,
                            userSelect: "none",
                          }}
                        >
                          <div style={{
                            width: 24, height: 24, borderRadius: 999,
                            border: `2px solid ${isFull ? COLORS.success : "rgba(148,163,184,0.8)"}`,
                            background: isFull ? COLORS.success : "#fff",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#fff", fontSize: 14, fontWeight: 950, flex: "0 0 auto",
                          }}>
                            {isFull ? "✓" : ""}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 14, fontWeight: 900,
                              color: isFull ? COLORS.success : COLORS.textMain,
                              textDecoration: isFull ? "line-through" : "none",
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            }}>
                              {task.label}
                            </div>
                            <div style={{ marginTop: 2, fontSize: 11, fontWeight: 800, color: COLORS.textSub }}>
                              {done} / {target}회 완료 {isBusy && " · 저장중…"}
                            </div>
                          </div>

                          <div style={{
                            padding: "6px 10px", borderRadius: 999,
                            background: "rgba(15,23,42,0.06)",
                            fontSize: 12, fontWeight: 950, color: COLORS.textMain, flex: "0 0 auto",
                          }}>
                            {target > 0 ? Math.round((done / target) * 100) : 0}%
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
})}
        </div>

        <p style={{ textAlign: "center", fontSize: 12, color: COLORS.textSub, marginTop: 18, fontWeight: 700 }}>
          💡 항목을 터치하면 완료 횟수가 올라가며 자동 저장됩니다.
        </p>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: "linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)",
      padding: "18px 14px", borderRadius: 22,
      border: `1px solid ${COLORS.border}`, textAlign: "center",
      boxShadow: "0 6px 16px rgba(15,23,42,0.04)",
    }}>
      <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", marginBottom: 10 }}>
        {label}
      </div>

      <div style={{ fontSize: 26, fontWeight: 950, color: COLORS.textMain, lineHeight: 1 }}>
        {Number(value || 0)}
        <span style={{ fontSize: 14, fontWeight: 950, color, marginLeft: 2 }}>%</span>
      </div>

      <div style={{ width: 56, height: 4, background: color, borderRadius: 999, margin: "12px auto 0", opacity: 0.35 }} />
    </div>
  );
}