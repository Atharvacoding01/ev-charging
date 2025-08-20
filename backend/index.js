const express = require('express');
const { ObjectId } = require('mongodb');
const connectDB = require('./config/mongo');
const cors = require('cors');
const https = require('https');
const http = require('http');

// OCPP imports
const OCPPWebSocketServer = require('./ocpp/ocpp-websocket-server');
const OCPPCMSConfig = require('./ocpp/ocpp-cms-config');
// ===== PCB INTEGRATION API ENDPOINTS =====
// Add these endpoints to your main server.js file

// Add this import at the top of your server.js
const OCPPPCBIntegration = require('./ocpp/ocpp-pcb-integration');

// Add this after your database connection
let pcbIntegration = null;

// Inside your connectDB().then() block, after other initializations:
connectDB().then((db) => {
  // ... existing code ...
  
  // Initialize PCB Integration
  pcbIntegration = new OCPPPCBIntegration(db);
  console.log('✅ PCB Integration initialized');

  // ========== PCB DEVICE MANAGEMENT ENDPOINTS ==========
  
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

  // Idempotent PCB device provisioning: register if new, otherwise refresh credentials
  app.post('/api/pcb/provision-device', async (req, res) => {
    try {
      const deviceData = req.body || {};

      if (!deviceData.chargePointId || !deviceData.hardwareId) {
        return res.status(400).json({
          error: 'chargePointId and hardwareId are required'
        });
      }

      // Check if device exists by hardwareId or chargePointId
      const existingDevice = await pcbIntegration.pcbDevices.findOne({
        $or: [
          { hardwareId: deviceData.hardwareId },
          { chargePointId: deviceData.chargePointId }
        ],
        isActive: { $ne: false }
      });

      let resultPayload;
      if (existingDevice) {
        // Refresh credentials for existing device
        const refreshed = await pcbIntegration.refreshDeviceCredentials(existingDevice.deviceId);

        resultPayload = {
          message: 'Existing device found. Credentials refreshed successfully',
          device: {
            deviceId: existingDevice.deviceId,
            chargePointId: existingDevice.chargePointId,
            deviceName: existingDevice.deviceName,
            status: existingDevice.status,
            isOnline: existingDevice.isOnline,
            lastHeartbeat: existingDevice.lastHeartbeat,
            firmwareVersion: existingDevice.firmwareVersion,
            capabilities: existingDevice.capabilities,
            createdAt: existingDevice.createdAt
          },
          credentials: refreshed
        };
      } else {
        // Register a new device
        const registered = await pcbIntegration.registerPCBDevice(deviceData);
        resultPayload = {
          message: 'PCB device registered successfully',
          device: {
            deviceId: registered.deviceId,
            chargePointId: deviceData.chargePointId,
            deviceName: deviceData.deviceName || `PCB-${registered.deviceId}`
          },
          connectionUrl: registered.connectionUrl,
          credentials: registered.credentials
        };
      }

      // Optionally persist credentials to an order if provided
      if (deviceData.orderId && ObjectId.isValid(deviceData.orderId)) {
        await orders.updateOne(
          { _id: new ObjectId(deviceData.orderId) },
          {
            $set: {
              ocppCredentials: resultPayload,
              credentialsGeneratedAt: new Date(),
              updatedAt: new Date()
            }
          }
        );
      }

      return res.json(resultPayload);
    } catch (error) {
      console.error('❌ Error provisioning PCB device:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
  // Add to your backend server.js
app.post('/api/orders/:orderId/credentials', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { ocppCredentials, generatedAt } = req.body;

    // Update the order with OCPP credentials
    await db.collection('orders').updateOne(
      { _id: new ObjectId(orderId) },
      { 
        $set: { 
          ocppCredentials,
          credentialsGeneratedAt: generatedAt,
          updatedAt: new Date()
        } 
      }
    );

    res.json({ message: 'Credentials saved successfully' });
  } catch (error) {
    console.error('Error saving credentials:', error);
    res.status(500).json({ error: 'Failed to save credentials' });
  }
});

// Get order with credentials
app.get('/api/orders/:orderId/credentials', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await db.collection('orders').findOne({ 
      _id: new ObjectId(orderId) 
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({
      orderId: order._id,
      customerName: `${order.firstName} ${order.lastName}`,
      email: order.email,
      charger: order.charger,
      ocppCredentials: order.ocppCredentials,
      generatedAt: order.credentialsGeneratedAt
    });
  } catch (error) {
    console.error('Error fetching order credentials:', error);
    res.status(500).json({ error: 'Failed to fetch credentials' });
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

  // Get specific PCB device details
  app.get('/api/pcb/devices/:deviceId', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const device = await pcbIntegration.pcbDevices.findOne({ deviceId });

      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      // Remove sensitive information
      const sanitizedDevice = {
        deviceId: device.deviceId,
        chargePointId: device.chargePointId,
        deviceName: device.deviceName,
        status: device.status,
        isOnline: device.isOnline,
        lastHeartbeat: device.lastHeartbeat,
        firmwareVersion: device.firmwareVersion,
        hardwareVersion: device.hardwareVersion,
        capabilities: device.capabilities,
        createdAt: device.createdAt,
        lastConnection: device.lastConnection
      };

      res.json(sanitizedDevice);
    } catch (error) {
      console.error('❌ Error fetching PCB device:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Send command to PCB device
  app.post('/api/pcb/devices/:deviceId/command', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const { command, parameters } = req.body;

      if (!command) {
        return res.status(400).json({ error: 'Command is required' });
      }

      const result = await pcbIntegration.handlePCBCommand(deviceId, command, parameters);
      res.json({ message: 'Command sent successfully', result });
    } catch (error) {
      console.error('❌ Error sending PCB command:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // Update PCB device status (called by PCB)
  app.post('/api/pcb/devices/:deviceId/status', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const statusData = req.body;

      // Authenticate device
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Authorization required' });
      }

      const token = authHeader.replace('Bearer ', '');
      await pcbIntegration.verifyJWT(token);

      await pcbIntegration.updatePCBStatus(deviceId, statusData);
      res.json({ message: 'Status updated successfully' });
    } catch (error) {
      console.error('❌ Error updating PCB status:', error);
      res.status(error.message.includes('verification') ? 401 : 500)
         .json({ error: error.message || 'Internal server error' });
    }
  });

  // Refresh device credentials
  app.post('/api/pcb/devices/:deviceId/refresh-credentials', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const newCredentials = await pcbIntegration.refreshDeviceCredentials(deviceId);
      
      res.json({
        message: 'Credentials refreshed successfully',
        credentials: newCredentials,
        note: 'Please update your PCB with the new credentials immediately'
      });
    } catch (error) {
      console.error('❌ Error refreshing credentials:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Revoke PCB device
  app.delete('/api/pcb/devices/:deviceId', async (req, res) => {
    try {
      const { deviceId } = req.params;
      await pcbIntegration.revokePCBDevice(deviceId);
      
      res.json({ message: 'Device revoked successfully' });
    } catch (error) {
      console.error('❌ Error revoking PCB device:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========== EXTERNAL WEBSITE CREDENTIALS ENDPOINTS ==========
  
  // Generate credentials for external website
  app.post('/api/external/generate-credentials', async (req, res) => {
    try {
      const websiteData = req.body;
      
      // Validate required fields
      if (!websiteData.websiteName || !websiteData.websiteUrl || !websiteData.contactEmail) {
        return res.status(400).json({ 
          error: 'websiteName, websiteUrl, and contactEmail are required' 
        });
      }

      const credentials = await pcbIntegration.generateWebsiteCredentials(websiteData);
      
      res.json({
        message: 'External website credentials generated successfully',
        credentials,
        documentation: {
          authentication: 'Use Bearer token in Authorization header',
          rateLimit: 'Check X-RateLimit headers in responses',
          webhooks: 'Configure webhook URL to receive real-time updates'
        }
      });
    } catch (error) {
      console.error('❌ Error generating website credentials:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // List external connections
  app.get('/api/external/connections', async (req, res) => {
    try {
      const connections = await pcbIntegration.externalConnections
        .find({ isActive: true })
        .project({
          connectionId: 1,
          websiteName: 1,
          websiteUrl: 1,
          permissions: 1,
          createdAt: 1,
          expiresAt: 1,
          rateLimit: 1
        })
        .sort({ createdAt: -1 })
        .toArray();

      res.json(connections);
    } catch (error) {
      console.error('❌ Error fetching external connections:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========== EXTERNAL API ENDPOINTS ==========
  
  // Middleware for external API authentication
  const authenticateExternalAPI = async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      const apiKey = req.headers['x-api-key'];
      
      if (!authHeader && !apiKey) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const { decoded } = await pcbIntegration.verifyJWT(token);
        req.user = decoded;
      } else if (apiKey) {
        const connection = await pcbIntegration.externalConnections.findOne({ 
          apiKey, 
          isActive: true 
        });
        if (!connection) {
          return res.status(401).json({ error: 'Invalid API key' });
        }
        req.user = connection;
      }

      next();
    } catch (error) {
      res.status(401).json({ error: 'Authentication failed' });
    }
  };

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

  // External API: Remote stop
  app.post('/api/external/remote-stop', authenticateExternalAPI, async (req, res) => {
    try {
      const { chargePointId, transactionId } = req.body;

      if (!chargePointId || !transactionId) {
        return res.status(400).json({ error: 'chargePointId and transactionId are required' });
      }

      const success = await ocppWebSocketServer.remoteStopTransaction(chargePointId, transactionId);
      
      if (success) {
        res.json({ 
          message: 'Remote stop initiated', 
          chargePointId, 
          transactionId,
          status: 'accepted' 
        });
      } else {
        res.status(400).json({ 
          error: 'Remote stop failed',
          chargePointId,
          transactionId,
          status: 'rejected'
        });
      }
    } catch (error) {
      console.error('❌ External remote stop error:', error);
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

  // ========== PCB AUTHENTICATION ENDPOINT =====
  
  // PCB device authentication
  app.post('/api/pcb/authenticate', async (req, res) => {
    try {
      const { apiKey, deviceSecret } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
      }

      const device = await pcbIntegration.authenticatePCBDevice(apiKey, deviceSecret);
      const credentials = await pcbIntegration.generateConnectionCredentials(device.deviceId);
      
      res.json({
        message: 'Authentication successful',
        deviceId: device.deviceId,
        connectionCredentials: credentials,
        serverTime: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ PCB authentication error:', error);
      res.status(401).json({ error: error.message });
    }
  });

  console.log('✅ PCB Integration API endpoints initialized');
  
  // ... rest of your existing code ...
});

const app = express();
app.use(cors());
app.use(express.json());

// Global OCPP variables
let ocppWebSocketServer = null;
let ocppCMS = null;

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
  const ownerSessions = db.collection('ownerSessions');

  console.log("✅ Connected to MongoDB collections");

  // Initialize OCPP services
  ocppCMS = new OCPPCMSConfig(db);
  // Create HTTP server and attach both Express and WebSocket on same port
  const server = http.createServer(app);
  ocppWebSocketServer = new OCPPWebSocketServer(server, db);
  
  // Start OCPP WebSocket Server
  ocppWebSocketServer.initialize().then(() => {
    console.log('✅ OCPP WebSocket Server initialized');
  }).catch(error => {
    console.error('❌ Failed to initialize OCPP WebSocket Server:', error);
  });

  // Basic route
  app.get('/', (req, res) => res.send('🚀 EV Charging Backend Running!'));

  // ========== CMS CONFIGURATION ENDPOINTS ==========
  
  // Get OCPP configuration
  app.get('/api/cms/config', async (req, res) => {
    try {
      const config = await ocppCMS.getConfig();
      res.json(config);
    } catch (error) {
      console.error('❌ Error fetching OCPP config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update OCPP configuration
  app.put('/api/cms/config', async (req, res) => {
    try {
      const configData = req.body;
      
      // Validate WebSocket URL
      if (configData.websocketUrl && !ocppCMS.validateWebSocketUrl(configData.websocketUrl)) {
        return res.status(400).json({ error: 'Invalid WebSocket URL format' });
      }

      await ocppCMS.updateConfig(configData);
      
      // If WebSocket URL changed, restart server
      if (configData.websocketUrl) {
        console.log('🔄 Restarting OCPP WebSocket Server with new configuration...');
        await ocppWebSocketServer.stop();
        ocppWebSocketServer = new OCPPWebSocketServer(8080, db);
        await ocppWebSocketServer.initialize();
      }

      res.json({ message: 'Configuration updated successfully' });
    } catch (error) {
      console.error('❌ Error updating OCPP config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========== CHARGE POINT MANAGEMENT ENDPOINTS ==========
  
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

  // Get specific charge point details
  app.get('/api/cms/charge-points/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const chargePoint = await ocppWebSocketServer.getChargePointStatus(id);
      
      if (!chargePoint) {
        return res.status(404).json({ error: 'Charge point not found' });
      }

      res.json(chargePoint);
    } catch (error) {
      console.error('❌ Error fetching charge point:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Register new charge point
  app.post('/api/cms/charge-points', async (req, res) => {
    try {
      const chargePointData = req.body;
      
      if (!chargePointData.chargePointId) {
        return res.status(400).json({ error: 'Charge Point ID is required' });
      }

      // Check if charge point already exists
      const existing = await ocppCMS.getChargePoint(chargePointData.chargePointId);
      if (existing) {
        return res.status(400).json({ error: 'Charge point already exists' });
      }

      const result = await ocppCMS.registerChargePoint(chargePointData);
      res.json({ message: 'Charge point registered successfully', id: result.insertedId });
    } catch (error) {
      console.error('❌ Error registering charge point:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Generate charge point configuration
  app.get('/api/cms/charge-points/:id/config', async (req, res) => {
    try {
      const { id } = req.params;
      const config = await ocppCMS.generateChargePointConfig(id);
      res.json(config);
    } catch (error) {
      console.error('❌ Error generating charge point config:', error);
      res.status(404).json({ error: 'Charge point not found' });
    }
  });

  // ========== REMOTE CONTROL ENDPOINTS ==========
  
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

  // Unlock connector
  app.post('/api/cms/unlock/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const { connectorId = 1 } = req.body;

      const success = await ocppWebSocketServer.unlockConnector(chargePointId, connectorId);
      
      if (success) {
        res.json({ message: 'Unlock command sent successfully', status: 'unlocked' });
      } else {
        res.status(400).json({ error: 'Unlock command failed or connector was not unlocked' });
      }
    } catch (error) {
      console.error('❌ Unlock error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Reset charge point
  app.post('/api/cms/reset/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const { type = 'Soft' } = req.body;

      if (!['Soft', 'Hard'].includes(type)) {
        return res.status(400).json({ error: 'Reset type must be "Soft" or "Hard"' });
      }

      const success = await ocppWebSocketServer.resetChargePoint(chargePointId, type);
      
      if (success) {
        res.json({ message: `${type} reset command sent successfully`, status: 'accepted' });
      } else {
        res.status(400).json({ error: 'Reset command failed or was rejected' });
      }
    } catch (error) {
      console.error('❌ Reset error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========== TRANSACTION MANAGEMENT ENDPOINTS ==========
  
  // Get all transactions
  app.get('/api/cms/transactions', async (req, res) => {
    try {
      const { status, chargePointId, limit = 100 } = req.query;
      
      let query = {};
      if (status) query.status = status;
      if (chargePointId) query.chargePointId = chargePointId;

      const transactions = await db.collection('ocppTransactions')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .toArray();

      res.json(transactions);
    } catch (error) {
      console.error('❌ Error fetching transactions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get active transactions
  app.get('/api/cms/transactions/active', async (req, res) => {
    try {
      const activeTransactions = await ocppCMS.getActiveTransactions();
      res.json(activeTransactions);
    } catch (error) {
      console.error('❌ Error fetching active transactions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get transaction by ID
  app.get('/api/cms/transactions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const transaction = await ocppCMS.getTransaction(parseInt(id));
      
      if (!transaction) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      res.json(transaction);
    } catch (error) {
      console.error('❌ Error fetching transaction:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========== METER VALUES ENDPOINTS ==========
  
  // Get meter values
  app.get('/api/cms/meter-values', async (req, res) => {
    try {
      const { chargePointId, transactionId, limit = 100 } = req.query;
      
      let query = {};
      if (chargePointId) query.chargePointId = chargePointId;
      if (transactionId) query.transactionId = parseInt(transactionId);

      const meterValues = await db.collection('ocppMeterValues')
        .find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .toArray();

      res.json(meterValues);
    } catch (error) {
      console.error('❌ Error fetching meter values:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get meter values for specific charge point
  app.get('/api/cms/meter-values/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const { limit = 100, from, to } = req.query;
      
      let query = { chargePointId };
      
      if (from || to) {
        query.timestamp = {};
        if (from) query.timestamp.$gte = new Date(from);
        if (to) query.timestamp.$lte = new Date(to);
      }

      const meterValues = await db.collection('ocppMeterValues')
        .find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .toArray();

      res.json(meterValues);
    } catch (error) {
      console.error('❌ Error fetching meter values:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========== LOGGING ENDPOINTS ==========
  
  // Get OCPP logs
  app.get('/api/cms/logs', async (req, res) => {
    try {
      const { chargePointId, limit = 100 } = req.query;
      const logs = await ocppCMS.getLogs(chargePointId, parseInt(limit));
      res.json(logs);
    } catch (error) {
      console.error('❌ Error fetching logs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get logs for specific charge point
  app.get('/api/cms/logs/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const { limit = 100 } = req.query;
      const logs = await ocppCMS.getLogs(chargePointId, parseInt(limit));
      res.json(logs);
    } catch (error) {
      console.error('❌ Error fetching charge point logs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========== WEBSOCKET STATUS ENDPOINT ==========
  
  // Get WebSocket server status
  app.get('/api/cms/websocket/status', (req, res) => {
    try {
      const connectedChargePoints = ocppWebSocketServer.getConnectedChargePoints();
      
      res.json({
        isRunning: !!ocppWebSocketServer,
        port: 8080,
        connectedChargePoints: connectedChargePoints.length,
        chargePoints: connectedChargePoints
      });
    } catch (error) {
      console.error('❌ Error getting WebSocket status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Restart WebSocket server
  app.post('/api/cms/websocket/restart', async (req, res) => {
    try {
      console.log('🔄 Restarting OCPP WebSocket Server...');
      
      await ocppWebSocketServer.stop();
      ocppWebSocketServer = new OCPPWebSocketServer(server, db);
      await ocppWebSocketServer.stop();
      ocppWebSocketServer = new OCPPWebSocketServer(server, db);
      await ocppWebSocketServer.initialize();
      
      res.json({ message: 'WebSocket server restarted successfully' });
    } catch (error) {
      console.error('❌ Error restarting WebSocket server:', error);
      res.status(500).json({ error: 'Failed to restart WebSocket server' });
    }
  });

  // ========== CHARGER MANAGEMENT ENDPOINTS ==========
  app.get('/api/chargers', async (req, res) => {
    try {
      console.log("📤 GET /api/chargers - Fetching available chargers");
      
      // Get all chargers (no reservation filtering)
      const allChargers = await chargers.find({}).toArray();

      console.log(`✅ Found ${allChargers.length} chargers`);
      res.json(allChargers);
    } catch (err) {
      console.error('❌ Error fetching chargers:', err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ========== ORDER MANAGEMENT ENDPOINTS ==========
  // Save order (simplified without reservations)
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

      console.log(`✅ Refund initiated for order ${orderId}, payment ID: ${order.molliePaymentId || order.paymentId}`);
      
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

  // Mollie webhook - simplified without reservations
  app.post('/api/mollie-webhook', async (req, res) => {
    try {
      const { id: paymentId } = req.body;
      
      if (!paymentId) {
        console.error("❌ Mollie webhook: Missing payment ID");
        return res.status(400).json({ error: "Missing payment ID" });
      }

      console.log(`📥 Mollie webhook received for payment: ${paymentId}`);

      const MOLLIE_API_KEY = "test_Eh4TB42uTjCdCaDGQaCfJ6f6f995tk";

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
      
      console.log(`✅ Manual payment status update for order: ${orderId}`, updateData);
      res.json({ message: "Payment status updated", updateData });
      
    } catch (error) {
      console.error("❌ Error updating payment status:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== CHARGING CONTROL ENDPOINTS ==========
  // Enhanced start charging with OCPP support + ESP notification
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

      // Try OCPP remote start if charge point is connected
      let ocppStarted = false;
      let espNotified = false;
      if (order.charger && order.charger.chargerId) {
        try {
          const chargePointStatus = await ocppWebSocketServer.getChargePointStatus(order.charger.chargerId);
          if (chargePointStatus && chargePointStatus.isConnected) {
            console.log('🔌 Attempting OCPP remote start...');
            ocppStarted = await ocppWebSocketServer.remoteStartTransaction(
              order.charger.chargerId, 
              id, // Use order ID as authorization tag
              1   // Connector ID
            );
            console.log(`${ocppStarted ? '✅' : '❌'} OCPP remote start ${ocppStarted ? 'successful' : 'failed'}`);

            // Always send ESP custom start notification as well
            try {
              const startMessage = {
                command: 'START_CHARGING',
                orderId: id,
                customerName: `${order.firstName} ${order.lastName}`,
                customerPhone: order.phone,
                timestamp: new Date().toISOString(),
                paymentConfirmed: true
              };

              await ocppWebSocketServer.sendCustomMessage(
                order.charger.chargerId,
                'ChargingStart',
                startMessage
              );
              espNotified = true;
              console.log('✅ ESP device notified of charging start');
            } catch (notifyError) {
              console.error('⚠️ Failed to send start notification to ESP:', notifyError);
            }
          } else {
            console.log('⚠️ Charge point not connected via OCPP, proceeding with manual start');
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

      console.log(`✅ Charging started for order: ${id} (OCPP: ${ocppStarted ? 'Yes' : 'No'}, ESP Notified: ${espNotified ? 'Yes' : 'No'})`);
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

  app.post('/api/charging-status', async (req, res) => {
    try {
      const { orderId, startTime, endTime, durationSeconds, amountPaid, powerKW, stopReason } = req.body;
      if (!orderId || !ObjectId.isValid(orderId)) return res.status(400).json({ error: "Invalid data" });

      const order = await orders.findOne({ _id: new ObjectId(orderId) });
      if (!order) return res.status(404).json({ error: "Order not found" });

      // Notify ESP to stop (best-effort)
      let espStopNotified = false;
      if (order.charger && order.charger.chargerId) {
        try {
          const chargePointStatus = await ocppWebSocketServer.getChargePointStatus(order.charger.chargerId);
          if (chargePointStatus && chargePointStatus.isConnected) {
            const stopMessage = {
              command: 'STOP_CHARGING',
              orderId: orderId,
              customerName: `${order.firstName} ${order.lastName}`,
              customerPhone: order.phone,
              chargingDuration: durationSeconds,
              finalAmount: parseFloat(amountPaid) || 0,
              powerDelivered: parseFloat(powerKW) || 0,
              stopReason: stopReason || 'user_requested',
              timestamp: new Date().toISOString()
            };
            await ocppWebSocketServer.sendCustomMessage(
              order.charger.chargerId,
              'ChargingStop',
              stopMessage
            );
            espStopNotified = true;
            console.log('✅ ESP device notified of charging stop');
          }
        } catch (notifyError) {
          console.error('⚠️ Failed to send stop notification to ESP:', notifyError);
        }
      }

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
        stopReason: stopReason || 'user_requested',
        espStopNotified: espStopNotified,
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
            espStopNotified: espStopNotified,
            updatedAt: new Date()
          }
        }
      );

      console.log(`✅ Charging session completed for order: ${orderId} (ESP Stop Notified: ${espStopNotified ? 'Yes' : 'No'})`);
      res.status(200).json({ message: "Charging session saved", id: result.insertedId, espStopNotified });
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

  // ========== DASHBOARD/STATISTICS ENDPOINTS ==========
  
  // Get CMS dashboard data
  app.get('/api/cms/dashboard', async (req, res) => {
    try {
      const totalChargePoints = await db.collection('chargePoints').countDocuments();
      const connectedChargePoints = ocppWebSocketServer.getConnectedChargePoints().length;
      const activeTransactions = await db.collection('ocppTransactions').countDocuments({ status: 'active' });
      const totalTransactions = await db.collection('ocppTransactions').countDocuments();
      const totalOrders = await orders.countDocuments();
      const paidOrders = await orders.countDocuments({ paid: true });

      // Get recent transactions
      const recentTransactions = await db.collection('ocppTransactions')
        .find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      // Get charge point statuses
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

  // ========== OCPP API ENDPOINTS ==========
  app.get('/api/ocpp/charge-points', (req, res) => {
    const connectedChargePoints = ocppWebSocketServer.getConnectedChargePoints();
    res.json({ chargePoints: connectedChargePoints });
  });

  app.get('/api/ocpp/status/:chargePointId', (req, res) => {
    const { chargePointId } = req.params;
    const status = ocppWebSocketServer.getChargePointStatus(chargePointId);
    
    if (!status) {
      return res.status(404).json({ error: 'Charge point not connected' });
    }
    
    res.json(status);
  });

  app.get('/api/ocpp/status', (req, res) => {
    const allStatuses = ocppWebSocketServer.getAllChargePointStatuses();
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

      const messageId = await ocppWebSocketServer.remoteStartTransaction(chargePointId, idTag, connectorId);
      
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

      const messageId = await ocppWebSocketServer.remoteStopTransaction(chargePointId, transactionId);
      
      if (!messageId) {
        return res.status(400).json({ error: 'Charge point not connected' });
      }

      res.json({ message: 'Remote stop command sent', messageId });
    } catch (error) {
      console.error('❌ Remote stop error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  // ========== ENHANCED CHARGING CONTROL ENDPOINTS ==========
// Add these modifications to your server.js file

// Enhanced start charging with ESP device messaging
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

    // Try OCPP remote start if charge point is connected
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
            
            // Send custom charging start message to ESP device
            try {
              const startMessage = {
                command: 'START_CHARGING',
                orderId: id,
                customerName: `${order.firstName} ${order.lastName}`,
                customerPhone: order.phone,
                timestamp: new Date().toISOString(),
                paymentConfirmed: true
              };
              
              await ocppWebSocketServer.sendCustomMessage(
                order.charger.chargerId, 
                'ChargingStart', 
                startMessage
              );
              
              espNotified = true;
              console.log('✅ ESP device notified of charging start');
            } catch (notifyError) {
              console.error('⚠️ Failed to send start notification to ESP:', notifyError);
            }
          } else {
            console.log('❌ OCPP remote start failed');
          }
        } else {
          console.log('⚠️ Charge point not connected via OCPP, proceeding with manual start');
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

    console.log(`✅ Charging started for order: ${id} (OCPP: ${ocppStarted ? 'Yes' : 'No'}, ESP Notified: ${espNotified ? 'Yes' : 'No'})`);
    
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

// Enhanced charging status endpoint with ESP stop notification
app.post('/api/charging-status', async (req, res) => {
  try {
    const { orderId, startTime, endTime, durationSeconds, amountPaid, powerKW, stopReason } = req.body;
    if (!orderId || !ObjectId.isValid(orderId)) return res.status(400).json({ error: "Invalid data" });

    const order = await orders.findOne({ _id: new ObjectId(orderId) });
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Send stop notification to ESP device
    let espStopNotified = false;
    if (order.charger && order.charger.chargerId) {
      try {
        const chargePointStatus = await ocppWebSocketServer.getChargePointStatus(order.charger.chargerId);
        if (chargePointStatus && chargePointStatus.isConnected) {
          const stopMessage = {
            command: 'STOP_CHARGING',
            orderId: orderId,
            customerName: `${order.firstName} ${order.lastName}`,
            customerPhone: order.phone,
            chargingDuration: durationSeconds,
            finalAmount: parseFloat(amountPaid) || 0,
            powerDelivered: parseFloat(powerKW) || 0,
            stopReason: stopReason || 'user_requested',
            timestamp: new Date().toISOString()
          };
          
          await ocppWebSocketServer.sendCustomMessage(
            order.charger.chargerId, 
            'ChargingStop', 
            stopMessage
          );
          
          espStopNotified = true;
          console.log('✅ ESP device notified of charging stop');
        }
      } catch (notifyError) {
        console.error('⚠️ Failed to send stop notification to ESP:', notifyError);
      }
    }

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
      stopReason: stopReason || 'user_requested',
      espStopNotified: espStopNotified,
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
          espStopNotified: espStopNotified,
          updatedAt: new Date()
        }
      }
    );

    console.log(`✅ Charging session completed for order: ${orderId} (ESP Stop Notified: ${espStopNotified ? 'Yes' : 'No'})`);
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

// New endpoint for manual ESP device control
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

// Endpoint to get ESP device status
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

  app.post('/api/ocpp/unlock/:chargePointId', async (req, res) => {
    try {
      const { chargePointId } = req.params;
      const { connectorId } = req.body;

      const messageId = await ocppWebSocketServer.unlockConnector(chargePointId, connectorId);
      
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

      const messageId = await ocppWebSocketServer.resetChargePoint(chargePointId, type);
      
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

  console.log('✅ All API endpoints initialized');
  
  // Start HTTP server (Express + WebSocket on same port)
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`🚀 Server (HTTP + WebSocket) running on port ${PORT}`);
  });

}).catch(err => {
  console.error("❌ MongoDB connection failed:", err);
  process.exit(1);
});
