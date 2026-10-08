import mongoose from 'mongoose';

const depositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 1 },
  transaction_id: { type: String, required: true },
  payment_method: { type: String, default: 'UPI' },
  payment_screenshot: String,
  // Set for automatic gateway deposits; these skip admin approval.
  gateway: { type: String, enum: ['cashfree'] },
  gateway_order_id: { type: String, unique: true, sparse: true },
  gateway_payment_id: String,
  wallet_credited_at: Date,
  referral_processed_at: Date,
  status: {
     type: String,
    // awaiting_payment / failed are gateway-only states that never show up for admin approval.
    enum: ['pending', 'approved', 'rejected', 'awaiting_payment', 'failed'],
    default: 'pending'
  }
}, { timestamps: true });

depositSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Deposit', depositSchema);
