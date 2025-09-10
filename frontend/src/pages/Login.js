import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Αν ήρθες από PrivateRoute, εδώ θα υπάρχει state.from (π.χ. /analytics)
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
      await login(email, password);
      // ➜ ΕΠΙΣΤΡΟΦΗ εκεί που πήγαινες (π.χ. /analytics)
      navigate(from, { replace: true });
    } catch (e) {
      setErr(e?.message || "Αποτυχία σύνδεσης");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "40px auto" }}>
      <h2>Σύνδεση</h2>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email" />
        <input value={password} onChange={(e)=>setPassword(e.target.value)} type="password" placeholder="Κωδικός" />
        <button type="submit" disabled={loading}>{loading ? "Παρακαλώ περιμένετε…" : "Σύνδεση"}</button>
        {err && <div style={{ color: "crimson" }}>{err}</div>}
        <div>
          Δεν έχεις λογαριασμό?{" "}
          <Link to="/signup" state={{ from: location.state?.from }}>
            Εγγραφή
          </Link>
        </div>
      </form>
    </div>
  );
}
