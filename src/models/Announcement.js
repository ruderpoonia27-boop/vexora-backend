import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  icon: { type: String, default: '🔥' },
  buttonText: { type: String, default: '' },
  redirectUrl: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
  startTime: { type: Date, default: null },
  endTime: { type: Date, default: null },
  showNewBadge: { type: Boolean, default: false },
  showCountdown: { type: Boolean, default: false },
  isImportant: { type: Boolean, default: false }
}, { timestamps: true });

announcementSchema.index({ isActive: 1, order: 1, startTime: 1, endTime: 1 });

export default mongoose.model('Announcement', announcementSchema);
