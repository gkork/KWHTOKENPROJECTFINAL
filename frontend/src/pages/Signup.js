import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export default function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await register(email, password);
      
      navigate(from, { replace: true });
    } catch (e) {
      setErr(e?.message || "Αποτυχία εγγραφής");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "40px auto" }}>
      <h2>Εγγραφή</h2>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          required
        />
        <input
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
          type="password"
          placeholder="Κωδικός"
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Παρακαλώ περιμένετε…" : "Εγγραφή"}
        </button>
        {err && <div style={{ color: "crimson" }}>{err}</div>}
        <div>
          Έχεις ήδη;{" "}
          <Link to="/login" state={{ from: location.state?.from }}>
            Σύνδεση
          </Link>
        </div>
      </form>
    </div>
  );
}
