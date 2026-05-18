import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { configureDnsServers } from '../config/dns.js';
import Deposit from '../models/Deposit.js';
import User from '../models/User.js';
import { completeReferralFirstDeposit } from '../utils/referrals.js';

dotenv.config();
configureDnsServers();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tournament';

try {
  await mongoose.connect(uri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    socketTimeoutMS: 45000
  });

  const referredUsers = await User.find({
    $or: [
      { referred_by: { $exists: true, $ne: null } },
      { referred_by_code: { $exists: true, $ne: '' } }
    ]
  }).sort({ createdAt: 1 });

  let repairedCount = 0;

  for (const user of referredUsers) {
    const firstApprovedDeposit = await Deposit.findOne({
      userId: user._id,
      status: 'approved',
      referral_processed_at: { $exists: false }
    }).sort({ createdAt: 1 });

    if (!firstApprovedDeposit) {
      continue;
    }

    const referrer = user.referred_by
      ? await User.findById(user.referred_by)
      : await User.findOne({ referral_code: user.referred_by_code });

    if (!referrer) {
      continue;
    }

    completeReferralFirstDeposit(referrer, user, firstApprovedDeposit.createdAt || new Date());
    firstApprovedDeposit.referral_processed_at = new Date();

    await referrer.save();
    await firstApprovedDeposit.save();
    repairedCount += 1;
  }

  console.log(`Repaired referral deposit completion for ${repairedCount} user(s).`);
} catch (error) {
  console.error(`Referral repair failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
