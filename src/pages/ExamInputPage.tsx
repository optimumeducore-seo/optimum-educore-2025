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

// ✅ 모의고사 등급 계산 (GradeSection에서 쓰던 로직 그대로 옮김)
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
  const { id } = useParams(); // 학생 ID
  const navigate = useNavigate();

  const [attempt, setAttempt] = useState(1);

  const [subject, setSubject] = useState("국어");
  const [examYear, setExamYear] = useState(2025);
  const [examMonth, setExamMonth] = useState(3);

  // ====== 입력 상태 ======
  const [choiceKey, setChoiceKey] = useState("");       // 객관식 정답 (예: 341252...)
  const [choiceMine, setChoiceMine] = useState("");     // 학생 객관식 답
  const [choicePoints, setChoicePoints] = useState(""); // 객관식 배점 (예: 2,2,3,3,...)

  const [writtenKey, setWrittenKey] = useState("");         // (수학) 주관식 정답들 "3,5,2..."
  const [writtenMine, setWrittenMine] = useState("");       // (수학) 학생 주관식 답 "3,4,1..."
  const [writtenPoints, setWrittenPoints] = useState("");   // (수학) 주관식 배점 "3,4,4..."

  // ================================
  //  공용 정답 키 ID (연도-월-과목-회차)
  //   → 선생님이 한 번 입력하면 모든 학생이 공유
  // ================================
  const examKeyId = `${examYear}-${examMonth}-${subject}-${attempt}`;

  // 🔹 해당 시험의 정답/배점 자동 로딩
  useEffect(() => {
    const loadAnswerKey = async () => {
      try {
        const ref = doc(db, "mockExamKeys", examKeyId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          console.log("🟡 정답 키 없음:", examKeyId);
          // 새 시험이면, 기존 입력값 유지 (초기에는 빈 값)
          return;
        }

        const data = snap.data() as any;
        console.log("✅ 정답 키 로딩:", examKeyId, data);

        // 객관식 정답/배점
        if (typeof data.choiceKey === "string") {
          setChoiceKey(data.choiceKey);
        }
        if (Array.isArray(data.choicePoints)) {
          setChoicePoints(data.choicePoints.join(","));
        }

        // 수학 주관식 정답/배점
        if (Array.isArray(data.writtenKey)) {
          setWrittenKey(data.writtenKey.join(","));
        }
        if (Array.isArray(data.writtenPoints)) {
          setWrittenPoints(data.writtenPoints.join(","));
        }
      } catch (err) {
        console.error("❌ 정답 키 로딩 오류:", err);
      }
    };

    loadAnswerKey();
  }, [examKeyId]);

  // ================================
  //  객관식 채점
  // ================================
  const scoreChoices = () => {
    const key = choiceKey.trim();        // "341252..."
    const mine = choiceMine.trim();      // "351242..."
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

      detail[i + 1] = {
        correct: k,
        mine: m,
        score: sc,
      };

      if (sc > 0) correct++;
      total += sc;
    }

    return { total, detail, correct, wrong: key.length - correct };
  };

  // ================================
  //  수학 주관식 채점 (참수학: 객관식 21번, 주관식 22~30번)
  // ================================
  const scoreWritten = () => {
    const keyArr = writtenKey
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    const mineArr = writtenMine
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    const ptsArr = writtenPoints
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((n) => !Number.isNaN(n));

    let total = 0;
    const detail: any = {};
    let correct = 0;

    for (let i = 0; i < keyArr.length; i++) {
      const k = keyArr[i];
      const m = mineArr[i] || "-";
      const p = ptsArr[i] || 0;

      const sc = k === m ? p : 0;

      // ✅ 참수학 기준: 주관식 22번부터라고 가정
      const qnum = 22 + i;

      detail[qnum] = {
        correct: k,
        mine: m,
        score: sc,
      };

      if (sc > 0) correct++;
      total += sc;
    }

    return { total, detail, correct, wrong: keyArr.length - correct };
  };

  // ================================
  //  저장 (정답 키 + 학생 성적 + 성적표 자동 반영)
  // ================================
  const saveExam = async () => {
    if (!id) {
      alert("학생 ID가 없습니다. 다시 열어주세요.");
      return;
    }

    try {
      // 1) 공용 정답 키 저장/갱신 (선생님이 한 번만 입력하면 됨)
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
          writtenKey: writtenKey
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v !== ""),
          writtenPoints: writtenPoints
            .split(",")
            .map((n) => Number(n.trim()))
            .filter((n) => !Number.isNaN(n)),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // 2) 학생 답안 채점
      const ch = scoreChoices();
      const wr =
        subject === "수학"
          ? scoreWritten()
          : { total: 0, detail: {}, correct: 0, wrong: 0 };

      const perDetail = { ...ch.detail, ...wr.detail };
      const totalScore = ch.total + wr.total;

      // 3) mockExams 컬렉션에 학생별 기록 저장
      await addDoc(collection(db, "mockExams"), {
        studentId: id,
        examKeyId, // 어떤 시험인지 연결
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
          .filter((v) => v !== ""),

        // 채점 결과
        perQuestionScore: perDetail,
        totalScore,
        correctCount: ch.correct + wr.correct,
        wrongCount: ch.wrong + wr.wrong,
      });

      

      // 4) ✅ grades 컬렉션(브릿지 성적표)에도 자동 반영
      // 4) grades 컬렉션(브릿지 성적표)에도 자동 반영
const bridgeTerm = `모의고사 ${attempt}회`;

// ⬇️ 기존 등급 로드 (있으면 수동 입력한 등급 유지)
const gradeRef = doc(db, "grades", id);
const gradeSnap = await getDoc(gradeRef);

let existingAvg = null;

if (gradeSnap.exists()) {
  const data = gradeSnap.data();
  existingAvg =
    data?.scores?.브릿지?.[subject]?.[bridgeTerm]?.avg ?? null;
}

// 자동 계산 등급
const level = getMockLevel(totalScore, subject);

// ⬇️ existingAvg가 있으면 그 값을 사용 (= 수동 값)
// ⬇️ 없으면 자동 계산 level 사용
const finalAvg = existingAvg !== null ? existingAvg : level;

await setDoc(
  gradeRef,
  {
    scores: {
      브릿지: {
        [subject]: {
          [bridgeTerm]: {
            my: totalScore,
            avg: finalAvg, // ⬅️ 수정된 부분!
          },
        },
      },
    },
    updatedAt: serverTimestamp(),
  },
  { merge: true }
);

      alert("✅ 저장 완료! (정답키 + 학생점수 + 성적표 반영)");
      navigate(-1);
    } catch (err) {
      console.error("❌ 저장 중 오류:", err);
      alert("⚠ 저장 중 오류가 발생했습니다. 콘솔을 확인해 주세요.");
    }
  };

  // ================================
  //  UI
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
        ※ 국어/영어: 45문항, 수학: 30문항, 과탐/사탐/역사: 20문항 기준으로
        정답 문자열과 배점을 입력하면 됩니다.
        <br />
        예) 국어 45문제면 정답칸에 45글자, 배점칸에 45개 숫자(쉼표 구분)
      </p>

      <br />
      <h3>◎ 객관식</h3>
      <input
        placeholder="정답: 341252... (문항 수만큼 쭉 입력)"
        value={choiceKey}
        onChange={(e) => setChoiceKey(e.target.value)}
        style={{ display: "block", marginBottom: 6, width: 400 }}
      />
      <input
        placeholder="학생답: 351242... (문항 수만큼 쭉 입력)"
        value={choiceMine}
        onChange={(e) => setChoiceMine(e.target.value)}
        style={{ display: "block", marginBottom: 6, width: 400 }}
      />
      <input
        placeholder="배점(예: 2,2,3,3,5...)"
        value={choicePoints}
        onChange={(e) => setChoicePoints(e.target.value)}
        style={{ display: "block", marginBottom: 6, width: 400 }}
      />

      {subject === "수학" && (
        <>
          <h3>◎ 수학 주관식 (참수학: 22~30번)</h3>
          <input
            placeholder="정답(쉼표): 3,5,2,4,..."
            value={writtenKey}
            onChange={(e) => setWrittenKey(e.target.value)}
            style={{ display: "block", marginBottom: 6, width: 400 }}
          />
          <input
            placeholder="학생답(쉼표): 3,4,1,..."
            value={writtenMine}
            onChange={(e) => setWrittenMine(e.target.value)}
            style={{ display: "block", marginBottom: 6, width: 400 }}
          />
          <input
            placeholder="배점(쉼표): 3,4,4,..."
            value={writtenPoints}
            onChange={(e) => setWrittenPoints(e.target.value)}
            style={{ display: "block", marginBottom: 6, width: 400 }}
          />
        </>
      )}

      <br />
      <br />
      <button onClick={saveExam}>저장</button>
    </div>
  );
}