import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function ParentLaunchPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const sid = localStorage.getItem("educore_parent_sid");

    if (sid) {
      navigate(`/parent-report/${sid}`, { replace: true });
    }
  }, [navigate]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        color: "#475569"
      }}
    >
      부모앱을 여는 중입니다...
    </div>
  );
}