// backend/src/models/Tx.js
import mongoose from "mongoose";

const TxSchema = new mongoose.Schema(
  {
    chainId: { type: Number, index: true }, // Δίκτυο EVM
    blockNumber: { type: Number, index: true },  // Σε ποιο block καταγράφηκε
    blockHash: String,  // Hash του block

    
    txHash: { type: String, required: true },   // Hash συναλλαγής
    logIndex: { type: Number, default: -1 }, // Θέση log στο tx (ή -1 αν δεν συνδέεται με συγκεκριμένο log) 

    contract: { type: String, index: true }, // Διεύθυνση συμβολαίου
    event: { type: String, index: true },    // Όνομα event (π.χ. "Listed", "Purchased")
    args: { type: Object },                  // καθαρισμένα args (BigInt -> string)

    from: String,           // Αποστολέας (διεύθυνση, θα γίνει lower-case στο hook)
    to: String,             // Παραλήπτης (διεύθυνση)
    value: String,          // Ποσό σε wei (ως string για να μη χάνεται ακρίβεια

    status: { type: String, default: "confirmed" },    // Κατάσταση καταχώρισης (π.χ. "confirmed")
    meta: { type: Object },            // Πρόσθετα μεταδεδομένα
  },
  { timestamps: true, versionKey: false }
);

// Μοναδικό ανά (txHash, logIndex) για να αποτραπούν σε διπλοεγγραφές του ίδιου log
TxSchema.index({ txHash: 1, logIndex: 1 }, { unique: true, name: "txLog_unique" });

// Γρήγορες αναζητήσεις για feed: ανά συμβόλαιο/event, ταξινομημένο απο τα νεότερα πρώτα
TxSchema.index({ contract: 1, event: 1, blockNumber: -1 });

// Κράτα τα address σε lower-case
TxSchema.pre("save", function (next) {
  try {
    if (this.contract) this.contract = String(this.contract).toLowerCase();
    if (this.from) this.from = String(this.from).toLowerCase();
    if (this.to) this.to = String(this.to).toLowerCase();
  } catch {}
  next();
});

export const Tx = mongoose.models.Tx || mongoose.model("Tx", TxSchema);
