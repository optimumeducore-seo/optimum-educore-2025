// src/pages/ExamInputPage.tsx
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";

const SUBJECTS = ["국어", "수학", "영어", "통합과학", "통합사회", "역사"];

// ⚙️ 과목별 기본 문항 수 안내 (기준만 알려주는 용도)
const SUBJECT_CONFIG: Record<
  string,
  { choiceCount: number; writtenCount: number; note: string }
> = {
  국어: { choiceCount: 45, writtenCount: 0, note: "국어: 객관식 45문항" },
  영어: { choiceCount: 45, writtenCount: 0, note: "영어: 객관식 45문항" },
  수학: {
    choiceCount: 21,
    writtenCount: 9,
    note: "수학(참수학 기준): 객관식 21문항 + 주관식 9문항(22~30번)",
  },
  통합과학: {
    choiceCount: 20,
    writtenCount: 0,
    note: "통합과학: 객관식 20문항",
  },
  통합사회: {
    choiceCount: 20,
    writtenCount: 0,
    note: "통합사회: 객관식 20문항",
  },
  역사: { choiceCount: 20, writtenCount: 0, note: "역사: 객관식 20문항" },
};

// ✅ 모의고사 등급 계산
function getMockLevel(score: number, subject: string) {
  if (!score && score !== 0) return 9;

  const fullScore =
    subject === "통합과학" ||
    subject === "통합사회" ||
    subject === "역사"
      ? 50
      : 100;

  const pct = (score / fullScore) * 100;

  if (pct >= 96) return 1;
  if (pct >= 89) return 2;
  if (pct >= 77) return 3;
  if (pct >= 60) return 4;
  if (pct >= 40) return 5;
  if (pct >= 23) return 6;
  if (pct >= 11) return 7;
  if (pct >= 4) return 8;
  return 9;
}

export default function ExamInputPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [attempt, setAttempt] = useState(1);
  const [subject, setSubject] = useState("국어");
  const [examYear, setExamYear] = useState(2025);
  const [examMonth, setExamMonth] = useState(3);

  // ====== 입력 상태 ======
  const [choiceKey, setChoiceKey] = useState("");
  const [choiceMine, setChoiceMine] = useState("");
  const [choicePoints, setChoicePoints] = useState("");

  const [writtenKey, setWrittenKey] = useState("");
  const [writtenMine, setWrittenMine] = useState("");
  const [writtenPoints, setWrittenPoints] = useState("");

  const examKeyId = `${examYear}-${examMonth}-${subject}-${attempt}`;
  const config = SUBJECT_CONFIG[subject];

  // 🔹 정답 자동 로딩
  useEffect(() => {
    const loadAnswerKey = async () => {
      try {
        const ref = doc(db, "mockExamKeys", examKeyId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          console.log("🟡 정답 키 없음:", examKeyId);
          return;
        }

        const data = snap.data() as any;
        console.log("정답키 로딩", data);

        if (typeof data.choiceKey === "string") {
          setChoiceKey(data.choiceKey);
        }
        if (Array.isArray(data.choicePoints)) {
          setChoicePoints(data.choicePoints.join(","));
        }

        if (Array.isArray(data.writtenKey)) {
          setWrittenKey(data.writtenKey.join(","));
        }
        if (Array.isArray(data.writtenPoints)) {
          setWrittenPoints(data.writtenPoints.join(","));
        }
      } catch (err) {
        console.error(err);
      }
    };

    loadAnswerKey();
  }, [examKeyId]);

  // ================================
  //  객관식 채점
  // ================================
  const scoreChoices = () => {
    const key = choiceKey.trim();
    const mine = choiceMine.trim();
    const points = choicePoints
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => !Number.isNaN(n));

    let total = 0;
    const detail: any = {};
    let correct = 0;

    for (let i = 0; i < key.length; i++) {
      const k = key[i];
      const m = mine[i] || "-";
      const p = points[i] || 0;

      const sc = k === m ? p : 0;

      detail[i + 1] = { correct: k, mine: m, score: sc };
      if (sc > 0) correct++;
      total += sc;
    }

    return { total, detail, correct, wrong: key.length - correct };
  };

  // ================================
  //  수학 주관식 채점
  // ================================
  const scoreWritten = () => {
    const keyArr = writtenKey.split(",").map((v) => v.trim()).filter(Boolean);
    const mineArr = writtenMine.split(",").map((v) => v.trim()).filter(Boolean);
    const ptsArr = writtenPoints
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((n) => !Number.isNaN(n));

    let total = 0;
    const detail: any = {};
    let correct = 0;

    for (let i = 0; i < keyArr.length; i++) {
      const sc = keyArr[i] === mineArr[i] ? ptsArr[i] : 0;
      const qnum = 22 + i;

      detail[qnum] = {
        correct: keyArr[i],
        mine: mineArr[i] || "-",
        score: sc,
      };

      if (sc > 0) correct++;
      total += sc;
    }

    return { total, detail, correct, wrong: keyArr.length - correct };
  };

  // ================================
  //  실시간 개수 계산 (화면 표시용)
  // ================================
  const choiceKeyLen = choiceKey.trim().length;
  const choiceMineLen = choiceMine.trim().length;
  const choicePointsCount = choicePoints
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "" && !Number.isNaN(Number(n))).length;

  const writtenKeyCount = writtenKey.split(",").filter((v) => v.trim()).length;
  const writtenMineCount = writtenMine.split(",").filter((v) => v.trim()).length;
  const writtenPointsCount = writtenPoints
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "" && !Number.isNaN(Number(v))).length;

  const hasChoiceLenMismatch =
    choiceKeyLen > 0 &&
    (choiceMineLen > 0 || choicePointsCount > 0) &&
    (choiceKeyLen !== choiceMineLen || choiceKeyLen !== choicePointsCount);

  const hasWrittenLenMismatch =
    subject === "수학" &&
    writtenKeyCount > 0 &&
    (writtenMineCount > 0 || writtenPointsCount > 0) &&
    (writtenKeyCount !== writtenMineCount ||
      writtenKeyCount !== writtenPointsCount);

  // ================================
  //  저장
  // ================================
  const saveExam = async () => {
    if (!id) {
      alert("학생 ID가 없습니다.");
      return;
    }

    // 🔐 객관식 개수 체크
    if (choiceKeyLen > 0) {
      if (choiceMineLen > 0 && choiceKeyLen !== choiceMineLen) {
        alert("객관식 정답/학생답 개수가 다릅니다.");
        return;
      }
      if (choicePointsCount > 0 && choiceKeyLen !== choicePointsCount) {
        alert("객관식 정답/배점 개수가 다릅니다.");
        return;
      }
      if (config.choiceCount > 0 && choiceKeyLen !== config.choiceCount) {
        const ok = window.confirm(
          `⚠ 기준 객관식은 ${config.choiceCount}문항입니다.\n그래도 저장할까요?`
        );
        if (!ok) return;
      }
    }

    // 🔐 수학 주관식 체크
    if (subject === "수학" && writtenKeyCount > 0) {
      if (writtenMineCount > 0 && writtenKeyCount !== writtenMineCount) {
        alert("주관식 정답/학생답 개수가 다릅니다.");
        return;
      }
      if (writtenPointsCount > 0 && writtenKeyCount !== writtenPointsCount) {
        alert("주관식 정답/배점 개수가 다릅니다.");
        return;
      }
      if (writtenKeyCount !== config.writtenCount) {
        const ok = window.confirm(
          `⚠ 기준 주관식은 ${config.writtenCount}문항입니다.\n그래도 저장할까요?`
        );
        if (!ok) return;
      }
    }

    try {
      // 1) 정답키 저장
      await setDoc(
        doc(db, "mockExamKeys", examKeyId),
        {
          examYear,
          examMonth,
          subject,
          attempt,
          choiceKey,
          choicePoints: choicePoints
            .split(",")
            .map((n) => Number(n.trim()))
            .filter((n) => !Number.isNaN(n)),
          writtenKey: writtenKey.split(",").map((v) => v.trim()).filter(Boolean),
          writtenPoints: writtenPoints
            .split(",")
            .map((n) => Number(n.trim()))
            .filter((n) => !Number.isNaN(n)),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // 2) 채점
      const ch = scoreChoices();
      const wr =
        subject === "수학"
          ? scoreWritten()
          : { total: 0, detail: {}, correct: 0, wrong: 0 };

      const perDetail = { ...ch.detail, ...wr.detail };
      const totalScore = ch.total + wr.total;

      // 3) mockExams 저장
      await addDoc(collection(db, "mockExams"), {
        studentId: id,
        examKeyId,
        examYear,
        examMonth,
        subject,
        attempt,
        createdAt: serverTimestamp(),
        // 학생이 실제로 입력한 답
        choiceMine,
        writtenMine: writtenMine
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        // 채점 결과
        perQuestionScore: perDetail,
        totalScore,
        correctCount: ch.correct + wr.correct,
        wrongCount: ch.wrong + wr.wrong,
      });

      // 4) grade 저장
      const bridgeTerm = `모의고사 ${attempt}회`;
      const level = getMockLevel(totalScore, subject);

      await setDoc(
        doc(db, "grades", id),
        {
          scores: {
            브릿지: {
              [subject]: {
                [bridgeTerm]: {
                  my: totalScore,
                  avg: level,
                },
              },
            },
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // ================================
      // ⭐⭐⭐ 과목 자동 이동 로직 (깔끔 버전) ⭐⭐⭐
      // ================================
      const currentIndex = SUBJECTS.indexOf(subject);

      if (currentIndex < SUBJECTS.length - 1) {
        const nextSubject = SUBJECTS[currentIndex + 1];

        alert(`✔ ${subject} 입력 완료 → 다음 과목(${nextSubject})으로 이동합니다.`);

        // 다음 과목으로 이동 + 입력칸 초기화
        setSubject(nextSubject);
        setChoiceKey("");
        setChoiceMine("");
        setChoicePoints("");
        setWrittenKey("");
        setWrittenMine("");
        setWrittenPoints("");

        // ⛔ 여기서는 페이지 나가지 않고, 이 페이지에 그대로 머무름
        return;
      }

      // 마지막 과목일 때만 페이지 나감
      alert("📘 모든 과목 입력이 완료되었습니다!");
      navigate(-1);
      // ================================

    } catch (err) {
      console.error(err);
      alert("⚠ 저장 중 오류 발생");
    }
  };

  // ================================
  // UI
  // ================================
  return (
    <div style={{ padding: 20 }}>
      <h2>모의고사 성적 입력</h2>

      <div style={{ marginBottom: 14 }}>
        <label>회차: </label>
        <select
          value={attempt}
          onChange={(e) => setAttempt(Number(e.target.value))}
        >
          <option value={1}>1회</option>
          <option value={2}>2회</option>
          <option value={3}>3회</option>
          <option value={4}>4회</option>
          <option value={5}>5회</option>
          <option value={6}>6회</option>
          <option value={7}>7회</option>
          <option value={8}>8회</option>
        </select>
      </div>

      <div>
        <label>과목: </label>
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        >
          {SUBJECTS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      {config && (
        <p style={{ marginTop: 6, fontSize: 12, color: "#2563eb" }}>
          📌 {config.note}
        </p>
      )}

      <div>
        <label>시험 연도: </label>
        <input
          type="number"
          value={examYear}
          onChange={(e) => setExamYear(Number(e.target.value))}
        />
      </div>

      <div>
        <label>시험 월: </label>
        <input
          type="number"
          value={examMonth}
          onChange={(e) => setExamMonth(Number(e.target.value))}
        />
      </div>

      <p style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
        ※ 국어/영어: 45문항, 수학: 30문항(객관식 21 + 주관식 9), 사탐/과탐/역사: 20문항
      </p>

      <br />
      <h3>◎ 객관식</h3>
      <input
        placeholder="정답: 341252..."
        value={choiceKey}
        onChange={(e) => setChoiceKey(e.target.value)}
        style={{ display: "block", marginBottom: 4, width: 400 }}
      />
      <div style={{ fontSize: 12, marginBottom: 6 }}>
        정답 길이: {choiceKeyLen}문항 / 기준: {config.choiceCount}문항
      </div>

      <input
        placeholder="학생답: 351242..."
        value={choiceMine}
        onChange={(e) => setChoiceMine(e.target.value)}
        style={{ display: "block", marginBottom: 4, width: 400 }}
      />
      <div style={{ fontSize: 12, marginBottom: 6 }}>
        학생답 길이: {choiceMineLen}문항
      </div>

      <input
        placeholder="배점(예: 2,2,3,3...)"
        value={choicePoints}
        onChange={(e) => setChoicePoints(e.target.value)}
        style={{ display: "block", marginBottom: 4, width: 400 }}
      />
      <div
        style={{
          fontSize: 12,
          marginBottom: 8,
          color: hasChoiceLenMismatch ? "red" : "#333",
        }}
      >
        배점 개수: {choicePointsCount}개
        {hasChoiceLenMismatch && " (정답/학생답/배점 개수가 다릅니다)"}
      </div>

      {subject === "수학" && (
        <>
          <h3>◎ 수학 주관식</h3>

          <input
            placeholder="정답(쉼표): 3,5,2,4..."
            value={writtenKey}
            onChange={(e) => setWrittenKey(e.target.value)}
            style={{ display: "block", marginBottom: 4, width: 400 }}
          />
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            주관식 정답: {writtenKeyCount}문항 (기준:{config.writtenCount})
          </div>

          <input
            placeholder="학생답(쉼표): 3,4,1..."
            value={writtenMine}
            onChange={(e) => setWrittenMine(e.target.value)}
            style={{ display: "block", marginBottom: 4, width: 400 }}
          />
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            학생 주관식: {writtenMineCount}문항
          </div>

          <input
            placeholder="배점(쉼표)"
            value={writtenPoints}
            onChange={(e) => setWrittenPoints(e.target.value)}
            style={{ display: "block", marginBottom: 4, width: 400 }}
          />
          <div
            style={{
              fontSize: 12,
              marginBottom: 8,
              color: hasWrittenLenMismatch ? "red" : "#333",
            }}
          >
            주관식 배점: {writtenPointsCount}개
            {hasWrittenLenMismatch && " (정답/학생답/배점 개수가 다릅니다)"}
          </div>
        </>
      )}

      <br />
      <button onClick={saveExam}>저장</button>
    </div>
  );
}