import mongoose from 'mongoose';

const paymentSettingsSchema = new mongoose.Schema({
  upi_id: { type: String, default: '' },
  qr_code: { type: String, default: '' },
  // What the deposit page shows players: UPI ID, QR code, or both.
  display_mode: { type: String, enum: ['both', 'upi', 'qr'], default: 'both' }
}, { timestamps: true });

export default mongoose.model('PaymentSettings', paymentSettingsSchema);
