import mongoose from "mongoose";

const EventSchema = new mongoose.Schema(
  {
    chainId: Number,
    address: String,     // lowercased
    event: String,
    txHash: String,
    blockNumber: Number,
    logIndex: Number,
    timestamp: Number,
    args: mongoose.Schema.Types.Mixed,
    topics: [String],
    data: String,
  },
  { timestamps: true }
);

EventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
EventSchema.index({ address: 1, event: 1, blockNumber: -1 });

export const EventModel = mongoose.model("Event", EventSchema);
