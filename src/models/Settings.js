import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  platform_name: { type: String, default: 'Vexora' },
  contact_email: { type: String, default: 'support@nexusarena.com' },
  min_deposit_amount: { type: Number, default: 10 },
  min_withdraw_amount: { type: Number, default: 50 },
  contactSettings: {
    whatsappEnabled: { type: Boolean, default: true },
    whatsappNumber: { type: String, default: '' },
    telegramEnabled: { type: Boolean, default: false },
    telegramLink: { type: String, default: '' }
  }
}, { timestamps: true });

export default mongoose.model('Settings', settingsSchema);


