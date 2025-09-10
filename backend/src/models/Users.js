import mongoose from "mongoose";
import validator from "validator";

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,         // <-- μόνο εδώ
      lowercase: true,
      trim: true,
      validate: { validator: validator.isEmail, message: "Invalid email" },
    },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

// Μην ξαναδηλώνεις index() εδώ για email
export const UserModel = mongoose.model("User", UserSchema);
