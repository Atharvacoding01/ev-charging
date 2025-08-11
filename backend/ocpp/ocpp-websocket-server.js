// ===== ENHANCED OCPP WEBSOCKET SERVER =====
// backend/ocpp/ocpp-websocket-server.js

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const OCPPCMSConfig = require('./ocpp-cms-config');

class OCPPWebSocketServer {
  constructor(port, database) {
    this.port = port;
    this.db = database;
    this.cms = new OCPPCMSConfig(database);
    this.wss = null;
    this.chargePoints = new Map();
    this.pendingMessages = new Map();
    this.messageHandlers = new Map();
    
    this.initializeMessageHandlers();
  }

  async initialize() {
    try {
      // Initialize default configuration
      await this.cms.initializeDefaultConfig();
      
      // Start WebSocket server
      this.wss = new WebSocket.Server({ 
        port: this.port,
        path: '/',
        verifyClient: (info) => {
          console.log(`🔌 WebSocket connection attempt from: ${info.origin || 'unknown'}`);
          return true;
        }
      });

      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req);
      });

      console.log(`🚀 OCPP WebSocket Server started on port ${this.port}`);
      
      // Start heartbeat monitoring
      this.startHeartbeatMonitoring();
      
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize OCPP server:', error);
      throw error;
    }
  }

  handleConnection(ws, req) {
    const chargePointId = this.extractChargePointId(req.url);
    
    if (!chargePointId) {
      console.error('❌ Invalid charge point ID in connection');
      ws.close(1008, 'Invalid charge point ID');
      return;
    }

    console.log(`🔌 Charge point connected: ${chargePointId}`);
    
    // Store connection
    this.chargePoints.set(chargePointId, {
      ws: ws,
      id: chargePointId,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      status: 'Connected'
    });

    // Update CMS
    this.cms.updateChargePointStatus(chargePointId, {
      status: 'Available',
      lastHeartbeat: new Date()
    });

    // Setup event handlers
    ws.on('message', (data) => {
      this.handleMessage(chargePointId, data);
    });

    ws.on('close', (code, reason) => {
      console.log(`🔌 Charge point disconnected: ${chargePointId} (${code}: ${reason})`);
      this.chargePoints.delete(chargePointId);
      this.cms.updateChargePointStatus(chargePointId, {
        status: 'Offline',
        lastHeartbeat: new Date()
      });
    });

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for ${chargePointId}:`, error);
    });

    // Send boot notification if this is a new charge point
    this.requestBootNotification(chargePointId);
  }

  extractChargePointId(url) {
    // Extract charge point ID from URL path
    // Expected format: /chargepoint/{id} or /{id}
    const match = url.match(/\/(?:chargepoint\/)?([^\/]+)/);
    return match ? match[1] : null;
  }

  async handleMessage(chargePointId, data) {
    try {
      const message = JSON.parse(data.toString());
      
      // Log incoming message
      await this.cms.logMessage({
        chargePointId,
        messageType: message[0],
        direction: 'incoming',
        messageId: message[1],
        action: message[2],
        payload: message[3],
      });

      const [messageType, messageId, action, payload] = message;

      switch (messageType) {
        case 2: // Call
          await this.handleCall(chargePointId, messageId, action, payload);
          break;
        case 3: // CallResult
          await this.handleCallResult(chargePointId, messageId, payload);
          break;
        case 4: // CallError
          await this.handleCallError(chargePointId, messageId, payload);
          break;
        default:
          console.error(`❌ Unknown message type: ${messageType}`);
      }
    } catch (error) {
      console.error(`❌ Error handling message from ${chargePointId}:`, error);
    }
  }

  async handleCall(chargePointId, messageId, action, payload) {
    const handler = this.messageHandlers.get(action);
    
    if (!handler) {
      console.error(`❌ No handler for action: ${action}`);
      this.sendCallError(chargePointId, messageId, 'NotImplemented', `Action ${action} not implemented`);
      return;
    }

    try {
      const response = await handler.call(this, chargePointId, payload);
      this.sendCallResult(chargePointId, messageId, response);
    } catch (error) {
      console.error(`❌ Error handling ${action}:`, error);
      this.sendCallError(chargePointId, messageId, 'InternalError', error.message);
    }
  }

  async handleCallResult(chargePointId, messageId, payload) {
    const pendingMessage = this.pendingMessages.get(messageId);
    
    if (pendingMessage) {
      this.pendingMessages.delete(messageId);
      console.log(`✅ Received response for ${pendingMessage.action}: ${JSON.stringify(payload)}`);
      
      if (pendingMessage.resolve) {
        pendingMessage.resolve(payload);
      }
    }
  }

  async handleCallError(chargePointId, messageId, payload) {
    const pendingMessage = this.pendingMessages.get(messageId);
    
    if (pendingMessage) {
      this.pendingMessages.delete(messageId);
      console.error(`❌ Received error for ${pendingMessage.action}: ${JSON.stringify(payload)}`);
      
      if (pendingMessage.reject) {
        pendingMessage.reject(new Error(`OCPP Error: ${payload[1]}`));
      }
    }
  }

  initializeMessageHandlers() {
    // Boot Notification
    this.messageHandlers.set('BootNotification', async (chargePointId, payload) => {
      console.log(`🚀 Boot notification from ${chargePointId}:`, payload);
      
      await this.cms.registerChargePoint({
        chargePointId,
        vendor: payload.chargePointVendor,
        model: payload.chargePointModel,
        serialNumber: payload.chargePointSerialNumber,
        firmwareVersion: payload.firmwareVersion,
        numberOfConnectors: payload.numberOfConnectors || 1
      });

      return {
        currentTime: new Date().toISOString(),
        interval: 300,
        status: 'Accepted'
      };
    });

    // Heartbeat
    this.messageHandlers.set('Heartbeat', async (chargePointId, payload) => {
      const chargePoint = this.chargePoints.get(chargePointId);
      if (chargePoint) {
        chargePoint.lastHeartbeat = new Date();
      }

      await this.cms.updateChargePointStatus(chargePointId, {
        lastHeartbeat: new Date()
      });

      return {
        currentTime: new Date().toISOString()
      };
    });

    // Status Notification
    this.messageHandlers.set('StatusNotification', async (chargePointId, payload) => {
      console.log(`📊 Status notification from ${chargePointId}:`, payload);
      
      await this.cms.updateConnectorStatus(
        chargePointId,
        payload.connectorId,
        payload.status,
        payload.errorCode
      );

      return {}; // Empty response
    });

    // Start Transaction
    this.messageHandlers.set('StartTransaction', async (chargePointId, payload) => {
      console.log(`🔋 Start transaction from ${chargePointId}:`, payload);
      
      const transactionId = Date.now(); // Generate unique transaction ID
      
      await this.cms.startTransaction({
        transactionId,
        chargePointId,
        connectorId: payload.connectorId,
        idTag: payload.idTag,
        meterStart: payload.meterStart,
        timestamp: payload.timestamp
      });

      return {
        idTagInfo: {
          status: 'Accepted'
        },
        transactionId
      };
    });

    // Stop Transaction
    this.messageHandlers.set('StopTransaction', async (chargePointId, payload) => {
      console.log(`🛑 Stop transaction from ${chargePointId}:`, payload);
      
      await this.cms.stopTransaction(
        payload.transactionId,
        payload.meterStop,
        payload.reason
      );

      return {
        idTagInfo: {
          status: 'Accepted'
        }
      };
    });

    // Meter Values
    this.messageHandlers.set('MeterValues', async (chargePointId, payload) => {
      console.log(`📊 Meter values from ${chargePointId}:`, payload);
      
      await this.cms.storeMeterValues({
        chargePointId,
        connectorId: payload.connectorId,
        transactionId: payload.transactionId,
        timestamp: payload.timestamp,
        sampledValues: payload.meterValue[0].sampledValue
      });

      return {}; // Empty response
    });

    // Authorize
    this.messageHandlers.set('Authorize', async (chargePointId, payload) => {
      console.log(`🔐 Authorization request from ${chargePointId}:`, payload);
      
      // Simple authorization - accept all for now
      return {
        idTagInfo: {
          status: 'Accepted'
        }
      };
    });
  }

  // Send message to charge point
  async sendMessage(chargePointId, action, payload) {
    const chargePoint = this.chargePoints.get(chargePointId);
    
    if (!chargePoint || chargePoint.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Charge point ${chargePointId} not connected`);
    }

    return new Promise((resolve, reject) => {
      const messageId = uuidv4();
      const message = [2, messageId, action, payload];
      
      this.pendingMessages.set(messageId, {
        action,
        resolve,
        reject,
        timestamp: new Date()
      });

      // Log outgoing message
      this.cms.logMessage({
        chargePointId,
        messageType: 2,
        direction: 'outgoing',
        messageId,
        action,
        payload
      });

      chargePoint.ws.send(JSON.stringify(message));

      // Set timeout for response
      setTimeout(() => {
        if (this.pendingMessages.has(messageId)) {
          this.pendingMessages.delete(messageId);
          reject(new Error('Message timeout'));
        }
      }, 30000);
    });
  }

  sendCallResult(chargePointId, messageId, payload) {
    const chargePoint = this.chargePoints.get(chargePointId);
    
    if (chargePoint && chargePoint.ws.readyState === WebSocket.OPEN) {
      const message = [3, messageId, payload];
      chargePoint.ws.send(JSON.stringify(message));
      
      // Log outgoing message
      this.cms.logMessage({
        chargePointId,
        messageType: 3,
        direction: 'outgoing',
        messageId,
        action: 'CallResult',
        payload
      });
    }
  }

  sendCallError(chargePointId, messageId, errorCode, errorDescription) {
    const chargePoint = this.chargePoints.get(chargePointId);
    
    if (chargePoint && chargePoint.ws.readyState === WebSocket.OPEN) {
      const message = [4, messageId, errorCode, errorDescription, {}];
      chargePoint.ws.send(JSON.stringify(message));
      
      // Log outgoing message
      this.cms.logMessage({
        chargePointId,
        messageType: 4,
        direction: 'outgoing',
        messageId,
        action: 'CallError',
        payload: { errorCode, errorDescription }
      });
    }
  }

  // Remote control methods
  async remoteStartTransaction(chargePointId, idTag, connectorId = 1) {
    try {
      const response = await this.sendMessage(chargePointId, 'RemoteStartTransaction', {
        idTag,
        connectorId
      });
      
      console.log(`✅ Remote start response:`, response);
      return response.status === 'Accepted';
    } catch (error) {
      console.error(`❌ Remote start failed:`, error);
      return false;
    }
  }

  async remoteStopTransaction(chargePointId, transactionId) {
    try {
      const response = await this.sendMessage(chargePointId, 'RemoteStopTransaction', {
        transactionId
      });
      
      console.log(`✅ Remote stop response:`, response);
      return response.status === 'Accepted';
    } catch (error) {
      console.error(`❌ Remote stop failed:`, error);
      return false;
    }
  }

  async unlockConnector(chargePointId, connectorId) {
    try {
      const response = await this.sendMessage(chargePointId, 'UnlockConnector', {
        connectorId
      });
      
      console.log(`✅ Unlock connector response:`, response);
      return response.status === 'Unlocked';
    } catch (error) {
      console.error(`❌ Unlock connector failed:`, error);
      return false;
    }
  }

  async resetChargePoint(chargePointId, type = 'Soft') {
    try {
      const response = await this.sendMessage(chargePointId, 'Reset', {
        type
      });
      
      console.log(`✅ Reset response:`, response);
      return response.status === 'Accepted';
    } catch (error) {
      console.error(`❌ Reset failed:`, error);
      return false;
    }
  }

  async requestBootNotification(chargePointId) {
    // This would typically be sent by the charge point
    // Here we might trigger it or request current status
    console.log(`📝 Requesting boot notification from ${chargePointId}`);
  }

  // Get connected charge points
  getConnectedChargePoints() {
    const connected = [];
    for (const [id, chargePoint] of this.chargePoints) {
      connected.push({
        chargePointId: id,
        connectedAt: chargePoint.connectedAt,
        lastHeartbeat: chargePoint.lastHeartbeat,
        status: chargePoint.status
      });
    }
    return connected;
  }
  // Add these methods to your OCPPWebSocketServer class in ocpp-websocket-server.js

// Custom message sending method for ESP devices
async sendCustomMessage(chargePointId, action, payload) {
  const chargePoint = this.chargePoints.get(chargePointId);
  
  if (!chargePoint || chargePoint.ws.readyState !== WebSocket.OPEN) {
    throw new Error(`Charge point ${chargePointId} not connected`);
  }

  return new Promise((resolve, reject) => {
    const messageId = uuidv4();
    // Using OCPP format: [MessageType, MessageId, Action, Payload]
    const message = [2, messageId, action, payload];
    
    this.pendingMessages.set(messageId, {
      action,
      resolve,
      reject,
      timestamp: new Date()
    });

    // Log outgoing message
    this.cms.logMessage({
      chargePointId,
      messageType: 2,
      direction: 'outgoing',
      messageId,
      action,
      payload
    });

    console.log(`📤 Sending custom message to ESP ${chargePointId}:`, { action, payload });
    chargePoint.ws.send(JSON.stringify(message));

    // Set timeout for response
    setTimeout(() => {
      if (this.pendingMessages.has(messageId)) {
        this.pendingMessages.delete(messageId);
        reject(new Error('Custom message timeout'));
      }
    }, 30000);
  });
}

// Add custom message handlers for ESP responses
initializeCustomMessageHandlers() {
  // Handle ESP charging confirmation
  this.messageHandlers.set('ChargingStartConfirmation', async (chargePointId, payload) => {
    console.log(`✅ ESP charging start confirmed from ${chargePointId}:`, payload);
    
    // Store confirmation in database
    if (payload.orderId) {
      await this.db.collection('orders').updateOne(
        { _id: new ObjectId(payload.orderId) },
        {
          $set: {
            espStartConfirmed: true,
            espStartConfirmedAt: new Date(),
            espMessage: payload.message || 'Charging started successfully'
          }
        }
      );
    }

    return {
      status: 'Received',
      timestamp: new Date().toISOString()
    };
  });

  // Handle ESP charging stop confirmation
  this.messageHandlers.set('ChargingStopConfirmation', async (chargePointId, payload) => {
    console.log(`✅ ESP charging stop confirmed from ${chargePointId}:`, payload);
    
    // Store confirmation in database
    if (payload.orderId) {
      await this.db.collection('orders').updateOne(
        { _id: new ObjectId(payload.orderId) },
        {
          $set: {
            espStopConfirmed: true,
            espStopConfirmedAt: new Date(),
            espFinalMessage: payload.message || 'Charging stopped successfully',
            espFinalDuration: payload.actualDuration,
            espFinalPower: payload.actualPower
          }
        }
      );
    }

    return {
      status: 'Received',
      timestamp: new Date().toISOString()
    };
  });

  // Handle ESP status response
  this.messageHandlers.set('StatusResponse', async (chargePointId, payload) => {
    console.log(`📊 ESP status response from ${chargePointId}:`, payload);
    
    // Update charge point status
    await this.cms.updateChargePointStatus(chargePointId, {
      espStatus: payload.status,
      espLastUpdate: new Date(),
      espData: payload
    });

    return {
      status: 'Received',
      timestamp: new Date().toISOString()
    };
  });

  // Handle ESP error reports
  this.messageHandlers.set('ErrorReport', async (chargePointId, payload) => {
    console.error(`❌ ESP error report from ${chargePointId}:`, payload);
    
    // Log error in database
    await this.db.collection('espErrors').insertOne({
      chargePointId,
      errorCode: payload.errorCode,
      errorMessage: payload.errorMessage,
      orderId: payload.orderId,
      timestamp: new Date(),
      payload
    });

    return {
      status: 'ErrorReceived',
      timestamp: new Date().toISOString()
    };
  });
}

// Enhanced initialization to include custom handlers
async initialize() {
  try {
    // Initialize default configuration
    await this.cms.initializeDefaultConfig();
    
    // Initialize both standard and custom message handlers
    this.initializeMessageHandlers();
    this.initializeCustomMessageHandlers();
    
    // Start WebSocket server
    this.wss = new WebSocket.Server({ 
      port: this.port,
      path: '/',
      verifyClient: (info) => {
        console.log(`🔌 WebSocket connection attempt from: ${info.origin || 'unknown'}`);
        return true;
      }
    });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    console.log(`🚀 OCPP WebSocket Server started on port ${this.port}`);
    
    // Start heartbeat monitoring
    this.startHeartbeatMonitoring();
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize OCPP server:', error);
    throw error;
  }
}

// Method to send charging start notification
async notifyChargingStart(chargePointId, orderData) {
  try {
    const startMessage = {
      command: 'START_CHARGING',
      orderId: orderData._id.toString(),
      customerName: `${orderData.firstName} ${orderData.lastName}`,
      customerPhone: orderData.phone,
      customerEmail: orderData.email,
      paymentConfirmed: true,
      timestamp: new Date().toISOString()
    };
    
    const response = await this.sendCustomMessage(chargePointId, 'ChargingStart', startMessage);
    console.log('✅ ESP notified of charging start:', response);
    return response;
  } catch (error) {
    console.error('❌ Failed to notify ESP of charging start:', error);
    throw error;
  }
}

// Method to send charging stop notification
async notifyChargingStop(chargePointId, orderData, chargingData) {
  try {
    const stopMessage = {
      command: 'STOP_CHARGING',
      orderId: orderData._id.toString(),
      customerName: `${orderData.firstName} ${orderData.lastName}`,
      customerPhone: orderData.phone,
      chargingDuration: chargingData.durationSeconds,
      finalAmount: chargingData.amountPaid,
      powerDelivered: chargingData.powerKW,
      stopReason: chargingData.stopReason || 'user_requested',
      timestamp: new Date().toISOString()
    };
    
    const response = await this.sendCustomMessage(chargePointId, 'ChargingStop', stopMessage);
    console.log('✅ ESP notified of charging stop:', response);
    return response;
  } catch (error) {
    console.error('❌ Failed to notify ESP of charging stop:', error);
    throw error;
  }
}

// Method to get all charge point statuses including ESP data
getAllChargePointStatuses() {
  const statuses = [];
  for (const [id, chargePoint] of this.chargePoints) {
    statuses.push({
      chargePointId: id,
      isConnected: true,
      connectedAt: chargePoint.connectedAt,
      lastHeartbeat: chargePoint.lastHeartbeat,
      status: chargePoint.status,
      wsReadyState: chargePoint.ws.readyState,
      canReceiveMessages: chargePoint.ws.readyState === WebSocket.OPEN
    });
  }
  return statuses;
}

// Method to broadcast message to all connected ESP devices
async broadcastToAllESP(action, payload) {
  const results = [];
  
  for (const [chargePointId] of this.chargePoints) {
    try {
      const response = await this.sendCustomMessage(chargePointId, action, payload);
      results.push({
        chargePointId,
        success: true,
        response
      });
    } catch (error) {
      results.push({
        chargePointId,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}
  // Get charge point status
  async getChargePointStatus(chargePointId) {
    const connected = this.chargePoints.get(chargePointId);
    const stored = await this.cms.getChargePoint(chargePointId);
    
    if (!connected && !stored) {
      return null;
    }

    return {
      chargePointId,
      isConnected: !!connected,
      connectedAt: connected?.connectedAt || null,
      lastHeartbeat: connected?.lastHeartbeat || stored?.lastHeartbeat,
      status: connected?.status || stored?.status || 'Offline',
      connectors: stored?.connectors || [],
      vendor: stored?.vendor,
      model: stored?.model,
      firmwareVersion: stored?.firmwareVersion
    };
  }

  // Start heartbeat monitoring
  startHeartbeatMonitoring() {
    setInterval(() => {
      const now = new Date();
      const timeout = 5 * 60 * 1000; // 5 minutes

      for (const [id, chargePoint] of this.chargePoints) {
        if (now - chargePoint.lastHeartbeat > timeout) {
          console.log(`⚠️ Heartbeat timeout for ${id}`);
          chargePoint.ws.close(1001, 'Heartbeat timeout');
        }
      }
    }, 60000); // Check every minute
  }

  // Stop server
  async stop() {
    if (this.wss) {
      this.wss.close();
      console.log('🛑 OCPP WebSocket Server stopped');
    }
  }
}

module.exports = OCPPWebSocketServer;
