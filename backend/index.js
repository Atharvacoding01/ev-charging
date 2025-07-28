// // // ===== 5. BACKEND SERVER (server.js) =====
// // const express = require('express');
// // const { ObjectId } = require('mongodb');
// // const connectDB = require('./config/mongo');
// // const cors = require('cors');

// // const app = express();
// // app.use(cors());
// // app.use(express.json());

// // connectDB().then((db) => {
// //   const chargers = db.collection('chargers');
// //   const orders = db.collection('orders');
// //   const chargingStatus = db.collection('chargingStatus');

// //   console.log("✅ Connected to MongoDB collections");

// //   app.get('/', (req, res) => res.send('🚀 EV Charging Backend Running!'));

// //   // Get all available chargers
// //   app.get('/api/chargers', async (req, res) => {
// //     try {
// //       console.log("📤 GET /api/chargers - Fetching available chargers");
      
// //       const availableChargers = await chargers.find({ 
// //         $or: [
// //           { reserved: { $exists: false } },
// //           { reserved: false }
// //         ]
// //       }).toArray();
      
// //       console.log(`✅ Found ${availableChargers.length} available chargers`);
// //       res.json(availableChargers);
// //     } catch (err) {
// //       console.error('❌ Error fetching chargers:', err);
// //       res.status(500).json({ error: "Internal error" });
// //     }
// //   });

// //   // Save order with charger and user info
// //   app.post('/api/save-order', async (req, res) => {
// //     try {
// //       const { charger, firstName, lastName, email, phone, timestamp } = req.body;
      
// //       console.log("📤 POST /api/save-order - Received data:", {
// //         chargerId: charger?.chargerId,
// //         firstName,
// //         lastName,
// //         email,
// //         phone
// //       });
      
// //       if (!charger?.chargerId || !firstName || !lastName || !email || !phone) {
// //         console.error("❌ Missing required fields");
// //         return res.status(400).json({ error: "Missing required information" });
// //       }

// //       // Check if charger exists and is available
// //       const chargerDoc = await chargers.findOne({ chargerId: charger.chargerId });
// //       console.log("🔍 Charger lookup result:", chargerDoc);
      
// //       if (!chargerDoc) {
// //         console.error("❌ Charger not found:", charger.chargerId);
// //         return res.status(404).json({ error: "Charger not found" });
// //       }
      
// //       if (chargerDoc.reserved) {
// //         console.error("❌ Charger already reserved:", charger.chargerId);
// //         return res.status(400).json({ error: "Charger already reserved" });
// //       }

// //       // Reserve the charger
// //       console.log("🔒 Reserving charger:", charger.chargerId);
// //       const updated = await chargers.updateOne(
// //         { chargerId: charger.chargerId },
// //         { $set: { reserved: true, reservedAt: new Date() } }
// //       );

// //       if (updated.modifiedCount === 0) {
// //         console.error("❌ Failed to reserve charger");
// //         return res.status(400).json({ error: "Failed to reserve charger" });
// //       }

// //       // Create the order
// //       const orderData = {
// //         charger: charger,
// //         firstName: firstName.trim(),
// //         lastName: lastName.trim(),
// //         email: email.trim(),
// //         phone: phone.trim(),
// //         timestamp: timestamp || new Date().toISOString(),
// //         paid: false,
// //         chargingStarted: false,
// //         chargingCompleted: false,
// //         createdAt: new Date(),
// //         status: 'pending'
// //       };

// //       const result = await orders.insertOne(orderData);
      
// //       console.log('✅ Order created:', result.insertedId);
// //       res.status(200).json({ 
// //         message: "Order saved and charger reserved", 
// //         id: result.insertedId 
// //       });

// //     } catch (err) {
// //       console.error('❌ Error saving order:', err);
// //       res.status(500).json({ error: "Internal server error" });
// //     }
// //   });

// //   // Get order by ID
// //   app.get('/api/get-order/:id', async (req, res) => {
// //     try {
// //       const id = req.params.id;
// //       console.log("📤 GET /api/get-order/:id - Fetching order:", id);
      
// //       if (!ObjectId.isValid(id)) {
// //         console.error("❌ Invalid order ID format:", id);
// //         return res.status(400).json({ error: "Invalid order ID format" });
// //       }

// //       const order = await orders.findOne({ _id: new ObjectId(id) });
      
// //       if (!order) {
// //         console.error("❌ Order not found:", id);
// //         return res.status(404).json({ error: "Order not found" });
// //       }

// //       console.log("✅ Order found:", order._id);
// //       res.json(order);

// //     } catch (err) {
// //       console.error('❌ Error fetching order:', err);
// //       res.status(500).json({ error: "Internal server error" });
// //     }
// //   });

// //   // Payment webhook
// //   app.post('/api/payment-webhook', async (req, res) => {
// //     try {
// //       const { orderId, paymentStatus, paymentId, paymentMethod } = req.body;
      
// //       console.log('📤 POST /api/payment-webhook - Received:', { orderId, paymentStatus });

// //       if (!orderId || !ObjectId.isValid(orderId)) {
// //         console.error("❌ Invalid order ID in webhook:", orderId);
// //         return res.status(400).json({ error: "Invalid order ID" });
// //       }

// //       const updateData = {
// //         paid: paymentStatus === 'paid',
// //         paymentStatus: paymentStatus,
// //         paymentId: paymentId,
// //         paymentMethod: paymentMethod,
// //         paidAt: paymentStatus === 'paid' ? new Date() : null,
// //         status: paymentStatus === 'paid' ? 'paid' : 'pending',
// //         updatedAt: new Date()
// //       };

// //       const result = await orders.updateOne(
// //         { _id: new ObjectId(orderId) },
// //         { $set: updateData }
// //       );

// //       if (result.matchedCount === 0) {
// //         console.error("❌ Order not found for webhook update:", orderId);
// //         return res.status(404).json({ error: "Order not found" });
// //       }

// //       console.log('✅ Order payment status updated via webhook:', orderId);
// //       res.json({ message: "Payment status updated" });

// //     } catch (err) {
// //       console.error('❌ Error processing payment webhook:', err);
// //       res.status(500).json({ error: "Internal server error" });
// //     }
// //   });

// //   // Mark charging as started
// //   app.post('/api/start-charging/:id', async (req, res) => {
// //     try {
// //       const id = req.params.id;
// //       console.log("📤 POST /api/start-charging/:id - Starting charging for:", id);
      
// //       if (!ObjectId.isValid(id)) {
// //         console.error("❌ Invalid order ID:", id);
// //         return res.status(400).json({ error: "Invalid order ID" });
// //       }

// //       const result = await orders.updateOne(
// //         { _id: new ObjectId(id) },
// //         { 
// //           $set: { 
// //             chargingStarted: true,
// //             chargingStartedAt: new Date(),
// //             status: 'charging',
// //             updatedAt: new Date()
// //           } 
// //         }
// //       );

// //       if (result.matchedCount === 0) {
// //         console.error("❌ Order not found for charging start:", id);
// //         return res.status(404).json({ error: "Order not found" });
// //       }

// //       console.log('✅ Charging started for order:', id);
// //       res.json({ message: "Charging started" });

// //     } catch (err) {
// //       console.error('❌ Error marking charging as started:', err);
// //       res.status(500).json({ error: "Internal server error" });
// //     }
// //   });

// //   // Save charging status
// //   app.post('/api/charging-status', async (req, res) => {
// //     try {
// //       const { orderId, startTime, endTime, durationSeconds, amountPaid, powerKW } = req.body;
      
// //       console.log('📤 POST /api/charging-status - Received:', {
// //         orderId,
// //         startTime,
// //         endTime,
// //         durationSeconds,
// //         amountPaid,
// //         powerKW
// //       });
      
// //       if (!orderId || !startTime) {
// //         console.error("❌ Missing required charging data");
// //         return res.status(400).json({ error: "Missing required data" });
// //       }

// //       if (!ObjectId.isValid(orderId)) {
// //         console.error("❌ Invalid order ID:", orderId);
// //         return res.status(400).json({ error: "Invalid order ID" });
// //       }

// //       // Get the order details
// //       const order = await orders.findOne({ _id: new ObjectId(orderId) });
// //       if (!order) {
// //         console.error("❌ Order not found for charging status:", orderId);
// //         return res.status(404).json({ error: "Order not found" });
// //       }

// //       console.log("📋 Order found for charging status:", order._id);

// //       // Save charging session data
// //       const chargingData = {
// //         orderId: new ObjectId(orderId),
// //         startTime: new Date(startTime),
// //         endTime: endTime ? new Date(endTime) : new Date(),
// //         durationSeconds: durationSeconds,
// //         amountPaid: parseFloat(amountPaid) || 0,
// //         powerKW: parseFloat(powerKW) || 0,
// //         userPhone: order.phone,
// //         userEmail: order.email,
// //         userName: ${order.firstName} ${order.lastName},
// //         charger: order.charger,
// //         createdAt: new Date()
// //       };

// //       const result = await chargingStatus.insertOne(chargingData);
// //       console.log("✅ Charging session saved:", result.insertedId);
      
// //       // Update order status to completed
// //       await orders.updateOne(
// //         { _id: new ObjectId(orderId) },
// //         { 
// //           $set: { 
// //             chargingCompleted: true,
// //             chargingCompletedAt: new Date(),
// //             status: 'completed',
// //             finalAmount: parseFloat(amountPaid) || 0,
// //             updatedAt: new Date()
// //           } 
// //         }
// //       );

// //       console.log("✅ Order marked as completed:", orderId);

// //       // Unreserve the charger
// //       if (order.charger && order.charger.chargerId) {
// //         await chargers.updateOne(
// //           { chargerId: order.charger.chargerId },
// //           { 
// //             $set: { reserved: false, lastUsed: new Date() },
// //             $unset: { reservedAt: "" }
// //           }
// //         );
// //         console.log('🔓 Charger unreserved:', order.charger.chargerId);
// //       }
      
// //       res.status(200).json({ 
// //         message: "Charging session saved and order completed", 
// //         id: result.insertedId 
// //       });

// //     } catch (err) {
// //       console.error('❌ Error saving charging status:', err);
// //       res.status(500).json({ error: "Internal server error" });
// //     }
// //   });

// //   // Mollie webhook endpoint
// //   app.post('/api/mollie-webhook', async (req, res) => {
// //     try {
// //       const { id: paymentId } = req.body;
      
// //       console.log('🔔 Mollie webhook received for payment:', paymentId);
      
// //       if (!paymentId) {
// //         console.error("❌ Missing payment ID in webhook");
// //         return res.status(400).json({ error: "Missing payment ID" });
// //       }

// //       // Get payment details from Mollie
// //       const MOLLIE_API_KEY = "test_Eh4TB42uTjCdCaDGQaCfJ6f6f995tk";
// //       const fetch = require('node-fetch');
      
// //       const response = await fetch(https://api.mollie.com/v2/payments/${paymentId}, {
// //         method: "GET",
// //         headers: {
// //           "Authorization": Bearer ${MOLLIE_API_KEY},
// //           "Content-Type": "application/json"
// //         }
// //       });

// //       if (!response.ok) {
// //         console.error("❌ Mollie API error in webhook:", response.statusText);
// //         throw new Error(Mollie API error: ${response.statusText});
// //       }

// //       const paymentData = await response.json();
// //       console.log('💳 Payment data from Mollie:', {
// //         id: paymentData.id,
// //         status: paymentData.status,
// //         orderId: paymentData.metadata?.orderId
// //       });
      
// //       if (paymentData.metadata && paymentData.metadata.orderId) {
// //         const orderId = paymentData.metadata.orderId;
        
// //         const updateData = {
// //           paid: paymentData.status === 'paid',
// //           paymentStatus: paymentData.status,
// //           paymentId: paymentId,
// //           paymentMethod: paymentData.method,
// //           paidAt: paymentData.status === 'paid' ? new Date(paymentData.paidAt) : null,
// //           status: paymentData.status === 'paid' ? 'paid' : 'pending',
// //           updatedAt: new Date()
// //         };

// //         const result = await orders.updateOne(
// //           { _id: new ObjectId(orderId) },
// //           { $set: updateData }
// //         );

// //         if (result.matchedCount > 0) {
// //           console.log('✅ Order updated via Mollie webhook:', orderId, paymentData.status);
// //         } else {
// //           console.error('❌ Order not found for webhook update:', orderId);
// //         }
// //       } else {
// //         console.error('❌ No order ID in payment metadata');
// //       }

// //       res.status(200).send('OK');

// //     } catch (err) {
// //       console.error('❌ Error processing Mollie webhook:', err);
// //       res.status(500).json({ error: "Webhook processing failed" });
// //     }
// //   });

// //   // Get all orders (admin)
// //   app.get('/api/orders', async (req, res) => {
// //     try {
// //       console.log("📤 GET /api/orders - Fetching all orders");
// //       const allOrders = await orders.find({}).sort({ createdAt: -1 }).toArray();
// //       console.log(✅ Found ${allOrders.length} orders);
// //       res.json(allOrders);
// //     } catch (err) {
// //       console.error('❌ Error fetching orders:', err);
// //       res.status(500).json({ error: "Internal server error" });
// //     }
// //   });

// //   // Get all charging sessions (admin)
// //   app.get('/api/charging-sessions', async (req, res) => {
// //     try {
// //       console.log("📤 GET /api/charging-sessions - Fetching all sessions");
// //       const sessions = await chargingStatus.find({}).sort({ createdAt: -1 }).toArray();
// //       console.log(✅ Found ${sessions.length} charging sessions);
// //       res.json(sessions);
// //     } catch (err) {
// //       console.error('❌ Error fetching charging sessions:', err);
// //       res.status(500).json({ error: "Internal server error" });
// //     }
// //   });

// //   // Get charging sessions for specific order
// //   app.get('/api/charging-sessions/:orderId', async (req, res) => {
// //     try {
// //       const orderId = req.params.orderId;
// //       console.log("📤 GET /api/charging-sessions/:orderId - Fetching sessions for:", orderId);
      
// //       if (!ObjectId.isValid(orderId)) {
// //         console.error("❌ Invalid order ID:", orderId);
// //         return res.status(400).json({ error: "Invalid order ID" });
// //       }

// //       const sessions = await chargingStatus.find({ 
// //         orderId: new ObjectId(orderId) 
// //       }).sort({ createdAt: -1 }).toArray();

// //       console.log(✅ Found ${sessions.length} sessions for order:, orderId);
// //       res.json(sessions);
// //     } catch (err) {
// //       console.error('❌ Error fetching charging sessions for order:', err);
// //       res.status(500).json({ error: "Internal server error" });
// //     }
// //   });

// // }).catch((err) => {
// //   console.error("❌ MongoDB connection failed:", err);
// // });

// // const PORT = process.env.PORT || 5000;
// // app.listen(PORT, () => {
// //   console.log(🚀 EV Charging Server running on port ${PORT});
// //   console.log(📍 Server URL: http://localhost:${PORT});
// // });



// const express = require('express');
// const { ObjectId } = require('mongodb');
// const connectDB = require('./config/mongo');
// const cors = require('cors');
// const fetch = require('node-fetch'); // Ensure installed: npm install node-fetch

// const app = express();
// app.use(cors());
// app.use(express.json());

// connectDB().then((db) => {
//   const chargers = db.collection('chargers');
//   const orders = db.collection('orders');
//   const chargingStatus = db.collection('chargingStatus');

//   console.log("✅ Connected to MongoDB collections");

//   app.get('/', (req, res) => res.send('🚀 EV Charging Backend Running!'));

//   app.get('/api/chargers', async (req, res) => {
//     try {
//       console.log("📤 GET /api/chargers - Fetching available chargers");
//       const availableChargers = await chargers.find({
//         $or: [
//           { reserved: { $exists: false } },
//           { reserved: false }
//         ]
//       }).toArray();
//       console.log(`✅ Found ${availableChargers.length} available chargers`);
//       res.json(availableChargers);
//     } catch (err) {
//       console.error('❌ Error fetching chargers:', err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   app.post('/api/save-order', async (req, res) => {
//     try {
//       const { charger, firstName, lastName, email, phone, timestamp } = req.body;

//       if (!charger?.chargerId || !firstName || !lastName || !email || !phone) {
//         return res.status(400).json({ error: "Missing required information" });
//       }

//       const chargerDoc = await chargers.findOne({ chargerId: charger.chargerId });
//       if (!chargerDoc || chargerDoc.reserved) {
//         return res.status(400).json({ error: "Charger not available" });
//       }

//       await chargers.updateOne(
//         { chargerId: charger.chargerId },
//         { $set: { reserved: true, reservedAt: new Date() } }
//       );

//       const orderData = {
//         charger,
//         firstName: firstName.trim(),
//         lastName: lastName.trim(),
//         email: email.trim(),
//         phone: phone.trim(),
//         timestamp: timestamp || new Date().toISOString(),
//         paid: false,
//         chargingStarted: false,
//         chargingCompleted: false,
//         createdAt: new Date(),
//         status: 'pending'
//       };

//       const result = await orders.insertOne(orderData);
//       res.status(200).json({ message: "Order saved", id: result.insertedId });
//     } catch (err) {
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   app.get('/api/get-order/:id', async (req, res) => {
//     try {
//       const id = req.params.id;
//       if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID" });

//       const order = await orders.findOne({ _id: new ObjectId(id) });
//       if (!order) return res.status(404).json({ error: "Order not found" });

//       res.json(order);
//     } catch (err) {
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   app.post('/api/payment-webhook', async (req, res) => {
//     try {
//       const { orderId, paymentStatus, paymentId, paymentMethod } = req.body;
//       if (!orderId || !ObjectId.isValid(orderId)) return res.status(400).json({ error: "Invalid order ID" });

//       const updateData = {
//         paid: paymentStatus === 'paid',
//         paymentStatus,
//         paymentId,
//         paymentMethod,
//         paidAt: paymentStatus === 'paid' ? new Date() : null,
//         status: paymentStatus === 'paid' ? 'paid' : 'pending',
//         updatedAt: new Date()
//       };

//       await orders.updateOne({ _id: new ObjectId(orderId) }, { $set: updateData });
//       res.json({ message: "Webhook updated" });
//     } catch (err) {
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   app.post('/api/start-charging/:id', async (req, res) => {
//     try {
//       const id = req.params.id;
//       if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid order ID" });

//       await orders.updateOne(
//         { _id: new ObjectId(id) },
//         {
//           $set: {
//             chargingStarted: true,
//             chargingStartedAt: new Date(),
//             status: 'charging',
//             updatedAt: new Date()
//           }
//         }
//       );

//       res.json({ message: "Charging started" });
//     } catch (err) {
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   app.post('/api/charging-status', async (req, res) => {
//     try {
//       const { orderId, startTime, endTime, durationSeconds, amountPaid, powerKW } = req.body;
//       if (!orderId || !ObjectId.isValid(orderId)) return res.status(400).json({ error: "Invalid data" });

//       const order = await orders.findOne({ _id: new ObjectId(orderId) });
//       if (!order) return res.status(404).json({ error: "Order not found" });

//       const chargingData = {
//         orderId: new ObjectId(orderId),
//         startTime: new Date(startTime),
//         endTime: endTime ? new Date(endTime) : new Date(),
//         durationSeconds,
//         amountPaid: parseFloat(amountPaid) || 0,
//         powerKW: parseFloat(powerKW) || 0,
//         userPhone: order.phone,
//         userEmail: order.email,
//         userName: `${order.firstName} ${order.lastName}`,
//         charger: order.charger,
//         createdAt: new Date()
//       };

//       const result = await chargingStatus.insertOne(chargingData);

//       await orders.updateOne(
//         { _id: new ObjectId(orderId) },
//         {
//           $set: {
//             chargingCompleted: true,
//             chargingCompletedAt: new Date(),
//             status: 'completed',
//             finalAmount: parseFloat(amountPaid) || 0,
//             updatedAt: new Date()
//           }
//         }
//       );

//       await chargers.updateOne(
//         { chargerId: order.charger.chargerId },
//         {
//           $set: { reserved: false, lastUsed: new Date() },
//           $unset: { reservedAt: "" }
//         }
//       );

//       res.status(200).json({ message: "Charging session saved", id: result.insertedId });
//     } catch (err) {
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   app.post('/api/mollie-webhook', async (req, res) => {
//     try {
//       const { id: paymentId } = req.body;
//       if (!paymentId) return res.status(400).json({ error: "Missing payment ID" });

//       const MOLLIE_API_KEY = "test_Eh4TB42uTjCdCaDGQaCfJ6f6f995tk";

//       const response = await fetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
//         headers: {
//           "Authorization": `Bearer ${MOLLIE_API_KEY}`,
//           "Content-Type": "application/json"
//         }
//       });

//       const paymentData = await response.json();

//       if (paymentData?.metadata?.orderId) {
//         const orderId = paymentData.metadata.orderId;

//         const updateData = {
//           paid: paymentData.status === 'paid',
//           paymentStatus: paymentData.status,
//           paymentId,
//           paymentMethod: paymentData.method,
//           paidAt: paymentData.status === 'paid' ? new Date(paymentData.paidAt) : null,
//           status: paymentData.status === 'paid' ? 'paid' : 'pending',
//           updatedAt: new Date()
//         };

//         await orders.updateOne(
//           { _id: new ObjectId(orderId) },
//           { $set: updateData }
//         );
//       }

//       res.status(200).send("OK");
//     } catch (err) {
//       res.status(500).json({ error: "Webhook processing failed" });
//     }
//   });

//   app.get('/api/orders', async (req, res) => {
//     try {
//       const allOrders = await orders.find({}).sort({ createdAt: -1 }).toArray();
//       res.json(allOrders);
//     } catch (err) {
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   app.get('/api/charging-sessions', async (req, res) => {
//     try {
//       const sessions = await chargingStatus.find({}).sort({ createdAt: -1 }).toArray();
//       res.json(sessions);
//     } catch (err) {
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   app.get('/api/charging-sessions/:orderId', async (req, res) => {
//     try {
//       const orderId = req.params.orderId;
//       if (!ObjectId.isValid(orderId)) return res.status(400).json({ error: "Invalid ID" });

//       const sessions = await chargingStatus.find({ orderId: new ObjectId(orderId) }).toArray();
//       res.json(sessions);
//     } catch (err) {
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

// }).catch(err => {
//   console.error("❌ MongoDB connection failed:", err);
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`🚀 Server running on port ${PORT}`);
// });











const express = require('express');
const { ObjectId } = require('mongodb');
const connectDB = require('./config/mongo');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// Custom fetch function using Node.js built-in https module (no external dependencies)
function customFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => Promise.resolve(JSON.parse(data)),
          text: () => Promise.resolve(data)
        });
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

connectDB().then((db) => {
  const chargers = db.collection('chargers');
  const orders = db.collection('orders');
  const chargingStatus = db.collection('chargingStatus');

  console.log("✅ Connected to MongoDB collections");

  app.get('/', (req, res) => res.send('🚀 EV Charging Backend Running!'));

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

  app.post('/api/save-order', async (req, res) => {
    try {
      const { charger, firstName, lastName, email, phone, timestamp } = req.body;

      if (!charger?.chargerId || !firstName || !lastName || !email || !phone) {
        return res.status(400).json({ error: "Missing required information" });
      }

      const chargerDoc = await chargers.findOne({ chargerId: charger.chargerId });
      if (!chargerDoc || chargerDoc.reserved) {
        return res.status(400).json({ error: "Charger not available" });
      }

      await chargers.updateOne(
        { chargerId: charger.chargerId },
        { $set: { reserved: true, reservedAt: new Date() } }
      );

      const orderData = {
        charger,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        timestamp: timestamp || new Date().toISOString(),
        paid: false,
        paymentStatus: 'pending',
        chargingStarted: false,
        chargingCompleted: false,
        createdAt: new Date(),
        status: 'pending'
      };

      const result = await orders.insertOne(orderData);
      console.log(`✅ Order saved with ID: ${result.insertedId}, Status: pending`);
      res.status(200).json({ message: "Order saved", id: result.insertedId });
    } catch (err) {
      console.error('❌ Error saving order:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get('/api/get-order/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        console.error(`❌ Invalid order ID format: ${id}`);
        return res.status(400).json({ error: "Invalid ID" });
      }

      const order = await orders.findOne({ _id: new ObjectId(id) });
      if (!order) {
        console.error(`❌ Order not found: ${id}`);
        return res.status(404).json({ error: "Order not found" });
      }

      // Enhanced logging for debugging payment status issues
      console.log(`✅ Order retrieved: ${id}`, {
        status: order.status,
        paid: order.paid,
        paymentStatus: order.paymentStatus,
        molliePaymentId: order.molliePaymentId,
        paidAt: order.paidAt
      });

      res.json(order);
    } catch (err) {
      console.error('❌ Error fetching order:', err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Payment creation notification from frontend
  app.post('/api/payment-created', async (req, res) => {
    try {
      const { orderId, molliePaymentId, paymentStatus, amount, customerInfo, timestamp } = req.body;
      
      if (!orderId || !ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      const updateData = {
        molliePaymentId,
        paymentStatus: paymentStatus || 'open',
        paymentAmount: amount,
        paymentCreatedAt: new Date(timestamp),
        updatedAt: new Date()
      };

      await orders.updateOne({ _id: new ObjectId(orderId) }, { $set: updateData });
      console.log(`✅ Payment creation recorded for order: ${orderId}, Mollie ID: ${molliePaymentId}`);
      
      res.json({ message: "Payment creation recorded" });
    } catch (err) {
      console.error('❌ Error recording payment creation:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Generic payment webhook (for manual updates)
  app.post('/api/payment-webhook', async (req, res) => {
    try {
      const { orderId, paymentStatus, paymentId, paymentMethod } = req.body;
      if (!orderId || !ObjectId.isValid(orderId)) return res.status(400).json({ error: "Invalid order ID" });

      const updateData = {
        paid: paymentStatus === 'paid',
        paymentStatus,
        paymentId,
        paymentMethod,
        paidAt: paymentStatus === 'paid' ? new Date() : null,
        status: paymentStatus === 'paid' ? 'paid' : (paymentStatus === 'failed' || paymentStatus === 'cancelled' ? paymentStatus : 'pending'),
        updatedAt: new Date()
      };

      await orders.updateOne({ _id: new ObjectId(orderId) }, { $set: updateData });
      console.log(`✅ Payment webhook updated order: ${orderId}, Status: ${paymentStatus}`);
      res.json({ message: "Webhook updated" });
    } catch (err) {
      console.error('❌ Error processing payment webhook:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Mollie webhook - handles actual payment status updates from Mollie
  app.post('/api/mollie-webhook', async (req, res) => {
    try {
      const { id: paymentId } = req.body;
      
      if (!paymentId) {
        console.error("❌ Mollie webhook: Missing payment ID");
        return res.status(400).json({ error: "Missing payment ID" });
      }

      console.log(`📥 Mollie webhook received for payment: ${paymentId}`);

      const MOLLIE_API_KEY = "test_Eh4TB42uTjCdCaDGQaCfJ6f6f995tk";

      // Fetch payment details from Mollie using custom fetch
      const response = await customFetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
        headers: {
          "Authorization": `Bearer ${MOLLIE_API_KEY}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        console.error(`❌ Failed to fetch payment from Mollie: ${response.status}`);
        return res.status(400).json({ error: "Failed to fetch payment data" });
      }

      const paymentData = await response.json();
      console.log(`📋 Mollie payment data:`, {
        id: paymentData.id,
        status: paymentData.status,
        method: paymentData.method,
        amount: paymentData.amount,
        metadata: paymentData.metadata
      });

      // Update order with payment information
      if (paymentData?.metadata?.orderId) {
        const orderId = paymentData.metadata.orderId;

        const updateData = {
          paid: paymentData.status === 'paid',
          paymentStatus: paymentData.status,
          paymentId,
          paymentMethod: paymentData.method,
          paidAt: paymentData.status === 'paid' && paymentData.paidAt ? new Date(paymentData.paidAt) : null,
          status: paymentData.status === 'paid' ? 'paid' : 
                 (paymentData.status === 'failed' || paymentData.status === 'cancelled' || paymentData.status === 'expired') ? paymentData.status : 'pending',
          mollieWebhookAt: new Date(),
          updatedAt: new Date()
        };

        const result = await orders.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: updateData }
        );

        if (result.matchedCount > 0) {
          console.log(`✅ Order ${orderId} updated with payment status: ${paymentData.status}`, {
            paid: updateData.paid,
            paymentStatus: updateData.paymentStatus,
            status: updateData.status
          });
        } else {
          console.error(`❌ Order ${orderId} not found for payment update`);
        }
      } else {
        console.error("❌ No order ID found in payment metadata");
      }

      res.status(200).send("OK");
    } catch (err) {
      console.error("❌ Mollie webhook processing failed:", err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // NEW: Direct Mollie payment verification endpoint
  app.get('/api/verify-mollie-payment/:paymentId', async (req, res) => {
    try {
      const { paymentId } = req.params;
      
      console.log("🔍 Direct Mollie verification requested for payment:", paymentId);
      
      if (!paymentId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Payment ID is required' 
        });
      }
      
      const MOLLIE_API_KEY = "test_Eh4TB42uTjCdCaDGQaCfJ6f6f995tk";
      
      // Verify payment directly with Mollie API
      const mollieResponse = await customFetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${MOLLIE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!mollieResponse.ok) {
        console.error("❌ Mollie API error:", mollieResponse.status);
        const errorText = await mollieResponse.text();
        return res.status(mollieResponse.status).json({ 
          success: false, 
          error: `Mollie API error: ${errorText}` 
        });
      }
      
      const paymentData = await mollieResponse.json();
      console.log("📋 Mollie payment data:", {
        id: paymentData.id,
        status: paymentData.status,
        amount: paymentData.amount
      });
      
      const isPaid = paymentData.status === 'paid';
      
      // If payment is confirmed as paid, update our database
      if (isPaid && paymentData.metadata && paymentData.metadata.orderId) {
        try {
          console.log("✅ Payment confirmed paid, updating database...");
          
          const updateData = {
            paid: true,
            paymentStatus: 'paid',
            status: 'paid',
            paidAt: paymentData.paidAt ? new Date(paymentData.paidAt) : new Date(),
            mollieDirectVerifiedAt: new Date(),
            updatedAt: new Date()
          };
          
          const updateResult = await orders.updateOne(
            { _id: new ObjectId(paymentData.metadata.orderId) },
            { $set: updateData }
          );
          
          console.log("📋 Database update result:", {
            matchedCount: updateResult.matchedCount,
            modifiedCount: updateResult.modifiedCount
          });
          
        } catch (dbError) {
          console.error("❌ Failed to update database:", dbError);
          // Don't fail the verification if DB update fails
        }
      }
      
      res.json({
        success: true,
        payment: {
          id: paymentData.id,
          status: paymentData.status,
          amount: paymentData.amount,
          description: paymentData.description,
          createdAt: paymentData.createdAt,
          paidAt: paymentData.paidAt
        },
        isPaid: isPaid,
        status: paymentData.status
      });
      
    } catch (error) {
      console.error("❌ Direct Mollie verification error:", error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error during payment verification' 
      });
    }
  });

  // NEW: Manual payment status update endpoint (for testing/debugging)
  app.post('/api/update-payment-status/:orderId', async (req, res) => {
    try {
      const orderId = req.params.orderId;
      const { paymentStatus, paid } = req.body;
      
      if (!ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }
      
      const updateData = {
        paid: paid === true || paymentStatus === 'paid',
        paymentStatus: paymentStatus || 'paid',
        status: paymentStatus === 'paid' ? 'paid' : paymentStatus,
        paidAt: (paid === true || paymentStatus === 'paid') ? new Date() : null,
        manuallyUpdatedAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await orders.updateOne(
        { _id: new ObjectId(orderId) },
        { $set: updateData }
      );
      
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      console.log(`✅ Manual payment status update for order: ${orderId}`, updateData);
      res.json({ message: "Payment status updated", updateData });
      
    } catch (error) {
      console.error("❌ Error updating payment status:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Start charging - only allow if payment is confirmed
  app.post('/api/start-charging/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid order ID" });

      // Check if order exists and payment is confirmed
      const order = await orders.findOne({ _id: new ObjectId(id) });
      if (!order) {
        console.error(`❌ Order not found for charging start: ${id}`);
        return res.status(404).json({ error: "Order not found" });
      }

      // ENHANCED PAYMENT CHECK: More flexible status checking
      const isPaymentConfirmed = order.paid === true || 
                                order.paymentStatus === 'paid' || 
                                order.status === 'paid';

      console.log(`🔍 Charging start request for order: ${id}`, {
        paid: order.paid,
        paymentStatus: order.paymentStatus,
        status: order.status,
        isPaymentConfirmed: isPaymentConfirmed
      });

      if (!isPaymentConfirmed) {
        console.error(`❌ Charging start denied - Payment not confirmed. Order: ${id}`, {
          status: order.status,
          paid: order.paid,
          paymentStatus: order.paymentStatus
        });
        return res.status(400).json({ 
          error: "Payment not confirmed", 
          currentStatus: order.paymentStatus || order.status,
          paid: order.paid,
          debug: {
            paid: order.paid,
            paymentStatus: order.paymentStatus,
            status: order.status
          }
        });
      }

      // Update order to mark charging as started
      await orders.updateOne(
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

      console.log(`✅ Charging started for order: ${id}`);
      res.json({ message: "Charging started", orderId: id });
    } catch (err) {
      console.error('❌ Error starting charging:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post('/api/charging-status', async (req, res) => {
    try {
      const { orderId, startTime, endTime, durationSeconds, amountPaid, powerKW } = req.body;
      if (!orderId || !ObjectId.isValid(orderId)) return res.status(400).json({ error: "Invalid data" });

      const order = await orders.findOne({ _id: new ObjectId(orderId) });
      if (!order) return res.status(404).json({ error: "Order not found" });

      const chargingData = {
        orderId: new ObjectId(orderId),
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : new Date(),
        durationSeconds,
        amountPaid: parseFloat(amountPaid) || 0,
        powerKW: parseFloat(powerKW) || 0,
        userPhone: order.phone,
        userEmail: order.email,
        userName: `${order.firstName} ${order.lastName}`,
        charger: order.charger,
        createdAt: new Date()
      };

      const result = await chargingStatus.insertOne(chargingData);

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

      // Release charger
      if (order.charger?.chargerId) {
        await chargers.updateOne(
          { chargerId: order.charger.chargerId },
          {
            $set: { reserved: false, lastUsed: new Date() },
            $unset: { reservedAt: "" }
          }
        );
        console.log(`✅ Charger ${order.charger.chargerId} released`);
      }

      console.log(`✅ Charging session completed for order: ${orderId}`);
      res.status(200).json({ message: "Charging session saved", id: result.insertedId });
    } catch (err) {
      console.error('❌ Error saving charging session:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Admin endpoints
  app.get('/api/orders', async (req, res) => {
    try {
      const allOrders = await orders.find({}).sort({ createdAt: -1 }).toArray();
      res.json(allOrders);
    } catch (err) {
      console.error('❌ Error fetching orders:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get('/api/charging-sessions', async (req, res) => {
    try {
      const sessions = await chargingStatus.find({}).sort({ createdAt: -1 }).toArray();
      res.json(sessions);
    } catch (err) {
      console.error('❌ Error fetching charging sessions:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get('/api/charging-sessions/:orderId', async (req, res) => {
    try {
      const orderId = req.params.orderId;
      if (!ObjectId.isValid(orderId)) return res.status(400).json({ error: "Invalid ID" });

      const sessions = await chargingStatus.find({ orderId: new ObjectId(orderId) }).toArray();
      res.json(sessions);
    } catch (err) {
      console.error('❌ Error fetching charging sessions for order:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

}).catch(err => {
  console.error("❌ MongoDB connection failed:", err);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
