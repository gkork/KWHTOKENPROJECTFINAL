import mongoose from "mongoose";

const EventSchema = new mongoose.Schema(
  {
    chainId: Number,  // Αναγνωριστικό δικτύου EVM
    address: String,  // Διεύθυνση συμβολαίου που εξέπεμψε το event   
    event: String,    // Όνομα event σύμφωνα με το ABI
    txHash: String,   // Hash της συναλλαγής όπου καταγράφηκε το event
    blockNumber: Number,  // Αριθμός block στο οποίο περιλαμβάνεται το event
    logIndex: Number,     // Θέση (index) του log μέσα στη συναλλαγή/μπλοκ (μοναδικό μαζί με txHash)
    timestamp: Number,     // Χρονική σήμανση του block σε δευτερόλεπτα
    args: mongoose.Schema.Types.Mixed,  // Αποκωδικοποιημένα ορίσματα του event
    topics: [String], // α topics είναι μια λίστα από σταθερού μεγέθους “κεφαλίδες” 32 bytes που μπαίνουν πάνω από τα δεδομένα του event
    data: String,     //  Περιέχει τα μη-indexed πεδία και αποκωδικοποιείται με το ABI για να πάρουμε κανονικές τιμές.
  },
  { timestamps: true }
);

EventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
EventSchema.index({ address: 1, event: 1, blockNumber: -1 });

export const EventModel = mongoose.model("Event", EventSchema);
