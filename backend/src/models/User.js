// backend/src/models/User.js
import mongoose from "mongoose";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,   // ΜΟΝΟ αυτό, όχι extra schema.index για να μη βγάζει duplicate index warning
      lowercase: true,
      trim: true,
      validate: {
        validator: (v) => emailRe.test(v),
        message: "Invalid email",
      },
    },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

// Χρησιμοποιούμε το ίδιο μοντέλο αν υπάρχει (hot reload)
export const User =
  mongoose.models.User || mongoose.model("User", UserSchema);

export default User;
