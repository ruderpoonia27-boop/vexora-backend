import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  walletBalance: { type: Number, default: 0 },
  avatar_id: { type: String, default: 'vanguard-01' },
  avatar_rarity: { type: String, default: 'Legendary' },
  profile_setup_completed: { type: Boolean, default: true },
  referral_code: { type: String, unique: true, sparse: true },
  referred_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  referred_by_code: String,
  referral_history: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    user_name: String,
    user_email: String,
    signup_completed: { type: Boolean, default: true },
    deposit_completed: { type: Boolean, default: false },
    joined_at: { type: Date, default: Date.now },
    first_deposit_completed_at: Date
  }],
  referral_stats: {
    completed_deposits: { type: Number, default: 0 },
    squads_completed: { type: Number, default: 0 },
    free_entries_earned: { type: Number, default: 0 },
    free_entries_used: { type: Number, default: 0 },
    current_progress: { type: Number, default: 0 }
  },
  referral_achievements: [{
    squad_number: Number,
    free_entries_awarded: Number,
    title: String,
    subtitle: String,
    achieved_at: { type: Date, default: Date.now }
  }],
  game_profiles: [{
    game_name: { type: String, required: true },
    in_game_name: { type: String, required: true },
    game_uid: { type: String, required: true },
    updated_at: { type: Date, default: Date.now }
  }],
  isAdmin: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
  blockedAt: Date,
  blockedReason: String,
  notifications: [{
    message: String,
    type: { type: String, default: 'info' },
    tournamentId: String,
    link: String,
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  policy_acceptance: {
    accepted_terms: { type: Boolean, default: false },
    accepted_privacy: { type: Boolean, default: false },
    accepted_at: Date
  }
}, { timestamps: true });

export default mongoose.model('User', userSchema);
