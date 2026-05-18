import mongoose from 'mongoose';

const paymentSettingsSchema = new mongoose.Schema({
  upi_id: { type: String, default: 'tournament@upi' },
  qr_code: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('PaymentSettings', paymentSettingsSchema);
