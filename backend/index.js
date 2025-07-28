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




// ===== ENHANCED BACKEND SERVER (server.js) =====
const express = require('express');
const { ObjectId } = require('mongodb');
const connectDB = require('./config/mongo');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // 👈 ADD THIS

connectDB().then((db) => {
  const chargers = db.collection('chargers');
  const orders = db.collection('orders');
  const chargingStatus = db.collection('chargingStatus');

  console.log("✅ Connected to MongoDB collections");

  app.get('/', (req, res) => res.send('🚀 EV Charging Backend Running!'));

  // Get all available chargers
  app.get('/api/chargers', async (req, res) => {
    try {
      console.log("📤 GET /api/chargers - Fetching available chargers");
      
      const availableChargers = await chargers.find({ 
        $or: [
          { reserved: { $exists: false } },
          { reserved: false }
        ]
      }).toArray();
      
      console.log(`✅ Found ${availableChargers.length} available chargers`);
      res.json(availableChargers);
    } catch (err) {
      console.error('❌ Error fetching chargers:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Save order with charger and user info
  app.post('/api/save-order', async (req, res) => {
    try {
      const { charger, firstName, lastName, email, phone, timestamp } = req.body;
      
      console.log("📤 POST /api/save-order - Received data:", {
        chargerId: charger?.chargerId,
        firstName,
        lastName,
        email,
        phone
      });
      
      if (!charger?.chargerId || !firstName || !lastName || !email || !phone) {
        console.error("❌ Missing required fields");
        return res.status(400).json({ error: "Missing required information" });
      }

      // Check if charger exists and is available
      const chargerDoc = await chargers.findOne({ chargerId: charger.chargerId });
      console.log("🔍 Charger lookup result:", chargerDoc);
      
      if (!chargerDoc) {
        console.error("❌ Charger not found:", charger.chargerId);
        return res.status(404).json({ error: "Charger not found" });
      }
      
      if (chargerDoc.reserved) {
        console.error("❌ Charger already reserved:", charger.chargerId);
        return res.status(400).json({ error: "Charger already reserved" });
      }

      // Reserve the charger
      console.log("🔒 Reserving charger:", charger.chargerId);
      const updated = await chargers.updateOne(
        { chargerId: charger.chargerId },
        { $set: { reserved: true, reservedAt: new Date() } }
      );

      if (updated.modifiedCount === 0) {
        console.error("❌ Failed to reserve charger");
        return res.status(400).json({ error: "Failed to reserve charger" });
      }

      // Create the order
      const orderData = {
        charger: charger,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        timestamp: timestamp || new Date().toISOString(),
        paid: false,
        paymentStatus: 'pending', // ✅ Initialize with pending
        status: 'pending', // ✅ Initialize with pending
        chargingStarted: false,
        chargingCompleted: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await orders.insertOne(orderData);
      
      console.log('✅ Order created:', result.insertedId);
      res.status(200).json({ 
        message: "Order saved and charger reserved", 
        id: result.insertedId 
      });

    } catch (err) {
      console.error('❌ Error saving order:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ NEW: Enhanced payment creation tracking
  app.post('/api/payment-created', async (req, res) => {
    try {
      const { orderId, molliePaymentId, paymentStatus, amount, customerInfo, redirectUrl } = req.body;
      
      console.log('📤 POST /api/payment-created - Payment initiated:', {
        orderId,
        molliePaymentId,
        paymentStatus
      });

      if (!orderId || !ObjectId.isValid(orderId)) {
        console.error("❌ Invalid order ID:", orderId);
        return res.status(400).json({ error: "Invalid order ID" });
      }

      const updateData = {
        molliePaymentId: molliePaymentId,
        paymentStatus: paymentStatus || 'open',
        paymentAmount: amount,
        paymentInitiatedAt: new Date(),
        redirectUrl: redirectUrl,
        updatedAt: new Date()
      };

      const result = await orders.updateOne(
        { _id: new ObjectId(orderId) },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        console.error("❌ Order not found for payment creation:", orderId);
        return res.status(404).json({ error: "Order not found" });
      }

      console.log('✅ Order updated with payment info:', orderId);
      res.json({ message: "Payment info saved" });

    } catch (err) {
      console.error('❌ Error saving payment creation:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get order by ID
  app.get('/api/get-order/:id', async (req, res) => {
    try {
      const id = req.params.id;
      console.log("📤 GET /api/get-order/:id - Fetching order:", id);
      
      if (!ObjectId.isValid(id)) {
        console.error("❌ Invalid order ID format:", id);
        return res.status(400).json({ error: "Invalid order ID format" });
      }

      const order = await orders.findOne({ _id: new ObjectId(id) });
      
      if (!order) {
        console.error("❌ Order not found:", id);
        return res.status(404).json({ error: "Order not found" });
      }

      console.log("✅ Order found:", {
        id: order._id,
        paid: order.paid,
        paymentStatus: order.paymentStatus,
        status: order.status
      });
      
      res.json(order);

    } catch (err) {
      console.error('❌ Error fetching order:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ✅ ENHANCED: Mollie webhook endpoint with faster processing
  app.post('/api/mollie-webhook', async (req, res) => {
    try {
      const { id: paymentId } = req.body;
      
      console.log('🔔 Mollie webhook received for payment:', paymentId);
      
      if (!paymentId) {
        console.error("❌ Missing payment ID in webhook");
        return res.status(400).json({ error: "Missing payment ID" });
      }

      // Get payment details from Mollie
      const MOLLIE_API_KEY = "test_Eh4TB42uTjCdCaDGQaCfJ6f6f995tk";
      const fetch = require('node-fetch');
      
      const response = await fetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${MOLLIE_API_KEY}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        console.error("❌ Mollie API error in webhook:", response.statusText);
        throw new Error(`Mollie API error: ${response.statusText}`);
      }

      const paymentData = await response.json();
      console.log('💳 Payment data from Mollie:', {
        id: paymentData.id,
        status: paymentData.status,
        orderId: paymentData.metadata?.orderId
      });
      
      if (paymentData.metadata && paymentData.metadata.orderId) {
        const orderId = paymentData.metadata.orderId;
        
        // ✅ CRITICAL FIX: Enhanced status mapping
        const isPaid = paymentData.status === 'paid';
        const isFailed = ['failed', 'canceled', 'cancelled', 'expired'].includes(paymentData.status);
        
        const updateData = {
          paid: isPaid,
          paymentStatus: paymentData.status,
          paymentId: paymentId,
          paymentMethod: paymentData.method,
          paidAt: isPaid ? new Date(paymentData.paidAt) : null,
          status: isPaid ? 'paid' : (isFailed ? 'failed' : 'pending'),
          webhookProcessedAt: new Date(),
          updatedAt: new Date()
        };

        // ✅ IMMEDIATE STATUS UPDATE
        const result = await orders.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: updateData }
        );

        if (result.matchedCount > 0) {
          console.log(`✅ Order ${isPaid ? 'PAID' : (isFailed ? 'FAILED' : 'PENDING')} via webhook:`, orderId);
          
          // ✅ If payment failed, unreserve the charger immediately
          if (isFailed) {
            const order = await orders.findOne({ _id: new ObjectId(orderId) });
            if (order && order.charger && order.charger.chargerId) {
              await chargers.updateOne(
                { chargerId: order.charger.chargerId },
                { 
                  $set: { reserved: false },
                  $unset: { reservedAt: "" }
                }
              );
              console.log('🔓 Charger unreserved due to failed payment:', order.charger.chargerId);
            }
          }
        } else {
          console.error('❌ Order not found for webhook update:', orderId);
        }
      } else {
        console.error('❌ No order ID in payment metadata');
      }

      res.status(200).send('OK');

    } catch (err) {
      console.error('❌ Error processing Mollie webhook:', err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Payment webhook (generic)
  app.post('/api/payment-webhook', async (req, res) => {
    try {
      const { orderId, paymentStatus, paymentId, paymentMethod } = req.body;
      
      console.log('📤 POST /api/payment-webhook - Received:', { orderId, paymentStatus });

      if (!orderId || !ObjectId.isValid(orderId)) {
        console.error("❌ Invalid order ID in webhook:", orderId);
        return res.status(400).json({ error: "Invalid order ID" });
      }

      // ✅ Enhanced status handling
      const isPaid = paymentStatus === 'paid';
      const isFailed = ['failed', 'cancelled', 'canceled', 'expired'].includes(paymentStatus);

      const updateData = {
        paid: isPaid,
        paymentStatus: paymentStatus,
        paymentId: paymentId,
        paymentMethod: paymentMethod,
        paidAt: isPaid ? new Date() : null,
        status: isPaid ? 'paid' : (isFailed ? 'failed' : 'pending'),
        updatedAt: new Date()
      };

      const result = await orders.updateOne(
        { _id: new ObjectId(orderId) },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        console.error("❌ Order not found for webhook update:", orderId);
        return res.status(404).json({ error: "Order not found" });
      }

      console.log('✅ Order payment status updated via generic webhook:', orderId);
      res.json({ message: "Payment status updated" });

    } catch (err) {
      console.error('❌ Error processing payment webhook:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Mark charging as started
  app.post('/api/start-charging/:id', async (req, res) => {
    try {
      const id = req.params.id;
      console.log("📤 POST /api/start-charging/:id - Starting charging for:", id);
      
      if (!ObjectId.isValid(id)) {
        console.error("❌ Invalid order ID:", id);
        return res.status(400).json({ error: "Invalid order ID" });
      }

      // ✅ SECURITY CHECK: Verify payment before allowing charging start
      const order = await orders.findOne({ _id: new ObjectId(id) });
      if (!order) {
        console.error("❌ Order not found:", id);
        return res.status(404).json({ error: "Order not found" });
      }

      if (!order.paid && order.paymentStatus !== 'paid') {
        console.error("❌ Cannot start charging - payment not confirmed:", id);
        return res.status(400).json({ error: "Payment not confirmed" });
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
        console.error("❌ Order not found for charging start:", id);
        return res.status(404).json({ error: "Order not found" });
      }

      console.log('✅ Charging started for order:', id);
      res.json({ message: "Charging started" });

    } catch (err) {
      console.error('❌ Error marking charging as started:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Save charging status
  app.post('/api/charging-status', async (req, res) => {
    try {
      const { orderId, startTime, endTime, durationSeconds, amountPaid, powerKW } = req.body;
      
      console.log('📤 POST /api/charging-status - Received:', {
        orderId,
        startTime,
        endTime,
        durationSeconds,
        amountPaid,
        powerKW
      });
      
      if (!orderId || !startTime) {
        console.error("❌ Missing required charging data");
        return res.status(400).json({ error: "Missing required data" });
      }

      if (!ObjectId.isValid(orderId)) {
        console.error("❌ Invalid order ID:", orderId);
        return res.status(400).json({ error: "Invalid order ID" });
      }

      // Get the order details
      const order = await orders.findOne({ _id: new ObjectId(orderId) });
      if (!order) {
        console.error("❌ Order not found for charging status:", orderId);
        return res.status(404).json({ error: "Order not found" });
      }

      console.log("📋 Order found for charging status:", order._id);

      // Save charging session data
      const chargingData = {
        orderId: new ObjectId(orderId),
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : new Date(),
        durationSeconds: durationSeconds,
        amountPaid: parseFloat(amountPaid) || 0,
        powerKW: parseFloat(powerKW) || 0,
        userPhone: order.phone,
        userEmail: order.email,
        userName: `${order.firstName} ${order.lastName}`,
        charger: order.charger,
        createdAt: new Date()
      };

      const result = await chargingStatus.insertOne(chargingData);
      console.log("✅ Charging session saved:", result.insertedId);
      
      // Update order status to completed
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

      console.log("✅ Order marked as completed:", orderId);

      // Unreserve the charger
      if (order.charger && order.charger.chargerId) {
        await chargers.updateOne(
          { chargerId: order.charger.chargerId },
          { 
            $set: { reserved: false, lastUsed: new Date() },
            $unset: { reservedAt: "" }
          }
        );
        console.log('🔓 Charger unreserved:', order.charger.chargerId);
      }
      
      res.status(200).json({ 
        message: "Charging session saved and order completed", 
        id: result.insertedId 
      });

    } catch (err) {
      console.error('❌ Error saving charging status:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get all orders (admin)
  app.get('/api/orders', async (req, res) => {
    try {
      console.log("📤 GET /api/orders - Fetching all orders");
      const allOrders = await orders.find({}).sort({ createdAt: -1 }).toArray();
      console.log(`✅ Found ${allOrders.length} orders`);
      res.json(allOrders);
    } catch (err) {
      console.error('❌ Error fetching orders:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get all charging sessions (admin)
  app.get('/api/charging-sessions', async (req, res) => {
    try {
      console.log("📤 GET /api/charging-sessions - Fetching all sessions");
      const sessions = await chargingStatus.find({}).sort({ createdAt: -1 }).toArray();
      console.log(`✅ Found ${sessions.length} charging sessions`);
      res.json(sessions);
    } catch (err) {
      console.error('❌ Error fetching charging sessions:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get charging sessions for specific order
  app.get('/api/charging-sessions/:orderId', async (req, res) => {
    try {
      const orderId = req.params.orderId;
      console.log("📤 GET /api/charging-sessions/:orderId - Fetching sessions for:", orderId);
      
      if (!ObjectId.isValid(orderId)) {
        console.error("❌ Invalid order ID:", orderId);
        return res.status(400).json({ error: "Invalid order ID" });
      }

      const sessions = await chargingStatus.find({ 
        orderId: new ObjectId(orderId) 
      }).sort({ createdAt: -1 }).toArray();

      console.log(`✅ Found ${sessions.length} sessions for order:`, orderId);
      res.json(sessions);
    } catch (err) {
      console.error('❌ Error fetching charging sessions for order:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

}).catch((err) => {
  console.error("❌ MongoDB connection failed:", err);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 EV Charging Server running on port ${PORT}`);
  console.log(`📍 Server URL: http://localhost:${PORT}`);
});
