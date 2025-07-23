// ✅ BACKEND CODE (server.js)

const express = require('express');
const { ObjectId } = require('mongodb');
const connectDB = require('./config/mongo');
const cors = require('cors');

const app = express();

// ✅ Middleware
app.use(cors());
app.use(express.json());

// ✅ Connect MongoDB and define routes
connectDB().then((db) => {
  const chargers = db.collection('chargers');
  const orders = db.collection('orders');

  // ✅ Test Route
  app.get('/', (req, res) => {
    res.send('🚀 Backend running!');
  });

  // ✅ Get all chargers
  app.get('/api/chargers', async (req, res) => {
    try {
      const allChargers = await chargers.find({}).toArray();
      res.json(allChargers);
    } catch (err) {
      console.error("❌ Failed to fetch chargers:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ Save new order
  app.post('/api/save-order', async (req, res) => {
    try {
      const { charger, timestamp } = req.body;

      if (!charger || !charger.chargerId || !charger.label) {
        return res.status(400).json({ error: "Missing charger selection" });
      }

      const result = await orders.insertOne({
        charger,
        timestamp: timestamp || new Date().toISOString(),
        firstName: "",
        lastName: "",
        email: "",
        phone: ""
      });

      res.status(200).json({ message: "Order saved", id: result.insertedId });
    } catch (err) {
      console.error("❌ Failed to save order:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ Get order by ID
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
      console.error("❌ Failed to fetch order:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ Update order
  // ✅ Update order AND preserve existing charger
app.patch('/api/update-order/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { firstName, lastName, email, phone } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID format" });
    }

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 🔍 Fetch existing order to make sure we keep the charger
    const existingOrder = await orders.findOne({ _id: new ObjectId(id) });

    if (!existingOrder) {
      return res.status(404).json({ error: "Order not found" });
    }

    const result = await orders.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          firstName,
          lastName,
          email,
          phone,
          charger: existingOrder.charger || null, // ✅ ensure charger is not lost
        }
      }
    );

    res.json({ message: "Order updated", result });
  } catch (err) {
    console.error("❌ Failed to update order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


      res.json({ message: "Order updated", result });
    } catch (err) {
      console.error("❌ Failed to update order:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

}).catch((err) => {
  console.error("❌ Failed to connect to MongoDB:", err);
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
