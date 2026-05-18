import mongoose from 'mongoose';

const depositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 1 },
  transaction_id: { type: String, required: true },
  payment_method: { type: String, default: 'UPI' },
  payment_screenshot: String,
  wallet_credited_at: Date,
  referral_processed_at: Date,
  status: {
     type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  }
}, { timestamps: true });

export default mongoose.model('Deposit', depositSchema);
