// backend/src/routes/auth.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

const router = Router();

const JWT_SECRET  = process.env.JWT_SECRET  || "dev-secret-change-me";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

// Υπογραφή JWT
function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// Ρύθμιση cookie με το token
function setTokenCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,       // σε http://localhost:4000 να μείνει false
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 ημέρες
  });
}

// Διαβάζουμε/ελέγχουμε JWT από cookie ή Authorization header
function readToken(req) {
  const fromCookie = req.cookies?.token;
  const fromHeader = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;

  const token = fromCookie || fromHeader;
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/* --------- Routes --------- */

// POST /auth/register
router.post("/register", async (req, res) => {
  try {
    const { email, password } = (req.body ?? {});
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "weak_password" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: "email_taken" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = await User.create({ email: email.toLowerCase(), passwordHash });

    const token = signToken(doc._id);
    setTokenCookie(res, token);

    return res.json({ ok: true, user: { id: doc._id, email: doc.email } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = (req.body ?? {});
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const token = signToken(user._id);
    setTokenCookie(res, token);

    return res.json({ ok: true, user: { id: user._id, email: user.email } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie("token", { path: "/" });
  return res.json({ ok: true });
});

// GET /auth/me
router.get("/me", async (req, res) => {
  try {
    const payload = readToken(req);
    if (!payload?.sub) return res.status(401).json({ ok: false, error: "unauthorized" });

    const user = await User.findById(payload.sub).lean();
    if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

    return res.json({ ok: true, user: { id: user._id, email: user.email } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
