const { MongoClient } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGO_URI;

if (!uri) {
  throw new Error("❌ MONGO_URI not defined in .env");
}

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

let cachedDb = null;

async function connectToMongo() {
  if (cachedDb) {
    return cachedDb;
  }

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");

    // Automatically extract DB name from URI
    const url = new URL(uri);
    const dbName = url.pathname.replace('/', '').split('?')[0];

    if (!dbName) {
      throw new Error("❌ Could not extract DB name from URI");
    }

    const db = client.db(dbName);
    cachedDb = db;

    return db;
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error.message);
    throw error;
  }
}

module.exports = connectToMongo;
