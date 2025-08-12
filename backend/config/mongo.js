import { MongoClient } from 'mongodb';

async function connectDB() {
  try {
    const client = await MongoClient.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    return client.db();
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

export default connectDB;
