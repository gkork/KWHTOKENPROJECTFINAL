// src/middleware/auth.js
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

export function authRequired(optional = false) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      const bearer = header.startsWith("Bearer ")
        ? header.slice(7)
        : null;
      const token = req.cookies?.token || bearer;

      if (!token) {
        if (optional) return next();
        return res.status(401).json({ error: "no token" });
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(payload.sub).lean();
      if (!user) {
        if (optional) return next();
        return res.status(401).json({ error: "user not found" });
      }

      req.user = { id: String(user._id), email: user.email };
      next();
    } catch (e) {
      if (optional) return next();
      return res.status(401).json({ error: "invalid token" });
    }
  };
}
