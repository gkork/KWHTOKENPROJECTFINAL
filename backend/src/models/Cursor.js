// backend/src/models/Cursor.js
import mongoose from "mongoose";

const CursorSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, index: true }, // π.χ. "events:0xabc..."
    blockNumber: { type: Number, default: 0 },
  },
  { versionKey: false }
);

export const Cursor =
  mongoose.models.Cursor || mongoose.model("Cursor", CursorSchema);