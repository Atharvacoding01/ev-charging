
// const express = require('express');
// const { ObjectId } = require('mongodb');
// const connectDB = require('./config/mongo');
// const cors = require('cors');
// const https = require('https');

// const app = express();
// app.use(cors());
// app.use(express.json());

// // Custom fetch function using Node.js built-in https module (no external dependencies)
// function customFetch(url, options = {}) {
//   return new Promise((resolve, reject) => {
//     const urlObj = new URL(url);
//     const requestOptions = {
//       hostname: urlObj.hostname,
//       port: urlObj.port || 443,
//       path: urlObj.pathname + urlObj.search,
//       method: options.method || 'GET',
//       headers: options.headers || {}
//     };

//     const req = https.request(requestOptions, (res) => {
//       let data = '';
//       res.on('data', (chunk) => data += chunk);
//       res.on('end', () => {
//         resolve({
//           ok: res.statusCode >= 200 && res.statusCode < 300,
//           status: res.statusCode,
//           json: () => Promise.resolve(JSON.parse(data)),
//           text: () => Promise.resolve(data)
//         });
//       });
//     });

//     req.on('error', reject);
    
//     if (options.body) {
//       req.write(options.body);
//     }
    
//     req.end();
//   });
// }

// connectDB().then((db) => {
//   const chargers = db.collection('chargers');
//   const orders = db.collection('orders');
//   const chargingStatus = db.collection('chargingStatus');
//   const tempReservations = db.collection('tempReservations');

//   console.log("✅ Connected to MongoDB collections");

//   // Clean up expired temporary reservations on startup
//   cleanupExpiredTempReservations();
  
//   // Run cleanup every 5 minutes
//   setInterval(cleanupExpiredTempReservations, 5 * 60 * 1000);

//   async function cleanupExpiredTempReservations() {
//     try {
//       const result = await tempReservations.deleteMany({
//         expiresAt: { $lt: new Date() }
//       });
//       if (result.deletedCount > 0) {
//         console.log(`🧹 Cleaned up ${result.deletedCount} expired temporary reservations`);
//       }
//     } catch (error) {
//       console.error('❌ Error cleaning up expired reservations:', error);
//     }
//   }

//   app.get('/', (req, res) => res.send('🚀 EV Charging Backend Running!'));

//   app.get('/api/chargers', async (req, res) => {
//     try {
//       console.log("📤 GET /api/chargers - Fetching available chargers");
      
//       // Get all chargers that are not permanently reserved
//       const allChargers = await chargers.find({
//         $or: [
//           { reserved: { $exists: false } },
//           { reserved: false }
//         ]
//       }).toArray();

//       // Get active temporary reservations
//       const activeReservations = await tempReservations.find({
//         expiresAt: { $gt: new Date() }
//       }).toArray();

//       const tempReservedChargerIds = new Set(
//         activeReservations.map(res => res.chargerId)
//       );

//       // Filter out temporarily reserved chargers
//       const availableChargers = allChargers.filter(charger => 
//         !tempReservedChargerIds.has(charger.chargerId)
//       );

//       console.log(`✅ Found ${availableChargers.length} available chargers (${allChargers.length} total, ${tempReservedChargerIds.size} temp reserved)`);
//       res.json(availableChargers);
//     } catch (err) {
//       console.error('❌ Error fetching chargers:', err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   // NEW: Temporary reservation endpoint
//   app.post('/api/temp-reserve-charger', async (req, res) => {
//     try {
//       const { chargerId, expiryMinutes = 10 } = req.body;

//       if (!chargerId) {
//         return res.status(400).json({ error: "Charger ID is required" });
//       }

//       // Check if charger exists and is available
//       const charger = await chargers.findOne({ chargerId });
//       if (!charger) {
//         return res.status(404).json({ error: "Charger not found" });
//       }

//       if (charger.reserved) {
//         return res.status(400).json({ error: "Charger is permanently reserved" });
//       }

//       // Check if already temporarily reserved
//       const existingReservation = await tempReservations.findOne({
//         chargerId,
//         expiresAt: { $gt: new Date() }
//       });

//       if (existingReservation) {
//         return res.status(400).json({ error: "Charger is temporarily reserved by another user" });
//       }

//       // Create temporary reservation
//       const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
//       await tempReservations.insertOne({
//         chargerId,
//         createdAt: new Date(),
//         expiresAt,
//         expiryMinutes
//       });

//       console.log(`✅ Charger ${chargerId} temporarily reserved for ${expiryMinutes} minutes`);
//       res.json({ 
//         message: "Charger temporarily reserved", 
//         chargerId, 
//         expiresAt 
//       });

//     } catch (error) {
//       console.error('❌ Error creating temporary reservation:', error);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   // NEW: Release temporary reservation endpoint
//   app.post('/api/release-temp-reservation', async (req, res) => {
//     try {
//       const { chargerId } = req.body;

//       if (!chargerId) {
//         return res.status(400).json({ error: "Charger ID is required" });
//       }

//       const result = await tempReservations.deleteMany({ chargerId });
      
//       console.log(`✅ Released temporary reservation for charger ${chargerId} (${result.deletedCount} records removed)`);
//       res.json({ 
//         message: "Temporary reservation released", 
//         chargerId,
//         removedCount: result.deletedCount
//       });

//     } catch (error) {
//       console.error('❌ Error releasing temporary reservation:', error);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   // NEW: Permanent reservation endpoint (only after payment success)
//   app.post('/api/reserve-charger', async (req, res) => {
//     try {
//       const { chargerId, orderId, customerEmail, customerName } = req.body;

//       if (!chargerId || !orderId) {
//         return res.status(400).json({ error: "Charger ID and Order ID are required" });
//       }

//       // Check if charger is available
//       const charger = await chargers.findOne({ chargerId });
//       if (!charger) {
//         return res.status(404).json({ error: "Charger not found" });
//       }

//       if (charger.reserved) {
//         return res.status(400).json({ error: "Charger is already permanently reserved" });
//       }

//       // Permanently reserve the charger
//       await chargers.updateOne(
//         { chargerId },
//         { 
//           $set: { 
//             reserved: true, 
//             reservedAt: new Date(),
//             reservedBy: orderId,
//             customerEmail,
//             customerName
//           } 
//         }
//       );

//       // Remove any temporary reservations for this charger
//       await tempReservations.deleteMany({ chargerId });

//       console.log(`✅ Charger ${chargerId} permanently reserved for order ${orderId}`);
//       res.json({ 
//         message: "Charger permanently reserved", 
//         chargerId, 
//         orderId 
//       });

//     } catch (error) {
//       console.error('❌ Error creating permanent reservation:', error);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   // NEW: Release charger by order ID
//   app.post('/api/release-charger-by-order', async (req, res) => {
//     try {
//       const { orderId } = req.body;

//       if (!orderId) {
//         return res.status(400).json({ error: "Order ID is required" });
//       }

//       // Release permanent reservation
//       const chargerResult = await chargers.updateMany(
//         { reservedBy: orderId },
//         { 
//           $set: { reserved: false },
//           $unset: { reservedAt: "", reservedBy: "", customerEmail: "", customerName: "" }
//         }
//       );

//       // Also release any temporary reservations (cleanup)
//       const tempResult = await tempReservations.deleteMany({});

//       console.log(`✅ Released reservations for order ${orderId} (${chargerResult.modifiedCount} permanent, ${tempResult.deletedCount} temporary)`);
//       res.json({ 
//         message: "Reservations released", 
//         orderId,
//         permanentReleased: chargerResult.modifiedCount,
//         temporaryReleased: tempResult.deletedCount
//       });

//     } catch (error) {
//       console.error('❌ Error releasing charger by order:', error);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   // NEW: Initiate refund endpoint
//   app.post('/api/initiate-refund', async (req, res) => {
//     try {
//       const { orderId } = req.body;

//       if (!orderId || !ObjectId.isValid(orderId)) {
//         return res.status(400).json({ error: "Valid Order ID is required" });
//       }

//       // Get order details
//       const order = await orders.findOne({ _id: new ObjectId(orderId) });
//       if (!order) {
//         return res.status(404).json({ error: "Order not found" });
//       }

//       // Mark order for refund
//       await orders.updateOne(
//         { _id: new ObjectId(orderId) },
//         { 
//           $set: { 
//             refundRequested: true,
//             refundRequestedAt: new Date(),
//             status: 'refund_requested',
//             updatedAt: new Date()
//           } 
//         }
//       );

//       // Here you would integrate with Mollie's refund API
//       // For now, we'll just log it
//       console.log(`✅ Refund initiated for order ${orderId}, payment ID: ${order.molliePaymentId || order.paymentId}`);
      
//       // TODO: Integrate with Mollie refund API
//       // const refundResponse = await customFetch(`https://api.mollie.com/v2/payments/${order.molliePaymentId}/refunds`, {
//       //   method: 'POST',
//       //   headers: {
//       //     'Authorization': `Bearer ${MOLLIE_API_KEY}`,
//       //     'Content-Type': 'application/json'
//       //   },
//       //   body: JSON.stringify({
//       //     amount: {
//       //       currency: 'EUR',
//       //       value: order.paymentAmount
//       //     }
//       //   })
//       // });

//       res.json({ 
//         message: "Refund initiated", 
//         orderId,
//         paymentId: order.molliePaymentId || order.paymentId
//       });

//     } catch (error) {
//       console.error('❌ Error initiating refund:', error);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   // UPDATED: Modified save-order to NOT permanently reserve charger
//   app.post('/api/save-order', async (req, res) => {
//     try {
//       const { charger, firstName, lastName, email, phone, timestamp } = req.body;

//       if (!charger?.chargerId || !firstName || !lastName || !email || !phone) {
//         return res.status(400).json({ error: "Missing required information" });
//       }

//       const chargerDoc = await chargers.findOne({ chargerId: charger.chargerId });
//       if (!chargerDoc) {
//         return res.status(400).json({ error: "Charger not found" });
//       }

//       if (chargerDoc.reserved) {
//         return res.status(400).json({ error: "Charger is permanently reserved" });
//       }

//       // Check if temporarily reserved by someone else
//       const tempReservation = await tempReservations.findOne({
//         chargerId: charger.chargerId,
//         expiresAt: { $gt: new Date() }
//       });

//       if (tempReservation) {
//         return res.status(400).json({ error: "Charger is temporarily reserved by another user" });
//       }

//       // DON'T reserve the charger permanently here - only after payment success
//       const orderData = {
//         charger,
//         firstName: firstName.trim(),
//         lastName: lastName.trim(),
//         email: email.trim(),
//         phone: phone.trim(),
//         timestamp: timestamp || new Date().toISOString(),
//         paid: false,
//         paymentStatus: 'pending',
//         chargingStarted: false,
//         chargingCompleted: false,
//         createdAt: new Date(),
//         status: 'pending'
//       };

//       const result = await orders.insertOne(orderData);
//       console.log(`✅ Order saved with ID: ${result.insertedId}, Status: pending (charger NOT reserved yet)`);
//       res.status(200).json({ message: "Order saved", id: result.insertedId });
//     } catch (err) {
//       console.error('❌ Error saving order:', err);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   app.get('/api/get-order/:id', async (req, res) => {
//     try {
//       const id = req.params.id;
//       if (!ObjectId.isValid(id)) {
//         console.error(`❌ Invalid order ID format: ${id}`);
//         return res.status(400).json({ error: "Invalid ID" });
//       }

//       const order = await orders.findOne({ _id: new ObjectId(id) });
//       if (!order) {
//         console.error(`❌ Order not found: ${id}`);
//         return res.status(404).json({ error: "Order not found" });
//       }

//       // Enhanced logging for debugging payment status issues
//       console.log(`✅ Order retrieved: ${id}`, {
//         status: order.status,
//         paid: order.paid,
//         paymentStatus: order.paymentStatus,
//         molliePaymentId: order.molliePaymentId,
//         paidAt: order.paidAt
//       });

//       res.json(order);
//     } catch (err) {
//       console.error('❌ Error fetching order:', err);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   // Payment creation notification from frontend
//   app.post('/api/payment-created', async (req, res) => {
//     try {
//       const { orderId, molliePaymentId, paymentStatus, amount, customerInfo, timestamp } = req.body;
      
//       if (!orderId || !ObjectId.isValid(orderId)) {
//         return res.status(400).json({ error: "Invalid order ID" });
//       }

//       const updateData = {
//         molliePaymentId,
//         paymentStatus: paymentStatus || 'open',
//         paymentAmount: amount,
//         paymentCreatedAt: new Date(timestamp),
//         updatedAt: new Date()
//       };

//       await orders.updateOne({ _id: new ObjectId(orderId) }, { $set: updateData });
//       console.log(`✅ Payment creation recorded for order: ${orderId}, Mollie ID: ${molliePaymentId}`);
      
//       res.json({ message: "Payment creation recorded" });
//     } catch (err) {
//       console.error('❌ Error recording payment creation:', err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   // Generic payment webhook (for manual updates)
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
//         status: paymentStatus === 'paid' ? 'paid' : (paymentStatus === 'failed' || paymentStatus === 'cancelled' ? paymentStatus : 'pending'),
//         updatedAt: new Date()
//       };

//       await orders.updateOne({ _id: new ObjectId(orderId) }, { $set: updateData });
//       console.log(`✅ Payment webhook updated order: ${orderId}, Status: ${paymentStatus}`);
//       res.json({ message: "Webhook updated" });
//     } catch (err) {
//       console.error('❌ Error processing payment webhook:', err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   // UPDATED: Mollie webhook - now handles charger reservation on payment success
//   app.post('/api/mollie-webhook', async (req, res) => {
//     try {
//       const { id: paymentId } = req.body;
      
//       if (!paymentId) {
//         console.error("❌ Mollie webhook: Missing payment ID");
//         return res.status(400).json({ error: "Missing payment ID" });
//       }

//       console.log(`📥 Mollie webhook received for payment: ${paymentId}`);

//       const MOLLIE_API_KEY = "test_Eh4TB42uTjCdCaDGQaCfJ6f6f995tk";

//       // Fetch payment details from Mollie using custom fetch
//       const response = await customFetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
//         headers: {
//           "Authorization": `Bearer ${MOLLIE_API_KEY}`,
//           "Content-Type": "application/json"
//         }
//       });

//       if (!response.ok) {
//         console.error(`❌ Failed to fetch payment from Mollie: ${response.status}`);
//         return res.status(400).json({ error: "Failed to fetch payment data" });
//       }

//       const paymentData = await response.json();
//       console.log(`📋 Mollie payment data:`, {
//         id: paymentData.id,
//         status: paymentData.status,
//         method: paymentData.method,
//         amount: paymentData.amount,
//         metadata: paymentData.metadata
//       });

//       // Update order with payment information
//       if (paymentData?.metadata?.orderId) {
//         const orderId = paymentData.metadata.orderId;

//         const updateData = {
//           paid: paymentData.status === 'paid',
//           paymentStatus: paymentData.status,
//           paymentId,
//           paymentMethod: paymentData.method,
//           paidAt: paymentData.status === 'paid' && paymentData.paidAt ? new Date(paymentData.paidAt) : null,
//           status: paymentData.status === 'paid' ? 'paid' : 
//                  (paymentData.status === 'failed' || paymentData.status === 'cancelled' || paymentData.status === 'expired') ? paymentData.status : 'pending',
//           mollieWebhookAt: new Date(),
//           updatedAt: new Date()
//         };

//         const result = await orders.updateOne(
//           { _id: new ObjectId(orderId) },
//           { $set: updateData }
//         );

//         if (result.matchedCount > 0) {
//           console.log(`✅ Order ${orderId} updated with payment status: ${paymentData.status}`, {
//             paid: updateData.paid,
//             paymentStatus: updateData.paymentStatus,
//             status: updateData.status
//           });

//           // NEW: If payment successful, permanently reserve the charger
//           if (paymentData.status === 'paid') {
//             try {
//               const order = await orders.findOne({ _id: new ObjectId(orderId) });
//               if (order && order.charger && order.charger.chargerId) {
//                 await chargers.updateOne(
//                   { chargerId: order.charger.chargerId },
//                   { 
//                     $set: { 
//                       reserved: true, 
//                       reservedAt: new Date(),
//                       reservedBy: orderId,
//                       customerEmail: order.email,
//                       customerName: `${order.firstName} ${order.lastName}`
//                     } 
//                   }
//                 );

//                 // Remove temporary reservation
//                 await tempReservations.deleteMany({ chargerId: order.charger.chargerId });

//                 console.log(`✅ Charger ${order.charger.chargerId} permanently reserved after payment success`);
//               }
//             } catch (reservationError) {
//               console.error("❌ Failed to reserve charger after payment success:", reservationError);
//             }
//           }

//           // NEW: If payment failed, release temporary reservations
//           if (paymentData.status === 'failed' || paymentData.status === 'cancelled' || paymentData.status === 'expired') {
//             try {
//               const order = await orders.findOne({ _id: new ObjectId(orderId) });
//               if (order && order.charger && order.charger.chargerId) {
//                 await tempReservations.deleteMany({ chargerId: order.charger.chargerId });
//                 console.log(`✅ Temporary reservation released for charger ${order.charger.chargerId} due to payment failure`);
//               }
//             } catch (releaseError) {
//               console.error("❌ Failed to release temporary reservation:", releaseError);
//             }
//           }

//         } else {
//           console.error(`❌ Order ${orderId} not found for payment update`);
//         }
//       } else {
//         console.error("❌ No order ID found in payment metadata");
//       }

//       res.status(200).send("OK");
//     } catch (err) {
//       console.error("❌ Mollie webhook processing failed:", err);
//       res.status(500).json({ error: "Webhook processing failed" });
//     }
//   });

//   // Direct Mollie payment verification endpoint
//   app.get('/api/verify-mollie-payment/:paymentId', async (req, res) => {
//     try {
//       const { paymentId } = req.params;
      
//       console.log("🔍 Direct Mollie verification requested for payment:", paymentId);
      
//       if (!paymentId) {
//         return res.status(400).json({ 
//           success: false, 
//           error: 'Payment ID is required' 
//         });
//       }
      
//       const MOLLIE_API_KEY = "test_Eh4TB42uTjCdCaDGQaCfJ6f6f995tk";
      
//       // Verify payment directly with Mollie API
//       const mollieResponse = await customFetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
//         method: 'GET',
//         headers: {
//           'Authorization': `Bearer ${MOLLIE_API_KEY}`,
//           'Content-Type': 'application/json'
//         }
//       });
      
//       if (!mollieResponse.ok) {
//         console.error("❌ Mollie API error:", mollieResponse.status);
//         const errorText = await mollieResponse.text();
//         return res.status(mollieResponse.status).json({ 
//           success: false, 
//           error: `Mollie API error: ${errorText}` 
//         });
//       }
      
//       const paymentData = await mollieResponse.json();
//       console.log("📋 Mollie payment data:", {
//         id: paymentData.id,
//         status: paymentData.status,
//         amount: paymentData.amount
//       });
      
//       const isPaid = paymentData.status === 'paid';
      
//       // If payment is confirmed as paid, update our database AND reserve charger
//       if (isPaid && paymentData.metadata && paymentData.metadata.orderId) {
//         try {
//           console.log("✅ Payment confirmed paid, updating database and reserving charger...");
          
//           const updateData = {
//             paid: true,
//             paymentStatus: 'paid',
//             status: 'paid',
//             paidAt: paymentData.paidAt ? new Date(paymentData.paidAt) : new Date(),
//             mollieDirectVerifiedAt: new Date(),
//             updatedAt: new Date()
//           };
          
//           const updateResult = await orders.updateOne(
//             { _id: new ObjectId(paymentData.metadata.orderId) },
//             { $set: updateData }
//           );

//           // Reserve charger permanently
//           if (updateResult.matchedCount > 0) {
//             const order = await orders.findOne({ _id: new ObjectId(paymentData.metadata.orderId) });
//             if (order && order.charger && order.charger.chargerId) {
//               await chargers.updateOne(
//                 { chargerId: order.charger.chargerId },
//                 { 
//                   $set: { 
//                     reserved: true, 
//                     reservedAt: new Date(),
//                     reservedBy: paymentData.metadata.orderId,
//                     customerEmail: order.email,
//                     customerName: `${order.firstName} ${order.lastName}`
//                   } 
//                 }
//               );

//               // Remove temporary reservation
//               await tempReservations.deleteMany({ chargerId: order.charger.chargerId });

//               console.log(`✅ Charger ${order.charger.chargerId} permanently reserved after direct verification`);
//             }
//           }
          
//           console.log("📋 Database update result:", {
//             matchedCount: updateResult.matchedCount,
//             modifiedCount: updateResult.modifiedCount
//           });
          
//         } catch (dbError) {
//           console.error("❌ Failed to update database:", dbError);
//           // Don't fail the verification if DB update fails
//         }
//       }
      
//       res.json({
//         success: true,
//         payment: {
//           id: paymentData.id,
//           status: paymentData.status,
//           amount: paymentData.amount,
//           description: paymentData.description,
//           createdAt: paymentData.createdAt,
//           paidAt: paymentData.paidAt
//         },
//         isPaid: isPaid,
//         status: paymentData.status
//       });
      
//     } catch (error) {
//       console.error("❌ Direct Mollie verification error:", error);
//       res.status(500).json({ 
//         success: false, 
//         error: 'Internal server error during payment verification' 
//       });
//     }
//   });

//   // Manual payment status update endpoint (for testing/debugging)
//   app.post('/api/update-payment-status/:orderId', async (req, res) => {
//     try {
//       const orderId = req.params.orderId;
//       const { paymentStatus, paid } = req.body;
      
//       if (!ObjectId.isValid(orderId)) {
//         return res.status(400).json({ error: "Invalid order ID" });
//       }
      
//       const updateData = {
//         paid: paid === true || paymentStatus === 'paid',
//         paymentStatus: paymentStatus || 'paid',
//         status: paymentStatus === 'paid' ? 'paid' : paymentStatus,
//         paidAt: (paid === true || paymentStatus === 'paid') ? new Date() : null,
//         manuallyUpdatedAt: new Date(),
//         updatedAt: new Date()
//       };
      
//       const result = await orders.updateOne(
//         { _id: new ObjectId(orderId) },
//         { $set: updateData }
//       );
      
//       if (result.matchedCount === 0) {
//         return res.status(404).json({ error: "Order not found" });
//       }

//       // If manually marking as paid, reserve the charger
//       if (paid === true || paymentStatus === 'paid') {
//         try {
//           const order = await orders.findOne({ _id: new ObjectId(orderId) });
//           if (order && order.charger && order.charger.chargerId) {
//             await chargers.updateOne(
//               { chargerId: order.charger.chargerId },
//               { 
//                 $set: { 
//                   reserved: true, 
//                   reservedAt: new Date(),
//                   reservedBy: orderId,
//                   customerEmail: order.email,
//                   customerName: `${order.firstName} ${order.lastName}`
//                 } 
//               }
//             );

//             // Remove temporary reservation
//             await tempReservations.deleteMany({ chargerId: order.charger.chargerId });

//             console.log(`✅ Charger ${order.charger.chargerId} reserved after manual payment update`);
//           }
//         } catch (reservationError) {
//           console.error("❌ Failed to reserve charger after manual update:", reservationError);
//         }
//       }
      
//       console.log(`✅ Manual payment status update for order: ${orderId}`, updateData);
//       res.json({ message: "Payment status updated", updateData });
      
//     } catch (error) {
//       console.error("❌ Error updating payment status:", error);
//       res.status(500).json({ error: "Internal server error" });
//     }
//   });

//   // Start charging - only allow if payment is confirmed
//   app.post('/api/start-charging/:id', async (req, res) => {
//     try {
//       const id = req.params.id;
//       if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid order ID" });

//       // Check if order exists and payment is confirmed
//       const order = await orders.findOne({ _id: new ObjectId(id) });
//       if (!order) {
//         console.error(`❌ Order not found for charging start: ${id}`);
//         return res.status(404).json({ error: "Order not found" });
//       }

//       // ENHANCED PAYMENT CHECK: More flexible status checking
//       const isPaymentConfirmed = order.paid === true || 
//                                 order.paymentStatus === 'paid' || 
//                                 order.status === 'paid';

//       console.log(`🔍 Charging start request for order: ${id}`, {
//         paid: order.paid,
//         paymentStatus: order.paymentStatus,
//         status: order.status,
//         isPaymentConfirmed: isPaymentConfirmed
//       });

//       if (!isPaymentConfirmed) {
//         console.error(`❌ Charging start denied - Payment not confirmed. Order: ${id}`, {
//           status: order.status,
//           paid: order.paid,
//           paymentStatus: order.paymentStatus
//         });
//         return res.status(400).json({ 
//           error: "Payment not confirmed", 
//           currentStatus: order.paymentStatus || order.status,
//           paid: order.paid,
//           debug: {
//             paid: order.paid,
//             paymentStatus: order.paymentStatus,
//             status: order.status
//           }
//         });
//       }

//       // Update order to mark charging as started
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

//       console.log(`✅ Charging started for order: ${id}`);
//       res.json({ message: "Charging started", orderId: id });
//     } catch (err) {
//       console.error('❌ Error starting charging:', err);
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

//       // Release charger
//       if (order.charger?.chargerId) {
//         await chargers.updateOne(
//           { chargerId: order.charger.chargerId },
//           {
//             $set: { reserved: false, lastUsed: new Date() },
//             $unset: { reservedAt: "", reservedBy: "", customerEmail: "", customerName: "" }
//           }
//         );
//         console.log(`✅ Charger ${order.charger.chargerId} released`);
//       }

//       console.log(`✅ Charging session completed for order: ${orderId}`);
//       res.status(200).json({ message: "Charging session saved", id: result.insertedId });
//     } catch (err) {
//       console.error('❌ Error saving charging session:', err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   // Admin endpoints
//   app.get('/api/orders', async (req, res) => {
//     try {
//       const allOrders = await orders.find({}).sort({ createdAt: -1 }).toArray();
//       res.json(allOrders);
//     } catch (err) {
//       console.error('❌ Error fetching orders:', err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   app.get('/api/charging-sessions', async (req, res) => {
//     try {
//       const sessions = await chargingStatus.find({}).sort({ createdAt: -1 }).toArray();
//       res.json(sessions);
//     } catch (err) {
//       console.error('❌ Error fetching charging sessions:', err);
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
//       console.error('❌ Error fetching charging sessions for order:', err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   // NEW: Admin endpoint to view temporary reservations
//   app.get('/api/temp-reservations', async (req, res) => {
//     try {
//       const reservations = await tempReservations.find({}).sort({ createdAt: -1 }).toArray();
//       res.json(reservations);
//     } catch (err) {
//       console.error('❌ Error fetching temp reservations:', err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   // NEW: Admin endpoint to manually clean expired reservations
//   app.post('/api/cleanup-expired-reservations', async (req, res) => {
//     try {
//       await cleanupExpiredTempReservations();
//       res.json({ message: "Cleanup completed" });
//     } catch (err) {
//       console.error('❌ Error during manual cleanup:', err);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

// }).catch(err => {
//   console.error("❌ MongoDB connection failed:", err);
//   process.exit(1);
// });

// app.post('/api/create-owner-session', async (req, res) => {
//   try {
//     const { charger, isOwner, timestamp } = req.body;
    
//     const ownerSession = {
//       charger,
//       isOwner: true,
//       timestamp: timestamp || new Date().toISOString(),
//       sessionType: 'owner',
//       paid: true,
//       paymentStatus: 'owner_session',
//       createdAt: new Date(),
//       status: 'active'
//     };
    
//     const result = await db.collection('ownerSessions').insertOne(ownerSession);
//     console.log(`✅ Owner session created: ${result.insertedId}`);
    
//     res.json({ 
//       message: "Owner session created", 
//       sessionId: result.insertedId,
//       session: ownerSession 
//     });
//   } catch (error) {
//     console.error('❌ Error creating owner session:', error);
//     res.status(500).json({ error: "Failed to create owner session" });
//   }
// });

// app.get('/api/get-owner-session/:id', async (req, res) => {
//   try {
//     const id = req.params.id;
//     if (!ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid session ID" });
//     }
    
//     const ownerSession = await db.collection('ownerSessions').findOne({ _id: new ObjectId(id) });
//     if (!ownerSession) {
//       return res.status(404).json({ error: "Owner session not found" });
//     }
    
//     res.json(ownerSession);
//   } catch (error) {
//     console.error('❌ Error fetching owner session:', error);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });

// app.post('/api/start-owner-charging/:id', async (req, res) => {
//   try {
//     const id = req.params.id;
//     if (!ObjectId.isValid(id)) {
//       return res.status(400).json({ error: "Invalid session ID" });
//     }
    
//     const updateResult = await db.collection('ownerSessions').updateOne(
//       { _id: new ObjectId(id) },
//       {
//         $set: {
//           chargingStarted: true,
//           chargingStartedAt: new Date(),
//           status: 'charging',
//           updatedAt: new Date()
//         }
//       }
//     );
    
//     if (updateResult.matchedCount === 0) {
//       return res.status(404).json({ error: "Owner session not found" });
//     }
    
//     console.log(`✅ Owner charging started for session: ${id}`);
//     res.json({ message: "Owner charging started", sessionId: id });
//   } catch (error) {
//     console.error('❌ Error starting owner charging:', error);
//     res.status(500).json({ error: "Internal error" });
//   }
// });

// app.post('/api/owner-charging-status', async (req, res) => {
//   try {
//     const { sessionId, startTime, endTime, durationSeconds, amountPaid, powerKW, userInfo } = req.body;
    
//     const chargingData = {
//       sessionId: sessionId ? new ObjectId(sessionId) : null,
//       sessionType: 'owner',
//       startTime: new Date(startTime),
//       endTime: endTime ? new Date(endTime) : new Date(),
//       durationSeconds,
//       amountPaid: 0, // Owner sessions are free
//       powerKW: parseFloat(powerKW) || 0,
//       isOwner: true,
//       createdAt: new Date()
//     };
    
//     const result = await db.collection('chargingStatus').insertOne(chargingData);
    
//     // Update owner session
//     if (sessionId && ObjectId.isValid(sessionId)) {
//       await db.collection('ownerSessions').updateOne(
//         { _id: new ObjectId(sessionId) },
//         {
//           $set: {
//             chargingCompleted: true,
//             chargingCompletedAt: new Date(),
//             status: 'completed',
//             updatedAt: new Date()
//           }
//         }
//       );
//     }
    
//     console.log(`✅ Owner charging session completed: ${sessionId}`);
//     res.json({ message: "Owner charging session saved", id: result.insertedId });
//   } catch (error) {
//     console.error('❌ Error saving owner charging session:', error);
//     res.status(500).json({ error: "Internal error" });
//   }
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
const OCPPServer = require('./ocpp-server');

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

// After connecting to MongoDB, initialize OCPP server and all other services
connectDB().then((db) => {
  const chargers = db.collection('chargers');
  const orders = db.collection('orders');
  const chargingStatus = db.collection('chargingStatus');
  const tempReservations = db.collection('tempReservations');
  const ownerSessions = db.collection('ownerSessions');

  console.log("✅ Connected to MongoDB collections");

  // Initialize OCPP server
  const ocppServer = new OCPPServer(8080, db);

  // Clean up expired temporary reservations on startup
  cleanupExpiredTempReservations();
  
  // Run cleanup every 5 minutes
  setInterval(cleanupExpiredTempReservations, 5 * 60 * 1000);

  async function cleanupExpiredTempReservations() {
    try {
      const result = await tempReservations.deleteMany({
        expiresAt: { $lt: new Date() }
      });
      if (result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} expired temporary reservations`);
      }
    } catch (error) {
      console.error('❌ Error cleaning up expired reservations:', error);
    }
  }

  // Basic route
  app.get('/', (req, res) => res.send('🚀 EV Charging Backend Running!'));

  // ========== OCPP API ENDPOINTS ==========
  app.get('/api/ocpp/charge-points', (req, res) => {
    const connectedChargePoints = ocppServer.getConnectedChargePoints();
    res.json({ chargePoints: connectedChargePoints });
  });

  app.get('/api/ocpp/status/:chargePointId', (req, res) => {
    const { chargePointId } = req.params;
    const status = ocppServer.getChargePointStatus(chargePointId);
    
    if (!status) {
      return res.status(404).json({ error: 'Charge point not connected' });
    }
    
    res.json(status);
  });

  app.get('/api/ocpp/status', (req, res) => {
    const allStatuses = ocppServer.getAllChargePointStatuses();
    res.json(allStatuses);
  });

  // Remote control endpoints
  app.post('/api/ocpp/remote-start/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const { idTag, connectorId } = req.body;

      if (!idTag) {
        return res.status(400).json({ error: 'idTag is required' });
      }

      const messageId = await ocppServer.remoteStartTransaction(chargePointId, idTag, connectorId);
      
      if (!messageId) {
        return res.status(400).json({ error: 'Charge point not connected' });
      }

      res.json({ message: 'Remote start command sent', messageId });
    } catch (error) {
      console.error('❌ Remote start error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/ocpp/remote-stop/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const { transactionId } = req.body;

      if (!transactionId) {
        return res.status(400).json({ error: 'transactionId is required' });
      }

      const messageId = await ocppServer.remoteStopTransaction(chargePointId, transactionId);
      
      if (!messageId) {
        return res.status(400).json({ error: 'Charge point not connected' });
      }

      res.json({ message: 'Remote stop command sent', messageId });
    } catch (error) {
      console.error('❌ Remote stop error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/ocpp/unlock/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const { connectorId } = req.body;

      const messageId = await ocppServer.unlockConnector(chargePointId, connectorId);
      
      if (!messageId) {
        return res.status(400).json({ error: 'Charge point not connected' });
      }

      res.json({ message: 'Unlock command sent', messageId });
    } catch (error) {
      console.error('❌ Unlock error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/ocpp/reset/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const { type } = req.body;

      const messageId = await ocppServer.resetChargePoint(chargePointId, type);
      
      if (!messageId) {
        return res.status(400).json({ error: 'Charge point not connected' });
      }

      res.json({ message: 'Reset command sent', messageId });
    } catch (error) {
      console.error('❌ Reset error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get OCPP transactions
  app.get('/api/ocpp/transactions', async (req, res) => {
    try {
      const transactions = await db.collection('ocppTransactions')
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      
      res.json(transactions);
    } catch (error) {
      console.error('❌ Error fetching OCPP transactions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get meter values
  app.get('/api/ocpp/meter-values/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const meterValues = await db.collection('ocppMeterValues')
        .find({ chargerId: chargePointId })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray();
      
      res.json(meterValues);
    } catch (error) {
      console.error('❌ Error fetching meter values:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========== CHARGER MANAGEMENT ENDPOINTS ==========
  app.get('/api/chargers', async (req, res) => {
    try {
      console.log("📤 GET /api/chargers - Fetching available chargers");
      
      // Get all chargers that are not permanently reserved
      const allChargers = await chargers.find({
        $or: [
          { reserved: { $exists: false } },
          { reserved: false }
        ]
      }).toArray();

      // Get active temporary reservations
      const activeReservations = await tempReservations.find({
        expiresAt: { $gt: new Date() }
      }).toArray();

      const tempReservedChargerIds = new Set(
        activeReservations.map(res => res.chargerId)
      );

      // Filter out temporarily reserved chargers
      const availableChargers = allChargers.filter(charger => 
        !tempReservedChargerIds.has(charger.chargerId)
      );

      console.log(`✅ Found ${availableChargers.length} available chargers (${allChargers.length} total, ${tempReservedChargerIds.size} temp reserved)`);
      res.json(availableChargers);
    } catch (err) {
      console.error('❌ Error fetching chargers:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Temporary reservation endpoint
  app.post('/api/temp-reserve-charger', async (req, res) => {
    try {
      const { chargerId, expiryMinutes = 10 } = req.body;

      if (!chargerId) {
        return res.status(400).json({ error: "Charger ID is required" });
      }

      // Check if charger exists and is available
      const charger = await chargers.findOne({ chargerId });
      if (!charger) {
        return res.status(404).json({ error: "Charger not found" });
      }

      if (charger.reserved) {
        return res.status(400).json({ error: "Charger is permanently reserved" });
      }

      // Check if already temporarily reserved
      const existingReservation = await tempReservations.findOne({
        chargerId,
        expiresAt: { $gt: new Date() }
      });

      if (existingReservation) {
        return res.status(400).json({ error: "Charger is temporarily reserved by another user" });
      }

      // Create temporary reservation
      const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
      await tempReservations.insertOne({
        chargerId,
        createdAt: new Date(),
        expiresAt,
        expiryMinutes
      });

      console.log(`✅ Charger ${chargerId} temporarily reserved for ${expiryMinutes} minutes`);
      res.json({ 
        message: "Charger temporarily reserved", 
        chargerId, 
        expiresAt 
      });

    } catch (error) {
      console.error('❌ Error creating temporary reservation:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Release temporary reservation endpoint
  app.post('/api/release-temp-reservation', async (req, res) => {
    try {
      const { chargerId } = req.body;

      if (!chargerId) {
        return res.status(400).json({ error: "Charger ID is required" });
      }

      const result = await tempReservations.deleteMany({ chargerId });
      
      console.log(`✅ Released temporary reservation for charger ${chargerId} (${result.deletedCount} records removed)`);
      res.json({ 
        message: "Temporary reservation released", 
        chargerId,
        removedCount: result.deletedCount
      });

    } catch (error) {
      console.error('❌ Error releasing temporary reservation:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Permanent reservation endpoint (only after payment success)
  app.post('/api/reserve-charger', async (req, res) => {
    try {
      const { chargerId, orderId, customerEmail, customerName } = req.body;

      if (!chargerId || !orderId) {
        return res.status(400).json({ error: "Charger ID and Order ID are required" });
      }

      // Check if charger is available
      const charger = await chargers.findOne({ chargerId });
      if (!charger) {
        return res.status(404).json({ error: "Charger not found" });
      }

      if (charger.reserved) {
        return res.status(400).json({ error: "Charger is already permanently reserved" });
      }

      // Permanently reserve the charger
      await chargers.updateOne(
        { chargerId },
        { 
          $set: { 
            reserved: true, 
            reservedAt: new Date(),
            reservedBy: orderId,
            customerEmail,
            customerName
          } 
        }
      );

      // Remove any temporary reservations for this charger
      await tempReservations.deleteMany({ chargerId });

      console.log(`✅ Charger ${chargerId} permanently reserved for order ${orderId}`);
      res.json({ 
        message: "Charger permanently reserved", 
        chargerId, 
        orderId 
      });

    } catch (error) {
      console.error('❌ Error creating permanent reservation:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Release charger by order ID
  app.post('/api/release-charger-by-order', async (req, res) => {
    try {
      const { orderId } = req.body;

      if (!orderId) {
        return res.status(400).json({ error: "Order ID is required" });
      }

      // Release permanent reservation
      const chargerResult = await chargers.updateMany(
        { reservedBy: orderId },
        { 
          $set: { reserved: false },
          $unset: { reservedAt: "", reservedBy: "", customerEmail: "", customerName: "" }
        }
      );

      // Also release any temporary reservations (cleanup)
      const tempResult = await tempReservations.deleteMany({});

      console.log(`✅ Released reservations for order ${orderId} (${chargerResult.modifiedCount} permanent, ${tempResult.deletedCount} temporary)`);
      res.json({ 
        message: "Reservations released", 
        orderId,
        permanentReleased: chargerResult.modifiedCount,
        temporaryReleased: tempResult.deletedCount
      });

    } catch (error) {
      console.error('❌ Error releasing charger by order:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Initiate refund endpoint
  app.post('/api/initiate-refund', async (req, res) => {
    try {
      const { orderId } = req.body;

      if (!orderId || !ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: "Valid Order ID is required" });
      }

      // Get order details
      const order = await orders.findOne({ _id: new ObjectId(orderId) });
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Mark order for refund
      await orders.updateOne(
        { _id: new ObjectId(orderId) },
        { 
          $set: { 
            refundRequested: true,
            refundRequestedAt: new Date(),
            status: 'refund_requested',
            updatedAt: new Date()
          } 
        }
      );

      // Here you would integrate with Mollie's refund API
      // For now, we'll just log it
      console.log(`✅ Refund initiated for order ${orderId}, payment ID: ${order.molliePaymentId || order.paymentId}`);
      
      // TODO: Integrate with Mollie refund API
      // const refundResponse = await customFetch(`https://api.mollie.com/v2/payments/${order.molliePaymentId}/refunds`, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${MOLLIE_API_KEY}`,
      //     'Content-Type': 'application/json'
      //   },
      //   body: JSON.stringify({
      //     amount: {
      //       currency: 'EUR',
      //       value: order.paymentAmount
      //     }
      //   })
      // });

      res.json({ 
        message: "Refund initiated", 
        orderId,
        paymentId: order.molliePaymentId || order.paymentId
      });

    } catch (error) {
      console.error('❌ Error initiating refund:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== ORDER MANAGEMENT ENDPOINTS ==========
  // Save order (does NOT permanently reserve charger)
  app.post('/api/save-order', async (req, res) => {
    try {
      const { charger, firstName, lastName, email, phone, timestamp } = req.body;

      if (!charger?.chargerId || !firstName || !lastName || !email || !phone) {
        return res.status(400).json({ error: "Missing required information" });
      }

      const chargerDoc = await chargers.findOne({ chargerId: charger.chargerId });
      if (!chargerDoc) {
        return res.status(400).json({ error: "Charger not found" });
      }

      if (chargerDoc.reserved) {
        return res.status(400).json({ error: "Charger is permanently reserved" });
      }

      // Check if temporarily reserved by someone else
      const tempReservation = await tempReservations.findOne({
        chargerId: charger.chargerId,
        expiresAt: { $gt: new Date() }
      });

      if (tempReservation) {
        return res.status(400).json({ error: "Charger is temporarily reserved by another user" });
      }

      // DON'T reserve the charger permanently here - only after payment success
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
      console.log(`✅ Order saved with ID: ${result.insertedId}, Status: pending (charger NOT reserved yet)`);
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

  // ========== PAYMENT ENDPOINTS ==========
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

  // Mollie webhook - handles charger reservation on payment success
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

          // If payment successful, permanently reserve the charger
          if (paymentData.status === 'paid') {
            try {
              const order = await orders.findOne({ _id: new ObjectId(orderId) });
              if (order && order.charger && order.charger.chargerId) {
                await chargers.updateOne(
                  { chargerId: order.charger.chargerId },
                  { 
                    $set: { 
                      reserved: true, 
                      reservedAt: new Date(),
                      reservedBy: orderId,
                      customerEmail: order.email,
                      customerName: `${order.firstName} ${order.lastName}`
                    } 
                  }
                );

                // Remove temporary reservation
                await tempReservations.deleteMany({ chargerId: order.charger.chargerId });

                console.log(`✅ Charger ${order.charger.chargerId} permanently reserved after payment success`);
              }
            } catch (reservationError) {
              console.error("❌ Failed to reserve charger after payment success:", reservationError);
            }
          }

          // If payment failed, release temporary reservations
          if (paymentData.status === 'failed' || paymentData.status === 'cancelled' || paymentData.status === 'expired') {
            try {
              const order = await orders.findOne({ _id: new ObjectId(orderId) });
              if (order && order.charger && order.charger.chargerId) {
                await tempReservations.deleteMany({ chargerId: order.charger.chargerId });
                console.log(`✅ Temporary reservation released for charger ${order.charger.chargerId} due to payment failure`);
              }
            } catch (releaseError) {
              console.error("❌ Failed to release temporary reservation:", releaseError);
            }
          }

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

  // Direct Mollie payment verification endpoint
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
      
      // If payment is confirmed as paid, update our database AND reserve charger
      if (isPaid && paymentData.metadata && paymentData.metadata.orderId) {
        try {
          console.log("✅ Payment confirmed paid, updating database and reserving charger...");
          
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

          // Reserve charger permanently
          if (updateResult.matchedCount > 0) {
            const order = await orders.findOne({ _id: new ObjectId(paymentData.metadata.orderId) });
            if (order && order.charger && order.charger.chargerId) {
              await chargers.updateOne(
                { chargerId: order.charger.chargerId },
                { 
                  $set: { 
                    reserved: true, 
                    reservedAt: new Date(),
                    reservedBy: paymentData.metadata.orderId,
                    customerEmail: order.email,
                    customerName: `${order.firstName} ${order.lastName}`
                  } 
                }
              );

              // Remove temporary reservation
              await tempReservations.deleteMany({ chargerId: order.charger.chargerId });

              console.log(`✅ Charger ${order.charger.chargerId} permanently reserved after direct verification`);
            }
          }
          
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

  // Manual payment status update endpoint (for testing/debugging)
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

      // If manually marking as paid, reserve the charger
      if (paid === true || paymentStatus === 'paid') {
        try {
          const order = await orders.findOne({ _id: new ObjectId(orderId) });
          if (order && order.charger && order.charger.chargerId) {
            await chargers.updateOne(
              { chargerId: order.charger.chargerId },
              { 
                $set: { 
                  reserved: true, 
                  reservedAt: new Date(),
                  reservedBy: orderId,
                  customerEmail: order.email,
                  customerName: `${order.firstName} ${order.lastName}`
                } 
              }
            );

            // Remove temporary reservation
            await tempReservations.deleteMany({ chargerId: order.charger.chargerId });

            console.log(`✅ Charger ${order.charger.chargerId} reserved after manual payment update`);
          }
        } catch (reservationError) {
          console.error("❌ Failed to reserve charger after manual update:", reservationError);
        }
      }
      
      console.log(`✅ Manual payment status update for order: ${orderId}`, updateData);
      res.json({ message: "Payment status updated", updateData });
      
    } catch (error) {
      console.error("❌ Error updating payment status:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== CHARGING CONTROL ENDPOINTS ==========
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
            $unset: { reservedAt: "", reservedBy: "", customerEmail: "", customerName: "" }
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

  // ========== OWNER SESSION ENDPOINTS ==========
  app.post('/api/create-owner-session', async (req, res) => {
    try {
      const { charger, isOwner, timestamp } = req.body;
      
      const ownerSession = {
        charger,
        isOwner: true,
        timestamp: timestamp || new Date().toISOString(),
        sessionType: 'owner',
        paid: true,
        paymentStatus: 'owner_session',
        createdAt: new Date(),
        status: 'active'
      };
      
      const result = await ownerSessions.insertOne(ownerSession);
      console.log(`✅ Owner session created: ${result.insertedId}`);
      
      res.json({ 
        message: "Owner session created", 
        sessionId: result.insertedId,
        session: ownerSession 
      });
    } catch (error) {
      console.error('❌ Error creating owner session:', error);
      res.status(500).json({ error: "Failed to create owner session" });
    }
  });

  app.get('/api/get-owner-session/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      
      const ownerSession = await ownerSessions.findOne({ _id: new ObjectId(id) });
      if (!ownerSession) {
        return res.status(404).json({ error: "Owner session not found" });
      }
      
      res.json(ownerSession);
    } catch (error) {
      console.error('❌ Error fetching owner session:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post('/api/start-owner-charging/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      
      const updateResult = await ownerSessions.updateOne(
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
      
      if (updateResult.matchedCount === 0) {
        return res.status(404).json({ error: "Owner session not found" });
      }
      
      console.log(`✅ Owner charging started for session: ${id}`);
      res.json({ message: "Owner charging started", sessionId: id });
    } catch (error) {
      console.error('❌ Error starting owner charging:', error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post('/api/owner-charging-status', async (req, res) => {
    try {
      const { sessionId, startTime, endTime, durationSeconds, amountPaid, powerKW, userInfo } = req.body;
      
      const chargingData = {
        sessionId: sessionId ? new ObjectId(sessionId) : null,
        sessionType: 'owner',
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : new Date(),
        durationSeconds,
        amountPaid: 0, // Owner sessions are free
        powerKW: parseFloat(powerKW) || 0,
        isOwner: true,
        createdAt: new Date()
      };
      
      const result = await chargingStatus.insertOne(chargingData);
      
      // Update owner session
      if (sessionId && ObjectId.isValid(sessionId)) {
        await ownerSessions.updateOne(
          { _id: new ObjectId(sessionId) },
          {
            $set: {
              chargingCompleted: true,
              chargingCompletedAt: new Date(),
              status: 'completed',
              updatedAt: new Date()
            }
          }
        );
      }
      
      console.log(`✅ Owner charging session completed: ${sessionId}`);
      res.json({ message: "Owner charging session saved", id: result.insertedId });
    } catch (error) {
      console.error('❌ Error saving owner charging session:', error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ========== ADMIN ENDPOINTS ==========
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

  // Admin endpoint to view temporary reservations
  app.get('/api/temp-reservations', async (req, res) => {
    try {
      const reservations = await tempReservations.find({}).sort({ createdAt: -1 }).toArray();
      res.json(reservations);
    } catch (err) {
      console.error('❌ Error fetching temp reservations:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Admin endpoint to manually clean expired reservations
  app.post('/api/cleanup-expired-reservations', async (req, res) => {
    try {
      await cleanupExpiredTempReservations();
      res.json({ message: "Cleanup completed" });
    } catch (err) {
      console.error('❌ Error during manual cleanup:', err);
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
