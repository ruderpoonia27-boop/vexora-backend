import mongoose from 'mongoose';

const walletTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament' },
  amount: { type: Number, required: true },
  type: {
    type: String,
    enum: ['reward'],
    default: 'reward'
  },
  description: { type: String, default: 'Wallet transaction' },
  status: {
    type: String,
    enum: ['approved'],
    default: 'approved'
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

export default mongoose.model('WalletTransaction', walletTransactionSchema);
