import React from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export function GradeChartModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [grades, setGrades] = React.useState<any[]>([]);

  React.useEffect(() => {
    (async () => {
      const q = query(collection(db, "students", studentId, "grades"), orderBy("date", "asc"));
      const snapshot = await getDocs(q);
      setGrades(snapshot.docs.map((doc) => doc.data()));
    })();
  }, [studentId]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
    >
      <div style={{ background: "#fff", padding: 20, borderRadius: 12, width: 700 }}>
        <h3>📈 성적 변화 그래프</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={grades}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="korean" stroke="#EF4444" name="국어" />
            <Line type="monotone" dataKey="english" stroke="#3B82F6" name="영어" />
            <Line type="monotone" dataKey="math" stroke="#10B981" name="수학" />
            <Line type="monotone" dataKey="science" stroke="#F59E0B" name="과학" />
          </LineChart>
        </ResponsiveContainer>
        <button onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}