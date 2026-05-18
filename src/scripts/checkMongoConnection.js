import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { configureDnsServers } from '../config/dns.js';

dotenv.config();
configureDnsServers();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tournament';

try {
  const conn = await mongoose.connect(uri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    socketTimeoutMS: 45000
  });

  console.log(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
  await mongoose.disconnect();
} catch (error) {
  console.error(`MongoDB connection failed: ${error.message}`);
  process.exitCode = 1;
}
