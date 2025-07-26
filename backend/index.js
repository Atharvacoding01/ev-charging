// const express = require('express');
// const { ObjectId } = require('mongodb');
// const connectDB = require('./config/mongo');
// const cors = require('cors');

// const app = express();

// app.use(cors());
// app.use(express.json());

// connectDB().then((db) => {
//   const chargers = db.collection('chargers');
//   const orders = db.collection('orders');

//   app.get('/', (req, res) => res.send('🚀 Backend running!'));

//   app.get('/api/chargers', async (req, res) => {
//     try {
//       const all = await chargers.find({}).toArray();
//       res.json(all);
//     } catch (err) {
//       console.error("❌ Fetch chargers:", err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   app.post('/api/save-order', async (req, res) => {
//     try {
//       const { charger, timestamp, ...user } = req.body;

//       if (!charger || !charger.chargerId) {
//         return res.status(400).json({ error: "Missing charger info" });
//       }

//       const result = await orders.insertOne({
//         charger,
//         timestamp: timestamp || new Date().toISOString(),
//         ...user
//       });

//       res.status(200).json({ message: "Order saved", id: result.insertedId });
//     } catch (err) {
//       console.error("❌ Save order:", err);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   app.get('/api/get-order/:id', async (req, res) => {
//     try {
//       const id = req.params.id;

//       if (!ObjectId.isValid(id)) {
//         return res.status(400).json({ error: "Invalid ID format" });
//       }

//       const order = await orders.findOne({ _id: new ObjectId(id) });

//       if (!order) {
//         return res.status(404).json({ error: "Order not found" });
//       }

//       res.json(order);
//     } catch (err) {
//       console.error("❌ Get order:", err);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   app.patch('/api/update-order/:id', async (req, res) => {
//     try {
//       const id = req.params.id;
//       const { firstName, lastName, email, phone } = req.body;

//       if (!ObjectId.isValid(id)) {
//         return res.status(400).json({ error: "Invalid ID format" });
//       }

//       const existingOrder = await orders.findOne({ _id: new ObjectId(id) });
//       if (!existingOrder) {
//         return res.status(404).json({ error: "Order not found" });
//       }

//       const result = await orders.updateOne(
//         { _id: new ObjectId(id) },
//         {
//           $set: {
//             firstName: firstName?.trim(),
//             lastName: lastName?.trim(),
//             email: email?.trim(),
//             phone: phone?.trim(),
//             charger: existingOrder.charger || null
//           }
//         }
//       );

//       res.json({ message: "Order updated", result });
//     } catch (err) {
//       console.error("❌ Update order:", err);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

// }).catch((err) => {
//   console.error("❌ MongoDB connection failed:", err);
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));




// ✅ FINAL BACKEND (server.js) - Complete Integration
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
  const chargingStatus = db.collection('chargingStatus');

  app.get('/', (req, res) => res.send('🚀 EV Charging Backend Running!'));

  // ✅ Get all available chargers
  app.get('/api/chargers', async (req, res) => {
    try {
      const all = await chargers.find({}).toArray();
      res.json(all);
    } catch (err) {
      console.error('Error fetching chargers:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ✅ Save order with charger (reserves the charger)
  app.post('/api/save-order', async (req, res) => {
    try {
      const { charger, timestamp } = req.body;
      
      if (!charger?.chargerId) {
        return res.status(400).json({ error: "Missing charger info" });
      }

      // Check if charger exists and is available
      const chargerDoc = await chargers.findOne({ chargerId: charger.chargerId });
      if (!chargerDoc) {
        return res.status(404).json({ error: "Charger not found" });
      }
      
      if (chargerDoc.reserved) {
        return res.status(400).json({ error: "Charger already reserved" });
      }

      // Reserve the charger
      const updated = await chargers.updateOne(
        { chargerId: charger.chargerId },
        { $set: { reserved: true, reservedAt: new Date() } }
      );

      if (updated.modifiedCount === 0) {
        return res.status(400).json({ error: "Failed to reserve charger" });
      }

      // Create the order
      const orderData = {
        charger: charger,
        timestamp: timestamp || new Date().toISOString(),
        paid: false,
        chargingStarted: false,
        chargingCompleted: false,
        createdAt: new Date(),
        status: 'pending' // pending -> paid -> charging -> completed
      };

      const result = await orders.insertOne(orderData);
      
      console.log('✅ Order created and charger reserved:', result.insertedId);
      res.status(200).json({ 
        message: "Order saved and charger reserved", 
        id: result.insertedId 
      });

    } catch (err) {
      console.error('Error saving order:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ Update order with user details
  app.patch('/api/update-order/:id', async (req, res) => {
    try {
      const id = req.params.id;
      
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      const { firstName, lastName, email, phone, paid } = req.body;
      
      const updateFields = {};
      if (firstName) updateFields.firstName = firstName.trim();
      if (lastName) updateFields.lastName = lastName.trim();
      if (email) updateFields.email = email.trim();
      if (phone) updateFields.phone = phone.trim();
      if (typeof paid === 'boolean') updateFields.paid = paid;
      
      updateFields.updatedAt = new Date();

      const result = await orders.updateOne(
        { _id: new ObjectId(id) }, 
        { $set: updateFields }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      console.log('✅ Order updated:', id);
      res.json({ 
        message: "Order updated successfully", 
        modifiedCount: result.modifiedCount 
      });

    } catch (err) {
      console.error('Error updating order:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ Get order by ID
  app.get('/api/get-order/:id', async (req, res) => {
    try {
      const id = req.params.id;
      
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid order ID format" });
      }

      const order = await orders.findOne({ _id: new ObjectId(id) });
      
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json(order);

    } catch (err) {
      console.error('Error fetching order:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ Payment webhook - Updates order when payment is confirmed
  app.post('/api/payment-webhook', async (req, res) => {
    try {
      const { orderId, paymentStatus, paymentId, paymentMethod } = req.body;
      
      console.log('💳 Payment webhook received:', { orderId, paymentStatus, paymentId });

      if (!orderId || !ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      // Update order with payment status
      const updateData = {
        paid: paymentStatus === 'paid',
        paymentStatus: paymentStatus,
        paymentId: paymentId,
        paymentMethod: paymentMethod,
        paidAt: paymentStatus === 'paid' ? new Date() : null,
        status: paymentStatus === 'paid' ? 'paid' : 'pending',
        updatedAt: new Date()
      };

      const result = await orders.updateOne(
        { _id: new ObjectId(orderId) },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      console.log('✅ Order payment status updated:', orderId);
      res.json({ message: "Payment status updated" });

    } catch (err) {
      console.error('Error processing payment webhook:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ NEW: Mark charging as started (called when charging begins)
  app.post('/api/start-charging/:id', async (req, res) => {
    try {
      const id = req.params.id;
      
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      const result = await orders.updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            chargingStarted: true,
            chargingStartedAt: new Date(),
            status: 'charging',
            updatedAt: new Date()
          } 
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      console.log('🔌 Charging started for order:', id);
      res.json({ message: "Charging started" });

    } catch (err) {
      console.error('Error marking charging as started:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ UPDATED: Save charging status (when charging is completed)
  app.post('/api/charging-status', async (req, res) => {
    try {
      const { orderId, startTime, endTime, durationSeconds, amountPaid, powerKW } = req.body;
      
      if (!orderId || !startTime) {
        return res.status(400).json({ error: "Missing required data" });
      }

      if (!ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      // Get the order details
      const order = await orders.findOne({ _id: new ObjectId(orderId) });
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // ✅ Save charging session data
      const chargingData = {
        orderId: new ObjectId(orderId),
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : new Date(),
        durationSeconds: durationSeconds,
        amountPaid: parseFloat(amountPaid) || 0,
        powerKW: parseFloat(powerKW) || 0,
        userPhone: order.phone,
        userEmail: order.email,
        userName: `${order.firstName || ''} ${order.lastName || ''}`.trim(),
        charger: order.charger || null,
        createdAt: new Date()
      };

      const result = await chargingStatus.insertOne(chargingData);
      
      // ✅ Update order status to completed and unreserve charger
      await orders.updateOne(
        { _id: new ObjectId(orderId) },
        { 
          $set: { 
            chargingCompleted: true,
            chargingCompletedAt: new Date(),
            status: 'completed',
            finalAmount: parseFloat(amountPaid) || 0,
            updatedAt: new Date()
          } 
        }
      );

      // ✅ Unreserve the charger for next use
      if (order.charger && order.charger.chargerId) {
        await chargers.updateOne(
          { chargerId: order.charger.chargerId },
          { 
            $set: { 
              reserved: false,
              lastUsed: new Date()
            },
            $unset: { reservedAt: "" }
          }
        );
        console.log('🔓 Charger unreserved:', order.charger.chargerId);
      }
      
      console.log('✅ Charging session completed and saved:', result.insertedId);
      res.status(200).json({ 
        message: "Charging session saved and order completed", 
        id: result.insertedId 
      });

    } catch (err) {
      console.error('Error saving charging status:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ Get all orders (for admin)
  app.get('/api/orders', async (req, res) => {
    try {
      const allOrders = await orders.find({}).sort({ createdAt: -1 }).toArray();
      res.json(allOrders);
    } catch (err) {
      console.error('Error fetching orders:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ Get all charging sessions (for admin)
  app.get('/api/charging-sessions', async (req, res) => {
    try {
      const sessions = await chargingStatus.find({}).sort({ createdAt: -1 }).toArray();
      res.json(sessions);
    } catch (err) {
      console.error('Error fetching charging sessions:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ Get charging sessions for a specific order
  app.get('/api/charging-sessions/:orderId', async (req, res) => {
    try {
      const orderId = req.params.orderId;
      
      if (!ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      const sessions = await chargingStatus.find({ 
        orderId: new ObjectId(orderId) 
      }).sort({ createdAt: -1 }).toArray();

      res.json(sessions);
    } catch (err) {
      console.error('Error fetching charging sessions for order:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

}).catch((err) => console.error("❌ MongoDB connection failed:", err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 EV Charging Server running on port ${PORT}`));
