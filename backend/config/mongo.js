// mongo.js
const { MongoClient } = require("mongodb");
require("dotenv").config(); // Load env vars from .env

const uri = process.env.MONGO_URI;

if (!uri) {
  throw new Error("❌ MONGO_URI not defined in environment variables");
}

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

let cachedDb = null;

async function connectToMongo() {
  if (cachedDb) {
    return cachedDb; // ✅ Reuse existing connection
  }

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");

    const dbName = uri.split('/').pop().split('?')[0]; // Extract DB name from URI
    const db = client.db(dbName);
    
    cachedDb = db;
    return db;
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    throw error;
  }
}

module.exports = connectToMongo;
