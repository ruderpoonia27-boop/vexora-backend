import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  platform_name: { type: String, default: 'Nexus Arena' },
  contact_email: { type: String, default: 'support@nexusarena.com' },
  min_deposit_amount: { type: Number, default: 10 },
  min_withdraw_amount: { type: Number, default: 50 }
}, { timestamps: true });

export default mongoose.model('Settings', settingsSchema);
