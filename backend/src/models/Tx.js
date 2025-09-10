// backend/src/models/Tx.js
import mongoose from "mongoose";

const TxSchema = new mongoose.Schema(
  {
    chainId: { type: Number, index: true },
    blockNumber: { type: Number, index: true },
    blockHash: String,

    // ΜΗΝ κάνεις single-field index εδώ — καλύπτεται από το σύνθετο
    txHash: { type: String, required: true },
    logIndex: { type: Number, default: -1 }, // -1 για συναλλαγή χωρίς συγκεκριμένο log

    contract: { type: String, index: true }, // address (lowercased)
    event: { type: String, index: true },    // π.χ. "Listed"
    args: { type: Object },                  // καθαρισμένα args (BigInt -> string)

    from: String,
    to: String,
    value: String,                           // wei (string)

    status: { type: String, default: "confirmed" },
    meta: { type: Object },
  },
  { timestamps: true, versionKey: false }
);

// μοναδικό ανά (txHash, logIndex)
TxSchema.index({ txHash: 1, logIndex: 1 }, { unique: true, name: "txLog_unique" });

// χρήσιμο για αναζητήσεις feed
TxSchema.index({ contract: 1, event: 1, blockNumber: -1 });

// προαιρετικό: κράτα τα address σε lower-case
TxSchema.pre("save", function (next) {
  try {
    if (this.contract) this.contract = String(this.contract).toLowerCase();
    if (this.from) this.from = String(this.from).toLowerCase();
    if (this.to) this.to = String(this.to).toLowerCase();
  } catch {}
  next();
});

export const Tx = mongoose.models.Tx || mongoose.model("Tx", TxSchema);
