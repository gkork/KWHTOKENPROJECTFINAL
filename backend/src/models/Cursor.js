// backend/src/models/Cursor.js

/*
Κρατάει έναν "δείκτη" (cursor) ανά ροή γεγονότων, ώστε ο indexer να ξέρει
μέχρι ποιο block έχει διαβάσει/επεξεργαστεί και να συνεχίζει από εκεί μετά από restart.

 */

import mongoose from "mongoose";

const CursorSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, index: true }, /**
     * Ο τελευταίος (τελειωμένος) αριθμός block που έχει επεξεργαστεί ο indexer.
     * Ξεκινά από 0 ως default. Μετά από κάθε επιτυχημένο batch, ενημερώνεται.
     */
    blockNumber: { type: Number, default: 0 },
  },
  { versionKey: false }
);

export const Cursor =
  mongoose.models.Cursor || mongoose.model("Cursor", CursorSchema);