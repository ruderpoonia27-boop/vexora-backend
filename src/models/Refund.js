import mongoose from 'mongoose';

const refundSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  amount: { type: Number, required: true, min: 1 },
  reason: { type: String, default: 'Tournament refund' },
  status: {
    type: String,
    enum: ['approved'],
    default: 'approved'
  }
}, { timestamps: true });

export default mongoose.model('Refund', refundSchema);
