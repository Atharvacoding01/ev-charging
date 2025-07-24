// ✅ BACKEND CODE (server.js)

const express = require('express');
const { ObjectId } = require('mongodb');
const connectDB = require('./config/mongo');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

connectDB().then((db) => {
  const chargers = db.collection('chargers');
  const orders = db.collection('orders');

  app.get('/', (req, res) => res.send('🚀 Backend running!'));

  app.get('/api/chargers', async (req, res) => {
    try {
      const all = await chargers.find({}).toArray();
      res.json(all);
    } catch (err) {
      console.error("❌ Fetch chargers:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post('/api/save-order', async (req, res) => {
    try {
      const { charger, timestamp, ...user } = req.body;

      if (!charger || !charger.chargerId) {
        return res.status(400).json({ error: "Missing charger info" });
      }

      // Reserve charger
      const updated = await chargers.updateOne(
        { chargerId: charger.chargerId },
        { $set: { reserved: true } }
      );

      if (updated.modifiedCount === 0) {
        return res.status(400).json({ error: "Charger may already be reserved" });
      }

      const result = await orders.insertOne({
        charger,
        timestamp: timestamp || new Date().toISOString(),
        ...user
      });

      res.status(200).json({ message: "Order saved", id: result.insertedId });
    } catch (err) {
      console.error("❌ Save order:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post('/api/release-charger', async (req, res) => {
    try {
      const { chargerId } = req.body;

      if (!chargerId) {
        return res.status(400).json({ error: "Missing chargerId" });
      }

      const result = await chargers.updateOne(
        { chargerId },
        { $set: { reserved: false } }
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: "Charger not found or already released" });
      }

      res.json({ message: "Charger released" });
    } catch (err) {
      console.error("❌ Release charger:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get('/api/get-order/:id', async (req, res) => {
    try {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid ID format" });
      }

      const order = await orders.findOne({ _id: new ObjectId(id) });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json(order);
    } catch (err) {
      console.error("❌ Get order:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch('/api/update-order/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const { firstName, lastName, email, phone } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid ID format" });
      }

      const existingOrder = await orders.findOne({ _id: new ObjectId(id) });
      if (!existingOrder) {
        return res.status(404).json({ error: "Order not found" });
      }

      const result = await orders.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            firstName: firstName?.trim(),
            lastName: lastName?.trim(),
            email: email?.trim(),
            phone: phone?.trim(),
            charger: existingOrder.charger || null
          }
        }
      );

      res.json({ message: "Order updated", result });
    } catch (err) {
      console.error("❌ Update order:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}).catch((err) => {
  console.error("❌ MongoDB connection failed:", err);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
