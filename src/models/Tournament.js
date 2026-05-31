import mongoose from 'mongoose';

const tournamentSchema = new mongoose.Schema({
  name: { type: String, default: 'BGMI' },
  game_type: String,
  title: String,
  description: String,
  match_type: { type: String, enum: ['solo', 'squad'], default: 'solo' },
  matchType: String,
  squad_size: { type: Number, default: 1 },
  squadSize: Number,
  entry_fee: { type: Number, default: 0 },
  entryFee: Number,
  base_prize: { type: Number, default: 0 },
  prizePool: { type: Number, default: 0 },
  first_prize_percentage: { type: Number, default: 50, min: 1, max: 100 },
  firstPrizePercentage: Number,
  solo_first_place_percentage: { type: Number, default: 60, min: 0, max: 100 },
  solo_second_place_percentage: { type: Number, default: 30, min: 0, max: 100 },
  solo_third_place_percentage: { type: Number, default: 10, min: 0, max: 100 },
  total_slots: { type: Number, default: 1 },
  totalSlots: Number,
  currentPlayers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  participant_profiles: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    in_game_name: { type: String, required: true },
    game_uid: { type: String, required: true },
    game_name: String,
    join_method: { type: String, enum: ['wallet', 'free_entry', 'squad_captain', 'squad_invite'], default: 'wallet' },
    squad_id: String,
    joined_at: { type: Date, default: Date.now }
  }],
  squads: [{
    name: { type: String, required: true },
    squad_code: { type: String, required: true },
    squad_password: { type: String, default: '' },
    captain: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    total_entry_fee: { type: Number, default: 0 },
    entry_paid: { type: Boolean, default: true },
    status: { type: String, enum: ['forming', 'complete'], default: 'forming' },
    locked_at: Date,
    createdAt: { type: Date, default: Date.now }
  }],
  joined_count: { type: Number, default: 0 },
  match_start_time: Date,
  startTime: Date,
  endTime: Date,
  status: { 
    type: String, 
    enum: ['pending', 'active', 'completed', 'cancelled', 'dismissed', 'upcoming', 'ongoing'], 
    default: 'active' 
  },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  second_winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  third_winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  winner_squad: String,
  winner_squad_name: String,
  winner_prize: { type: Number, default: 0 },
  total_collection: { type: Number, default: 0 },
  reward_pool: { type: Number, default: 0 },
  platform_earnings: { type: Number, default: 0 },
  reward_per_member: { type: Number, default: 0 },
  first_place_prize: { type: Number, default: 0 },
  second_place_prize: { type: Number, default: 0 },
  third_place_prize: { type: Number, default: 0 },
  winner_declared_at: Date,
  gameType: String,
  basePrize: Number,
  room_id: String,
  roomId: String,
  room_password: String,
  roomPassword: String,
  room_details_set_at: Date,
  finished_at: Date,
  dismissed_at: Date,
  refunded_at: Date,
  refund_processed: { type: Boolean, default: false },
  refundProcessed: Boolean
}, { timestamps: true });

tournamentSchema.pre('save', function syncTournamentFields(next) {
  const gameName = this.name || this.game_type || this.gameType || 'BGMI';
  this.name = gameName;
  this.game_type = gameName;
  this.gameType = gameName;
  this.title = this.title || `${gameName} Showdown`;
  this.match_type = this.match_type || this.matchType || 'solo';
  this.matchType = this.match_type;
  this.squad_size = Number(this.squad_size ?? this.squadSize ?? (this.match_type === 'squad' ? 4 : 1));
  if (this.match_type === 'solo') {
    this.squad_size = 1;
  }
  this.squadSize = this.squad_size;

  this.entry_fee = Number(this.entry_fee ?? this.entryFee ?? 0);
  this.entryFee = this.entry_fee;
  this.base_prize = Number(this.base_prize ?? this.basePrize ?? this.prizePool ?? 0);
  this.basePrize = this.base_prize;
  this.prizePool = this.base_prize;
  this.first_prize_percentage = Math.min(100, Math.max(1, Number(this.first_prize_percentage ?? this.firstPrizePercentage ?? 50)));
  this.firstPrizePercentage = this.first_prize_percentage;
  this.solo_first_place_percentage = Number(this.solo_first_place_percentage ?? 60);
  this.solo_second_place_percentage = Number(this.solo_second_place_percentage ?? 30);
  this.solo_third_place_percentage = Number(this.solo_third_place_percentage ?? 10);
  this.total_slots = Number(this.total_slots ?? this.totalSlots ?? 1);
  this.totalSlots = this.total_slots;
  this.joined_count = this.currentPlayers?.length || this.joined_count || 0;
  this.participant_profiles = Array.isArray(this.participant_profiles) ? this.participant_profiles : [];
  this.participant_profiles = this.participant_profiles.map((profile) => ({
    ...profile,
    join_method: profile?.join_method || profile?.joinMethod || 'wallet'
  }));
  this.squads = Array.isArray(this.squads) ? this.squads : [];
  this.squads = this.squads.map((squad) => {
    const memberCount = Array.isArray(squad.members) ? squad.members.length : 0;
    const totalEntryFee = Number(squad.total_entry_fee ?? squad.totalEntryFee ?? this.entry_fee * this.squad_size);
    const isComplete = this.match_type === 'squad' && memberCount >= this.squad_size;
    squad.squad_code = squad.squad_code || squad.squadCode || squad.squad_password || '';
    squad.squad_password = squad.squad_password || squad.squadPassword || squad.squad_code || '';
    squad.total_entry_fee = totalEntryFee;
    squad.entry_paid = squad.entry_paid !== false;
    squad.status = isComplete ? 'complete' : 'forming';
    if (isComplete && !squad.locked_at) {
      squad.locked_at = new Date();
    }
    return squad;
  });
  this.match_start_time = this.match_start_time || this.startTime;
  this.startTime = this.match_start_time;
  this.room_id = this.room_id || this.roomId;
  this.roomId = this.room_id;
  this.room_password = this.room_password || this.roomPassword;
  this.roomPassword = this.room_password;
  this.winner_prize = Number(this.winner_prize || 0);
  this.refund_processed = Boolean(this.refund_processed || this.refundProcessed);
  this.refundProcessed = this.refund_processed;
  next();
});

export default mongoose.model('Tournament', tournamentSchema);
