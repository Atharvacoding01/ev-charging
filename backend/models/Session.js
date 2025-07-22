const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  chargerId: String, // ID of the charger used
  label: String,     // Human-readable name
  startTime: Date,
  endTime: Date,
  status: {
    type: String,
    enum: ["pending", "charging", "stopped"],
    default: "pending"
  },
  payment: {
    paid: { type: Boolean, default: false },
    amount: Number,
    method: String
  }
});

module.exports = mongoose.model("Session", sessionSchema);
