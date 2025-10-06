// backend/src/db.js
import mongoose from "mongoose";
import { MONGO_URI, START_BLOCK } from "./config.js";
import { Cursor } from "./models/Cursor.js";

let isConnected = false;  // Flag για να αποφεύγουμε πολλαπλές συνδέσεις στο ίδιο process

/**
 * Συνδέσου στη Mongo (μία φορά). Ρίχνει readable logs.
 * Κάνει επίσης bootstrap ενός cursor αν δεν υπάρχει.
 */
export async function connectMongo() {
  const uri = MONGO_URI;
  if (!uri) {
    console.error("[mongo] MONGO_URI missing in .env");  // Έλεγχος: αν λείπει το URI από το .env, δεν μπορούμε να συνδεθούμε
    return false;
  }
  if (isConnected) return true;  // Αν υπάρχει ήδη ενεργή σύνδεση, μην ξανασυνδεθείς

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5_000,
      // Όνομα βάσης: "kwhtoken"
    });
    isConnected = true;

    // Θέτουμε ενα αρχικό cursor δηλαδή ένα “σημείο προόδου” που κρατά ο indexer για να θυμάται μέχρι ποιο blockNumber έχει διαβάσει τα logs
    // Εδώ κρατάμε μόνο ένα "global" default ώστε να μην ξεκινά από null.
    // Το blockNumber τίθεται σε START_BLOCK - 1 (ή 0 κατώφλι), έτσι ο indexer μπορεί να ξεκινήσει από το START_BLOCK με ασφάλεια.
    await Cursor.updateOne(
      { key: "bootstrap" },
      { $setOnInsert: { blockNumber: Math.max(0, START_BLOCK - 1) } },
      { upsert: true }
    );

    const safeUri = uri.replace(/\/\/([^@]+)@/, "//***@");     // Απόκρυψη credentials από το URI στα logs (ασφάλεια)
    console.log("[mongo] connected:", safeUri);
    return true;
  } catch (err) {
    console.error("[mongo] connection error:", err?.message || err);
    return false;
  }
}

export async function closeMongo() {    // Κλείσιμο σύνδεσης με τη MongoDB
  try {
    await mongoose.connection?.close();
    isConnected = false;
    console.log("[mongo] connection closed");
  } catch {
    
  }
}
