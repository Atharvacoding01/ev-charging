// ===== INTEGRATED EV CHARGING BACKEND =====
// backend/index.js - Main server entry point

const express = require('express');
const { ObjectId } = require('mongodb');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const http = require('http');
const https = require('https');

// OCPP imports
const OCPPWebSocketServer = require('./ocpp/ocpp-websocket-server');
const OCPPCMSConfig = require('./ocpp/ocpp-cms-config');
const OCPPPCBIntegration = require('./ocpp/ocpp-pcb-integration');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 10000;

// Global variables
let db;
let ocppWebSocketServer = null;
let ocppCMS = null;
let pcbIntegration = null;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'https://your-frontend-domain.com',
    process.env.CORS_ORIGIN || '*'
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Custom fetch function using Node.js built-in https module
function customFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    const protocol = urlObj.protocol === 'https:' ? https : require('http');
    
    const req = protocol.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          json: () => Promise.resolve(JSON.parse(data)),
          text: () => Promise.resolve(data),
          headers: res.headers
        });
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Database initialization
async function initializeDatabase() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
    // useUnifiedTopology option removed since it's no longer needed
    
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    db = client.db(process.env.DB_NAME || 'evcharging');
    
    // Create indexes for better performance
    const chargers = db.collection('chargers');
    const orders = db.collection('orders');
    const chargingStatus = db.collection('chargingStatus');
    const ownerSessions = db.collection('ownerSessions');

    await Promise.all([
      orders.createIndex({ email: 1 }),
      orders.createIndex({ phone: 1 }),
      orders.createIndex({ paymentStatus: 1 }),
      orders.createIndex({ createdAt: -1 }),
      chargingStatus.createIndex({ orderId: 1 }),
      chargingStatus.createIndex({ createdAt: -1 }),
      chargers.createIndex({ chargerId: 1 }, { unique: true })
    ]);
    console.log("✅ Database indexes created");
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

// External API authentication middleware
const authenticateExternalAPI = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];
    
    if (!authHeader && !apiKey) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Provide either Authorization header with Bearer token or X-API-Key header'
      });
    }

    if (authHeader && pcbIntegration) {
      const token = authHeader.replace('Bearer ', '');
      const { decoded } = await pcbIntegration.verifyJWT(token);
      req.user = decoded;
    } else if (apiKey && pcbIntegration) {
      const connection = await pcbIntegration.externalConnections.findOne({ 
        apiKey, 
        isActive: true,
        expiresAt: { $gt: new Date() }
      });
      if (!connection) {
        return res.status(401).json({ error: 'Invalid or expired API key' });
      }
      req.user = connection;
    }

    next();
  } catch (error) {
    console.error('❌ Authentication error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Create OCPP-specific API routes
function createOCPPRoutes(ocppServer) {
  const router = express.Router();
  
  // Get all connected charge points
  router.get('/chargepoints', (req, res) => {
    try {
      const chargePoints = ocppServer.getAllChargePointStatuses();
      res.json({
        success: true,
        data: chargePoints,
        count: chargePoints.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Get specific charge point status
  router.get('/chargepoints/:id', async (req, res) => {
    try {
      const status = await ocppServer.getChargePointStatus(req.params.id);
      if (!status) {
        return res.status(404).json({
          success: false,
          error: 'Charge point not found'
        });
      }
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Send custom message to ESP
  router.post('/chargepoints/:id/message', async (req, res) => {
    try {
      const { action, payload } = req.body;
      
      if (!action || !payload) {
        return res.status(400).json({
          success: false,
          error: 'Action and payload are required'
        });
      }

      const response = await ocppServer.sendCustomMessage(req.params.id, action, payload);
      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Start charging remotely
  router.post('/chargepoints/:id/start', async (req, res) => {
    try {
      const { idTag, connectorId = 1 } = req.body;
      
      if (!idTag) {
        return res.status(400).json({
          success: false,
          error: 'idTag is required'
        });
      }

      const success = await ocppServer.remoteStartTransaction(req.params.id, idTag, connectorId);
      res.json({
        success,
        message: success ? 'Remote start initiated' : 'Remote start failed'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Stop charging remotely
  router.post('/chargepoints/:id/stop', async (req, res) => {
    try {
      const { transactionId } = req.body;
      
      if (!transactionId) {
        return res.status(400).json({
          success: false,
          error: 'transactionId is required'
        });
      }

      const success = await ocppServer.remoteStopTransaction(req.params.id, transactionId);
      res.json({
        success,
        message: success ? 'Remote stop initiated' : 'Remote stop failed'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Notify charging start to ESP
  router.post('/chargepoints/:id/notify-start', async (req, res) => {
    try {
      const orderData = req.body;
      
      if (!orderData._id) {
        return res.status(400).json({
          success: false,
          error: 'Order data with _id is required'
        });
      }

      const response = await ocppServer.notifyChargingStart(req.params.id, orderData);
      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Notify charging stop to ESP
  router.post('/chargepoints/:id/notify-stop', async (req, res) => {
    try {
      const { orderData, chargingData } = req.body;
      
      if (!orderData || !chargingData) {
        return res.status(400).json({
          success: false,
          error: 'Order data and charging data are required'
        });
      }

      const response = await ocppServer.notifyChargingStop(req.params.id, orderData, chargingData);
      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Reset charge point
  router.post('/chargepoints/:id/reset', async (req, res) => {
    try {
      const { type = 'Soft' } = req.body;
      
      const success = await ocppServer.resetChargePoint(req.params.id, type);
      res.json({
        success,
        message: success ? 'Reset initiated' : 'Reset failed'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Unlock connector
  router.post('/chargepoints/:id/unlock', async (req, res) => {
    try {
      const { connectorId = 1 } = req.body;
      
      const success = await ocppServer.unlockConnector(req.params.id, connectorId);
      res.json({
        success,
        message: success ? 'Unlock initiated' : 'Unlock failed'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Broadcast message to all connected ESP devices
  router.post('/broadcast', async (req, res) => {
    try {
      const { action, payload } = req.body;
      
      if (!action || !payload) {
        return res.status(400).json({
          success: false,
          error: 'Action and payload are required'
        });
      }

      const results = await ocppServer.broadcastToAllESP(action, payload);
      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Get OCPP server statistics
  router.get('/stats', (req, res) => {
    try {
      const connected = ocppServer.getConnectedChargePoints();
      const stats = {
        totalConnected: connected.length,
        connectedDevices: connected,
        serverUptime: process.uptime(),
        serverStatus: 'running'
      };
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}

// Main server initialization
async function startServer() {
  try {
    console.log('🔄 Initializing EV Charging Backend...');
    
    // Initialize database
    await initializeDatabase();
    
    // Get collections
    const chargers = db.collection('chargers');
    const orders = db.collection('orders');
    const chargingStatus = db.collection('chargingStatus');
    const ownerSessions = db.collection('ownerSessions');

    // Create HTTP server
    const server = http.createServer(app);
    
    // Initialize OCPP services
    ocppCMS = new OCPPCMSConfig(db);
    console.log('✅ OCPP CMS initialized');

    // Initialize OCPP WebSocket Server with HTTP server
    ocppWebSocketServer = new OCPPWebSocketServer(db, server);
    await ocppWebSocketServer.initialize();
    console.log(`✅ OCPP WebSocket Server initialized`);

    // Initialize PCB Integration
    pcbIntegration = new OCPPPCBIntegration(db);
    console.log('✅ PCB Integration initialized');

    // Make services available to app
    app.locals.db = db;
    app.locals.collections = { chargers, orders, chargingStatus, ownerSessions };
    app.locals.services = { ocppWebSocketServer, ocppCMS, pcbIntegration };
    app.locals.utils = { customFetch };

    // ========== BASIC ROUTES ==========
    
    // Health check
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          database: 'connected',
          ocppServer: ocppWebSocketServer ? 'running' : 'stopped',
          pcbIntegration: pcbIntegration ? 'initialized' : 'not initialized'
        },
        ocppServer: {
          connected: ocppWebSocketServer ? true : false,
          connectedDevices: ocppWebSocketServer ? ocppWebSocketServer.getConnectedChargePoints().length : 0
        }
      });
    });
    
    // Root route
    app.get('/', (req, res) => {
      res.json({
        message: '🚀 EV Charging Backend API',
        version: '2.0.0',
        ocppWebSocket: '/ocpp',
        endpoints: {
          health: '/health',
          chargers: '/api/chargers',
          orders: '/api/orders',
          payments: '/api/payments',
          charging: '/api/charging',
          cms: '/api/cms/*',
          ocpp: '/api/ocpp/*',
          pcb: '/api/pcb/*',
          external: '/api/external/*',
          admin: '/api/admin/*'
        }
      });
    });

    // ========== CHARGER MANAGEMENT ENDPOINTS ==========
    
    app.get('/api/chargers', async (req, res) => {
      try {
        console.log("📤 GET /api/chargers - Fetching available chargers");
        const allChargers = await chargers.find({}).toArray();
        console.log(`✅ Found ${allChargers.length} chargers`);
        res.json(allChargers);
      } catch (err) {
        console.error('❌ Error fetching chargers:', err);
        res.status(500).json({ error: "Internal error" });
      }
    });

    // ========== ORDER MANAGEMENT ENDPOINTS ==========
    
    // Save order
    app.post('/api/orders', async (req, res) => {
      try {
        const { charger, firstName, lastName, email, phone, timestamp } = req.body;

        if (!charger?.chargerId || !firstName || !lastName || !email || !phone) {
          return res.status(400).json({ error: "Missing required information" });
        }

        const chargerDoc = await chargers.findOne({ chargerId: charger.chargerId });
        if (!chargerDoc) {
          return res.status(400).json({ error: "Charger not found" });
        }

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

    // Get order
    app.get('/api/orders/:id', async (req, res) => {
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

        console.log(`✅ Order retrieved: ${id}`, {
          status: order.status,
          paid: order.paid,
          paymentStatus: order.paymentStatus
        });

        res.json(order);
      } catch (err) {
        console.error('❌ Error fetching order:', err);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Get all orders (admin)
    app.get('/api/orders', async (req, res) => {
      try {
        const allOrders = await orders.find({}).sort({ createdAt: -1 }).toArray();
        res.json(allOrders);
      } catch (err) {
        console.error('❌ Error fetching orders:', err);
        res.status(500).json({ error: "Internal error" });
      }
    });

    // ========== PAYMENT ENDPOINTS ==========
    
    // Payment creation notification
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

    // Mollie webhook
    app.post('/api/mollie-webhook', async (req, res) => {
      try {
        const { id: paymentId } = req.body;
        
        if (!paymentId) {
          console.error("❌ Mollie webhook: Missing payment ID");
          return res.status(400).json({ error: "Missing payment ID" });
        }

        console.log(`📥 Mollie webhook received for payment: ${paymentId}`);

        const MOLLIE_API_KEY = process.env.MOLLIE_API_KEY || "test_Eh4TB42uTjCdCaDGQaCfJ6f6f995tk";

        // Fetch payment details from Mollie
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
            console.log(`✅ Order ${orderId} updated with payment status: ${paymentData.status}`);
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

    // Manual payment status update
    app.post('/api/orders/:orderId/payment-status', async (req, res) => {
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

    // ========== CHARGING CONTROL ENDPOINTS ==========
    
    // Enhanced start charging with ESP device messaging
    app.post('/api/charging/start/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid order ID" });

        // Check if order exists and payment is confirmed
        const order = await orders.findOne({ _id: new ObjectId(id) });
        if (!order) {
          console.error(`❌ Order not found for charging start: ${id}`);
          return res.status(404).json({ error: "Order not found" });
        }

        // Enhanced payment check
        const isPaymentConfirmed = order.paid === true || 
                                  order.paymentStatus === 'paid' || 
                                  order.status === 'paid';

        if (!isPaymentConfirmed) {
          console.error(`❌ Charging start denied - Payment not confirmed. Order: ${id}`);
          return res.status(400).json({ 
            error: "Payment not confirmed", 
            currentStatus: order.paymentStatus || order.status,
            paid: order.paid
          });
        }

        // Try OCPP remote start and ESP notification
        let ocppStarted = false;
        let espNotified = false;
        
        if (order.charger && order.charger.chargerId) {
          try {
            const chargePointStatus = await ocppWebSocketServer.getChargePointStatus(order.charger.chargerId);
            if (chargePointStatus && chargePointStatus.isConnected) {
              console.log('🔌 Attempting OCPP remote start...');
              
              // Send remote start command to ESP device
              ocppStarted = await ocppWebSocketServer.remoteStartTransaction(
                order.charger.chargerId, 
                id, // Use order ID as authorization tag
                1   // Connector ID
              );
              
              if (ocppStarted) {
                console.log('✅ OCPP remote start successful');
                
                // Send charging start notification to ESP device
                try {
                  const startMessage = {
                    command: 'START_CHARGING',
                    orderId: id,
                    customerName: `${order.firstName} ${order.lastName}`,
                    customerPhone: order.phone,
                    timestamp: new Date().toISOString(),
                    paymentConfirmed: true
                  };
                  
                  await ocppWebSocketServer.notifyChargingStart(order.charger.chargerId, order);
                  espNotified = true;
                  console.log('✅ ESP device notified of charging start');
                } catch (notifyError) {
                  console.error('⚠️ Failed to send start notification to ESP:', notifyError);
                }
              }
            } else {
              console.log('⚠️ Charge point not connected via OCPP');
            }
          } catch (ocppError) {
            console.error('❌ OCPP remote start error:', ocppError);
          }
        }

        // Update order to mark charging as started
        await orders.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              chargingStarted: true,
              chargingStartedAt: new Date(),
              status: 'charging',
              ocppControlled: ocppStarted,
              espNotified: espNotified,
              updatedAt: new Date()
            }
          }
        );

        console.log(`✅ Charging started for order: ${id} (OCPP: ${ocppStarted}, ESP: ${espNotified})`);
        
        res.json({ 
          message: "Charging started", 
          orderId: id,
          ocppControlled: ocppStarted,
          espNotified: espNotified
        });
      } catch (err) {
        console.error('❌ Error starting charging:', err);
        res.status(500).json({ error: "Internal error" });
      }
    });

    // Enhanced charging status endpoint
    app.post('/api/charging/status', async (req, res) => {
      try {
        const { orderId, startTime, endTime, durationSeconds, amountPaid, powerKW, stopReason } = req.body;
        if (!orderId || !ObjectId.isValid(orderId)) return res.status(400).json({ error: "Invalid data" });

        const order = await orders.findOne({ _id: new ObjectId(orderId) });
        if (!order) return res.status(404).json({ error: "Order not found" });

        // Send stop notification to ESP device
        let espStopNotified = false;
        if (order.charger && order.charger.chargerId) {
          try {
            const chargingData = {
              orderId,
              startTime,
              endTime,
              durationSeconds,
              amountPaid: parseFloat(amountPaid) || 0,
              powerKW: parseFloat(powerKW) || 0,
              stopReason: stopReason || 'user_requested'
            };
            
            await ocppWebSocketServer.notifyChargingStop(order.charger.chargerId, order, chargingData);
            espStopNotified = true;
            console.log('✅ ESP device notified of charging stop');
          } catch (notifyError) {
            console.error('⚠️ Failed to send stop notification to ESP:', notifyError);
          }
        }

        const chargingStatusData = {
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
          stopReason: stopReason || 'user_requested',
          espStopNotified: espStopNotified,
          createdAt: new Date()
        };

        const result = await chargingStatus.insertOne(chargingStatusData);

        await orders.updateOne(
          { _id: new ObjectId(orderId) },
          {
            $set: {
              chargingCompleted: true,
              chargingCompletedAt: new Date(),
              status: 'completed',
              finalAmount: parseFloat(amountPaid) || 0,
              espStopNotified: espStopNotified,
              updatedAt: new Date()
            }
          }
        );

        console.log(`✅ Charging session completed for order: ${orderId} (ESP Stop Notified: ${espStopNotified})`);
        res.status(200).json({ 
          message: "Charging session saved", 
          id: result.insertedId,
          espStopNotified: espStopNotified 
        });
      } catch (err) {
        console.error('❌ Error saving charging session:', err);
        res.status(500).json({ error: "Internal error" });
      }
    });

    // Get charging sessions
    app.get('/api/charging/sessions', async (req, res) => {
      try {
        const sessions = await chargingStatus.find({}).sort({ createdAt: -1 }).toArray();
        res.json(sessions);
      } catch (err) {
        console.error('❌ Error fetching charging sessions:', err);
        res.status(500).json({ error: "Internal error" });
      }
    });

    // Get charging sessions for specific order
    app.get('/api/charging/sessions/:orderId', async (req, res) => {
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

    // ========== OWNER SESSION ENDPOINTS ==========
    
    app.post('/api/owner-sessions', async (req, res) => {
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

    app.get('/api/owner-sessions/:id', async (req, res) => {
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

    // ========== CMS ENDPOINTS ==========
    
    // Get CMS dashboard data
    app.get('/api/cms/dashboard', async (req, res) => {
      try {
        const totalChargePoints = await db.collection('chargePoints').countDocuments();
        const connectedChargePoints = ocppWebSocketServer.getConnectedChargePoints().length;
        const activeTransactions = await db.collection('ocppTransactions').countDocuments({ status: 'active' });
        const totalTransactions = await db.collection('ocppTransactions').countDocuments();
        const totalOrders = await orders.countDocuments();
        const paidOrders = await orders.countDocuments({ paid: true });

        const recentTransactions = await db.collection('ocppTransactions')
          .find({})
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        const chargePointStatuses = await db.collection('chargePoints')
          .aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ])
          .toArray();

        res.json({
          statistics: {
            totalChargePoints,
            connectedChargePoints,
            activeTransactions,
            totalTransactions,
            totalOrders,
            paidOrders,
            connectionRate: totalChargePoints > 0 ? (connectedChargePoints / totalChargePoints * 100).toFixed(1) : 0
          },
          recentTransactions,
          chargePointStatuses,
          lastUpdated: new Date()
        });
      } catch (error) {
        console.error('❌ Error fetching dashboard data:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get all charge points (CMS view)
    app.get('/api/cms/charge-points', async (req, res) => {
      try {
        const chargePoints = await ocppCMS.getAllChargePoints();
        const connectedPoints = ocppWebSocketServer.getConnectedChargePoints();
        
        // Merge connected status
        const mergedData = chargePoints.map(cp => {
          const connected = connectedPoints.find(c => c.chargePointId === cp.chargePointId);
          return {
            ...cp,
            isConnected: !!connected,
            lastHeartbeat: connected?.lastHeartbeat || cp.lastHeartbeat
          };
        });

        res.json(mergedData);
      } catch (error) {
        console.error('❌ Error fetching charge points:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Remote start transaction
    app.post('/api/cms/remote-start/:chargePointId', async (req, res) => {
      try {
        const { chargePointId } = req.params;
        const { idTag, connectorId = 1 } = req.body;

        if (!idTag) {
          return res.status(400).json({ error: 'idTag is required' });
        }

        const success = await ocppWebSocketServer.remoteStartTransaction(chargePointId, idTag, connectorId);
        
        if (success) {
          res.json({ message: 'Remote start command sent successfully', status: 'accepted' });
        } else {
          res.status(400).json({ error: 'Remote start command failed or was rejected' });
        }
      } catch (error) {
        console.error('❌ Remote start error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Remote stop transaction
    app.post('/api/cms/remote-stop/:chargePointId', async (req, res) => {
      try {
        const { chargePointId } = req.params;
        const { transactionId } = req.body;

        if (!transactionId) {
          return res.status(400).json({ error: 'Transaction ID is required' });
        }

        const success = await ocppWebSocketServer.remoteStopTransaction(chargePointId, transactionId);
        
        if (success) {
          res.json({ message: 'Remote stop command sent successfully', status: 'accepted' });
        } else {
          res.status(400).json({ error: 'Remote stop command failed or was rejected' });
        }
      } catch (error) {
        console.error('❌ Remote stop error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // ========== PCB INTEGRATION ENDPOINTS ==========
    
    // Register new PCB device
    app.post('/api/pcb/register-device', async (req, res) => {
      try {
        const deviceData = req.body;
        
        // Validate required fields
        if (!deviceData.chargePointId || !deviceData.hardwareId) {
          return res.status(400).json({ 
            error: 'chargePointId and hardwareId are required' 
          });
        }

        // Check if device already exists
        const existingDevice = await pcbIntegration.pcbDevices.findOne({
          $or: [
            { hardwareId: deviceData.hardwareId },
            { chargePointId: deviceData.chargePointId }
          ]
        });

        if (existingDevice) {
          return res.status(400).json({ 
            error: 'Device with this hardware ID or charge point ID already exists' 
          });
        }

        const result = await pcbIntegration.registerPCBDevice(deviceData);
        
        res.json({
          message: 'PCB device registered successfully',
          device: result,
          connectionInstructions: {
            step1: 'Flash the provided credentials to your PCB',
            step2: 'Connect to WebSocket endpoint using the provided URL',
            step3: 'Send authentication headers with each OCPP message',
            step4: 'Implement OCPP 1.6 protocol for communication'
          }
        });
      } catch (error) {
        console.error('❌ Error registering PCB device:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get all PCB devices
    app.get('/api/pcb/devices', async (req, res) => {
      try {
        const { includeOffline } = req.query;
        const devices = await pcbIntegration.getPCBDevices(includeOffline === 'true');
        
        // Remove sensitive information
        const sanitizedDevices = devices.map(device => ({
          deviceId: device.deviceId,
          chargePointId: device.chargePointId,
          deviceName: device.deviceName,
          status: device.status,
          isOnline: device.isOnline,
          lastHeartbeat: device.lastHeartbeat,
          firmwareVersion: device.firmwareVersion,
          capabilities: device.capabilities,
          createdAt: device.createdAt
        }));

        res.json(sanitizedDevices);
      } catch (error) {
        console.error('❌ Error fetching PCB devices:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // ========== EXTERNAL API ENDPOINTS ==========
    
    // External API: Get charge points
    app.get('/api/external/charge-points', authenticateExternalAPI, async (req, res) => {
      try {
        const chargePoints = await ocppCMS.getAllChargePoints();
        const connectedPoints = ocppWebSocketServer.getConnectedChargePoints();
        
        const response = chargePoints.map(cp => {
          const connected = connectedPoints.find(c => c.chargePointId === cp.chargePointId);
          return {
            chargePointId: cp.chargePointId,
            status: cp.status,
            isConnected: !!connected,
            connectors: cp.connectors?.length || 1,
            lastHeartbeat: connected?.lastHeartbeat || cp.lastHeartbeat
          };
        });

        res.json(response);
      } catch (error) {
        console.error('❌ External API error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // External API: Remote start
    app.post('/api/external/remote-start', authenticateExternalAPI, async (req, res) => {
      try {
        const { chargePointId, idTag, connectorId = 1 } = req.body;

        if (!chargePointId || !idTag) {
          return res.status(400).json({ error: 'chargePointId and idTag are required' });
        }

        const success = await ocppWebSocketServer.remoteStartTransaction(chargePointId, idTag, connectorId);
        
        if (success) {
          res.json({ 
            message: 'Remote start initiated', 
            chargePointId, 
            status: 'accepted' 
          });
        } else {
          res.status(400).json({ 
            error: 'Remote start failed',
            chargePointId,
            status: 'rejected'
          });
        }
      } catch (error) {
        console.error('❌ External remote start error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // External API: Get transactions
    app.get('/api/external/transactions', authenticateExternalAPI, async (req, res) => {
      try {
        const { chargePointId, status, limit = 50 } = req.query;
        
        let query = {};
        if (chargePointId) query.chargePointId = chargePointId;
        if (status) query.status = status;

        const transactions = await db.collection('ocppTransactions')
          .find(query)
          .sort({ createdAt: -1 })
          .limit(parseInt(limit))
          .project({
            transactionId: 1,
            chargePointId: 1,
            connectorId: 1,
            status: 1,
            startTimestamp: 1,
            stopTimestamp: 1,
            energyDelivered: 1
          })
          .toArray();

        res.json(transactions);
      } catch (error) {
        console.error('❌ External transactions API error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // ========== ESP DEVICE CONTROL ENDPOINTS ==========
    
    // Manual ESP device control
    app.post('/api/esp-control/:chargePointId', async (req, res) => {
      try {
        const { chargePointId } = req.params;
        const { command, data } = req.body;

        if (!command) {
          return res.status(400).json({ error: 'Command is required' });
        }

        const chargePointStatus = await ocppWebSocketServer.getChargePointStatus(chargePointId);
        if (!chargePointStatus || !chargePointStatus.isConnected) {
          return res.status(404).json({ error: 'ESP device not connected' });
        }

        let response;
        switch (command.toLowerCase()) {
          case 'start':
            response = await ocppWebSocketServer.sendCustomMessage(chargePointId, 'ChargingStart', {
              command: 'START_CHARGING',
              ...data,
              timestamp: new Date().toISOString()
            });
            break;
          
          case 'stop':
            response = await ocppWebSocketServer.sendCustomMessage(chargePointId, 'ChargingStop', {
              command: 'STOP_CHARGING',
              ...data,
              timestamp: new Date().toISOString()
            });
            break;
          
          case 'status':
            response = await ocppWebSocketServer.sendCustomMessage(chargePointId, 'StatusRequest', {
              command: 'GET_STATUS',
              timestamp: new Date().toISOString()
            });
            break;
          
          default:
            return res.status(400).json({ error: 'Invalid command' });
        }

        res.json({ 
          message: `Command ${command} sent to ESP device`, 
          chargePointId,
          response 
        });
      } catch (error) {
        console.error('❌ ESP control error:', error);
        res.status(500).json({ error: 'Failed to send command to ESP device' });
      }
    });

    // Get ESP device status
    app.get('/api/esp-status/:chargePointId', async (req, res) => {
      try {
        const { chargePointId } = req.params;
        
        const status = await ocppWebSocketServer.getChargePointStatus(chargePointId);
        
        if (!status) {
          return res.status(404).json({ error: 'ESP device not found' });
        }
        
        res.json({
          chargePointId,
          isConnected: status.isConnected,
          lastHeartbeat: status.lastHeartbeat,
          status: status.status,
          connectors: status.connectors,
          deviceInfo: {
            vendor: status.vendor,
            model: status.model,
            firmwareVersion: status.firmwareVersion
          }
        });
      } catch (error) {
        console.error('❌ Error getting ESP status:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Webhook endpoint for ESP device to report charging status
    app.post('/api/esp-webhook/:chargePointId', async (req, res) => {
      try {
        const { chargePointId } = req.params;
        const { event, data, timestamp } = req.body;

        console.log(`📥 ESP webhook from ${chargePointId}:`, { event, data });

        // Log the event
        await db.collection('espEvents').insertOne({
          chargePointId,
          event,
          data,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          receivedAt: new Date()
        });

        // Handle different events
        switch (event) {
          case 'charging_started':
            console.log(`✅ ESP confirmed charging started for order: ${data.orderId}`);
            if (data.orderId && ObjectId.isValid(data.orderId)) {
              await orders.updateOne(
                { _id: new ObjectId(data.orderId) },
                {
                  $set: {
                    espConfirmedStart: true,
                    espStartConfirmedAt: new Date(),
                    updatedAt: new Date()
                  }
                }
              );
            }
            break;

          case 'charging_stopped':
            console.log(`✅ ESP confirmed charging stopped for order: ${data.orderId}`);
            if (data.orderId && ObjectId.isValid(data.orderId)) {
              await orders.updateOne(
                { _id: new ObjectId(data.orderId) },
                {
                  $set: {
                    espConfirmedStop: true,
                    espStopConfirmedAt: new Date(),
                    actualDuration: data.duration,
                    actualPowerDelivered: data.powerDelivered,
                    updatedAt: new Date()
                  }
                }
              );
            }
            break;

          case 'error':
            console.error(`❌ ESP error reported: ${data.message}`);
            break;

          case 'status_update':
            console.log(`📊 ESP status update: ${data.status}`);
            break;
        }

        res.json({ message: 'Webhook received', event, timestamp: new Date() });
      } catch (error) {
        console.error('❌ ESP webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // ========== SETUP OCPP ROUTES ==========
    
    // Add OCPP-specific routes
    app.use('/api/ocpp', createOCPPRoutes(ocppWebSocketServer));

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

    // ========== ERROR HANDLING ==========
    
    // Global error handler
    app.use((err, req, res, next) => {
      console.error('❌ Unhandled error:', err);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
      });
    });

    // 404 handler
    app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: {
          health: '/health',
          chargers: '/api/chargers',
          orders: '/api/orders',
          payments: '/api/payment-*',
          charging: '/api/charging/*',
          cms: '/api/cms/*',
          ocpp: '/api/ocpp/*',
          pcb: '/api/pcb/*',
          external: '/api/external/*',
          esp: '/api/esp-*'
        }
      });
    });

    // ========== START SERVER ==========
    
    // Start server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔌 OCPP WebSocket available at: ws://localhost:${PORT}/ocpp`);
      console.log(`🌐 HTTP API available at: http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`📝 API Documentation: http://localhost:${PORT}/`);
    });
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('🛑 SIGTERM received, shutting down gracefully...');
      try {
        if (ocppWebSocketServer) {
          await ocppWebSocketServer.stop();
          console.log('✅ OCPP WebSocket Server stopped');
        }
        server.close(() => {
          console.log('✅ HTTP Server stopped');
          console.log('✅ Server shut down successfully');
          process.exit(0);
        });
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    });

    process.on('SIGINT', async () => {
      console.log('🛑 SIGINT received, shutting down gracefully...');
      try {
        if (ocppWebSocketServer) {
          await ocppWebSocketServer.stop();
          console.log('✅ OCPP WebSocket Server stopped');
        }
        server.close(() => {
          console.log('✅ HTTP Server stopped');
          console.log('✅ Server shut down successfully');
          process.exit(0);
        });
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't exit the process, just log the error
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      console.log('🛑 Server will shut down...');
      process.exit(1);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});