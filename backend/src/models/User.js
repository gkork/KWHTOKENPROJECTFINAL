// backend/src/models/User.js
import mongoose from "mongoose";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // Έλεγχος εγκυρότητας email (κάτι πριν/μετά το @ και ένα . στο domain)

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,   // αποθηκεύεται ως string
      required: true,   // είναι υποχρεωτικό
      unique: true,   // μοναδικό στο collection (δημιουργεί unique index στη MongoDB)
      lowercase: true,  // μετατρέπει αυτόματα σε πεζά πριν την αποθήκευση
      trim: true,       // αφαιρεί κενά στην αρχή/τέλος
      validate: {
        validator: (v) => emailRe.test(v),  // Εγκυρότητα email
        message: "Invalid email",           // μήνυμα σφάλματος αν αποτύχει ο έλεγχος
      },
    },
    passwordHash: { type: String, required: true },  // Hash του κωδικού για να μην αποθηκευτεί ο κωδικός σε μορφή plain-text 
  },
  { timestamps: true }      // Προσθέτει αυτόματα createdAt / updatedAt timestamps στα έγγραφα
);

// Χρησιμοποιούμε το ίδιο μοντέλο User που έχει ήδη οριστεί στη Mongoose, το ξαναχρησιμοποιούμε αντί να το ξαναδημιουργήσουμε για την αποφυγή σφαλμάτων
export const User =
  mongoose.models.User || mongoose.model("User", UserSchema);

export default User;   // Default export για εύκολα imports
