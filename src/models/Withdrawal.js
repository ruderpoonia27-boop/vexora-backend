import mongoose from 'mongoose';

const withdrawalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 1 },
  upi_id: { type: String, required: true },
  debited_at_request: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  }
}, { timestamps: true });

withdrawalSchema.index({ userId: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Withdrawal', withdrawalSchema);
