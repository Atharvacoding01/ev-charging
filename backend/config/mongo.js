import { MongoClient } from 'mongodb';

async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI environment variable is not defined');
    }

    console.log('🔄 Connecting to MongoDB...');
    const client = await MongoClient.connect(mongoUri);
    const db = client.db();
    
    console.log('✅ Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
}

export default connectDB;
