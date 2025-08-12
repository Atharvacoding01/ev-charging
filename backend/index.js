require('dotenv').config();

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
// app.use(cors({
//   origin: [
//     'http://localhost:3000', 
//     'https://www.ntevstore.nl',
//     process.env.CORS_ORIGIN || '*'
//   ],
//   credentials: true
// }));
app.use(cors({
  origin: '*'
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
    // Use environment variable for MongoDB URI
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
    const dbName = process.env.DB_NAME || 'test';
    
    console.log('🔄 Connecting to MongoDB Atlas...'); 
    
    const client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 50
    });
    
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');
    
    db = client.db(dbName);
    
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
    console.error('❌ MongoDB connection failed:', {
      error: error.message,
      code: error.code,
      uri: '[REDACTED]' // Hide connection string for security
    });
    throw error;
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
                console.log(`✅ OCPP remote start successful for order: ${id}`);
              } else {
                console.warn(`❌ OCPP remote start failed for order: ${id}`);
              }
            } else {
              console.error(`❌ Charge point not connected: ${order.charger.chargerId}`);
            }
          } catch (ocppError) {
            console.error(`❌ OCPP remote start error: ${ocppError.message}`);
          }
        } else {
          console.error(`❌ Charger information missing in order: ${id}`);
        }

        // Notify ESP about charging start
        try {
          const notifyResponse = await ocppWebSocketServer.notifyChargingStart(order.charger.chargerId, order);
          espNotified = notifyResponse.success;
          console.log(`📡 ESP notification ${espNotified ? 'succeeded' : 'failed'} for order: ${id}`);
        } catch (notifyError) {
          console.error(`❌ ESP notification error: ${notifyError.message}`);
        }

        res.json({
          success: true,
          message: 'Charging start process initiated',
          data: {
            ocppStarted,
            espNotified
          }
        });
      } catch (error) {
        console.error('❌ Error starting charging:', error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Enhanced stop charging with ESP device messaging
    app.post('/api/charging/stop/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid order ID" });

        // Check if order exists
        const order = await orders.findOne({ _id: new ObjectId(id) });
        if (!order) {
          console.error(`❌ Order not found for charging stop: ${id}`);
          return res.status(404).json({ error: "Order not found" });
        }

        // Try OCPP remote stop and ESP notification
        let ocppStopped = false;
        let espNotified = false;
        
        if (order.charger && order.charger.chargerId) {
          try {
            const chargePointStatus = await ocppWebSocketServer.getChargePointStatus(order.charger.chargerId);
            if (chargePointStatus && chargePointStatus.isConnected) {
              console.log('🔌 Attempting OCPP remote stop...');
              
              // Send remote stop command to ESP device
              ocppStopped = await ocppWebSocketServer.remoteStopTransaction(
                order.charger.chargerId, 
                order.transactionId // Use order transaction ID
              );
              
              if (ocppStopped) {
                console.log(`✅ OCPP remote stop successful for order: ${id}`);
              } else {
                console.warn(`❌ OCPP remote stop failed for order: ${id}`);
              }
            } else {
              console.error(`❌ Charge point not connected: ${order.charger.chargerId}`);
            }
          } catch (ocppError) {
            console.error(`❌ OCPP remote stop error: ${ocppError.message}`);
          }
        } else {
          console.error(`❌ Charger information missing in order: ${id}`);
        }

        // Notify ESP about charging stop
        try {
          const notifyResponse = await ocppWebSocketServer.notifyChargingStop(order.charger.chargerId, order);
          espNotified = notifyResponse.success;
          console.log(`📡 ESP notification ${espNotified ? 'succeeded' : 'failed'} for order: ${id}`);
        } catch (notifyError) {
          console.error(`❌ ESP notification error: ${notifyError.message}`);
        }

        res.json({
          success: true,
          message: 'Charging stop process initiated',
          data: {
            ocppStopped,
            espNotified
          }
        });
      } catch (error) {
        console.error('❌ Error stopping charging:', error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // ========== ADMINISTRATIVE ENDPOINTS ==========
    
    // Admin health check
    app.get('/api/admin/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          database: db ? 'connected' : 'disconnected',
          ocppServer: ocppWebSocketServer ? 'running' : 'stopped',
          pcbIntegration: pcbIntegration ? 'initialized' : 'not initialized'
        }
      });
    });

    // Admin: Get server logs
    app.get('/api/admin/logs', (req, res) => {
      // For security, limit log access to admin users only
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      // Implement log retrieval logic here
      res.json({
        success: true,
        message: "Log retrieval not implemented",
        data: [] // Replace with actual log data
      });
    });

    // Admin: Get system metrics
    app.get('/api/admin/metrics', (req, res) => {
      // For security, limit metrics access to admin users only
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const metrics = {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        requestsPerSecond: req.metrics ? req.metrics.requestsPerSecond : 0
      };
      
      res.json({
        success: true,
        data: metrics
      });
    });

    // Admin: Force server shutdown (for maintenance)
    app.post('/api/admin/shutdown', (req, res) => {
      // For security, limit shutdown access to admin users only
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      res.json({
        success: true,
        message: "Shutdown initiated",
        data: null
      });
      
      // Graceful shutdown after 5 seconds
      setTimeout(() => {
        console.log("🔒 Shutting down server for maintenance...");
        process.exit(0);
      }, 5000);
    });

    // Admin: Reload configuration
    app.post('/api/admin/reload-config', async (req, res) => {
      // For security, limit config reload access to admin users only
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      try {
        // Reload environment variables
        require('dotenv').config();
        
        // Reinitialize services with new config
        await initializeDatabase();
        ocppCMS = new OCPPCMSConfig(db);
        ocppWebSocketServer = new OCPPWebSocketServer(db, server);
        pcbIntegration = new OCPPPCBIntegration(db);
        
        res.json({
          success: true,
          message: "Configuration reloaded",
          data: null
        });
      } catch (error) {
        console.error('❌ Error reloading configuration:', error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // ========== ERROR HANDLING ==========
    
    // 404 Not Found
    app.use((req, res) => {
      res.status(404).json({ error: "Not found" });
    });

    // Global error handler
    app.use((err, req, res, next) => {
      console.error('❌ Unhandled error:', err);
      res.status(500).json({ error: "Internal server error" });
    });

    // Start the server
    server.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('❌ Server initialization failed:', error);
  }
}

// Start the server
startServer();