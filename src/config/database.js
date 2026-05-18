import mongoose from 'mongoose';
import { configureDnsServers } from './dns.js';

const useOfflineStore = () => {
  const value = (process.env.USE_OFFLINE_STORE || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
};

const connectDB = async () => {
  if (useOfflineStore()) {
    isConnected = false;
    await mongoose.disconnect().catch(() => {});
    console.log('Offline store mode enabled. Using backend/src/data/store.json only.');
    return;
  }

  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tournament';
  try {
    configureDnsServers();
    const connectPromise = mongoose.connect(MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('MongoDB connection timed out')), 25000);
    });
    const conn = await Promise.race([connectPromise, timeoutPromise]);
    isConnected = true;
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    isConnected = false;
    await mongoose.disconnect().catch(() => {});
    console.error('MongoDB connection failed:', error.message);
    console.log('Running in offline mode. Data will be stored in backend/src/data/store.json until MongoDB is reachable.');
  }
};

let isConnected = false;

export const isDBConnected = () => isConnected;
export default connectDB;
