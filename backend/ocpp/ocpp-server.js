const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class OCPPServer {
  constructor(port = 8080, mongoDb) {
    this.port = port;
    this.db = mongoDb;
    this.chargePoints = new Map(); // Store connected charge points
    this.server = null;
    this.init();
  }

  init() {
    this.server = new WebSocket.Server({ 
      port: this.port,
      path: '/ocpp',
      verifyClient: this.verifyClient.bind(this)
    });

    this.server.on('connection', this.handleConnection.bind(this));
    console.log(`🔌 OCPP WebSocket server started on port ${this.port}`);
  }

  verifyClient(info) {
    // Extract charge point ID from URL path
    const url = new URL(info.req.url, `http://${info.req.headers.host}`);
    const chargePointId = url.pathname.split('/').pop();
    
    console.log(`🔍 OCPP connection attempt from charge point: ${chargePointId}`);
    
    // Verify charge point exists in database
    return this.isValidChargePoint(chargePointId);
  }

  async isValidChargePoint(chargePointId) {
    try {
      const charger = await this.db.collection('chargers').findOne({ 
        chargerId: chargePointId 
      });
      return !!charger;
    } catch (error) {
      console.error('❌ Error verifying charge point:', error);
      return false;
    }
  }

  handleConnection(ws, request) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const chargePointId = url.pathname.split('/').pop();

    console.log(`✅ OCPP charge point connected: ${chargePointId}`);

    // Store connection
    this.chargePoints.set(chargePointId, {
      ws,
      chargePointId,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      status: 'Available',
      currentTransaction: null
    });

    // Set up message handlers
    ws.on('message', (data) => this.handleMessage(chargePointId, data));
    ws.on('close', () => this.handleDisconnection(chargePointId));
    ws.on('error', (error) => this.handleError(chargePointId, error));

    // Update database
    this.updateChargerStatus(chargePointId, 'Available', true);

    // Send boot notification response
    this.sendBootNotificationResponse(chargePointId);
  }

  handleMessage(chargePointId, data) {
    try {
      const message = JSON.parse(data.toString());
      console.log(`📥 OCPP message from ${chargePointId}:`, message);

      const [messageType, messageId, action, payload] = message;

      switch (action) {
        case 'BootNotification':
          this.handleBootNotification(chargePointId, messageId, payload);
          break;
        case 'Heartbeat':
          this.handleHeartbeat(chargePointId, messageId);
          break;
        case 'StatusNotification':
          this.handleStatusNotification(chargePointId, messageId, payload);
          break;
        case 'StartTransaction':
          this.handleStartTransaction(chargePointId, messageId, payload);
          break;
        case 'StopTransaction':
          this.handleStopTransaction(chargePointId, messageId, payload);
          break;
        case 'MeterValues':
          this.handleMeterValues(chargePointId, messageId, payload);
          break;
        case 'Authorize':
          this.handleAuthorize(chargePointId, messageId, payload);
          break;
        default:
          console.log(`⚠️ Unknown OCPP action: ${action}`);
          this.sendCallError(chargePointId, messageId, 'NotSupported', 'Action not supported');
      }
    } catch (error) {
      console.error(`❌ Error parsing OCPP message from ${chargePointId}:`, error);
    }
  }

  // OCPP Message Handlers
  handleBootNotification(chargePointId, messageId, payload) {
    console.log(`🚀 Boot notification from ${chargePointId}:`, payload);
    
    this.sendCallResult(chargePointId, messageId, {
      status: 'Accepted',
      currentTime: new Date().toISOString(),
      interval: 300 // Heartbeat interval in seconds
    });

    // Update charger info in database
    this.updateChargerInfo(chargePointId, payload);
  }

  handleHeartbeat(chargePointId, messageId) {
    const chargePoint = this.chargePoints.get(chargePointId);
    if (chargePoint) {
      chargePoint.lastHeartbeat = new Date();
    }

    this.sendCallResult(chargePointId, messageId, {
      currentTime: new Date().toISOString()
    });
  }

  handleStatusNotification(chargePointId, messageId, payload) {
    console.log(`📊 Status notification from ${chargePointId}:`, payload);
    
    const chargePoint = this.chargePoints.get(chargePointId);
    if (chargePoint) {
      chargePoint.status = payload.status;
    }

    this.updateChargerStatus(chargePointId, payload.status, true);
    this.sendCallResult(chargePointId, messageId, {});
  }

  async handleStartTransaction(chargePointId, messageId, payload) {
    console.log(`▶️ Start transaction from ${chargePointId}:`, payload);
    
    try {
      // Verify authorization
      const isAuthorized = await this.verifyAuthorization(payload.idTag);
      
      if (!isAuthorized) {
        this.sendCallResult(chargePointId, messageId, {
          transactionId: -1,
          idTagInfo: { status: 'Invalid' }
        });
        return;
      }

      // Create transaction
      const transactionId = await this.createTransaction(chargePointId, payload);
      
      const chargePoint = this.chargePoints.get(chargePointId);
      if (chargePoint) {
        chargePoint.currentTransaction = transactionId;
        chargePoint.status = 'Charging';
      }

      this.sendCallResult(chargePointId, messageId, {
        transactionId,
        idTagInfo: { status: 'Accepted' }
      });

      // Update charger status
      this.updateChargerStatus(chargePointId, 'Charging', true);

    } catch (error) {
      console.error('❌ Error handling start transaction:', error);
      this.sendCallError(chargePointId, messageId, 'InternalError', 'Transaction start failed');
    }
  }

  async handleStopTransaction(chargePointId, messageId, payload) {
    console.log(`⏹️ Stop transaction from ${chargePointId}:`, payload);
    
    try {
      // Update transaction in database
      await this.completeTransaction(chargePointId, payload);
      
      const chargePoint = this.chargePoints.get(chargePointId);
      if (chargePoint) {
        chargePoint.currentTransaction = null;
        chargePoint.status = 'Available';
      }

      this.sendCallResult(chargePointId, messageId, {
        idTagInfo: { status: 'Accepted' }
      });

      // Update charger status
      this.updateChargerStatus(chargePointId, 'Available', true);

    } catch (error) {
      console.error('❌ Error handling stop transaction:', error);
      this.sendCallError(chargePointId, messageId, 'InternalError', 'Transaction stop failed');
    }
  }

  handleMeterValues(chargePointId, messageId, payload) {
    console.log(`📊 Meter values from ${chargePointId}:`, payload);
    
    // Store meter values in database
    this.storeMeterValues(chargePointId, payload);
    
    this.sendCallResult(chargePointId, messageId, {});
  }

  async handleAuthorize(chargePointId, messageId, payload) {
    console.log(`🔐 Authorization request from ${chargePointId}:`, payload);
    
    const isAuthorized = await this.verifyAuthorization(payload.idTag);
    
    this.sendCallResult(chargePointId, messageId, {
      idTagInfo: { 
        status: isAuthorized ? 'Accepted' : 'Invalid',
        expiryDate: isAuthorized ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined
      }
    });
  }

  // Database Operations
  async updateChargerStatus(chargerId, status, isOnline) {
    try {
      await this.db.collection('chargers').updateOne(
        { chargerId },
        { 
          $set: { 
            status,
            isOnline,
            lastSeen: new Date(),
            updatedAt: new Date()
          } 
        }
      );
    } catch (error) {
      console.error('❌ Error updating charger status:', error);
    }
  }

  async updateChargerInfo(chargerId, bootInfo) {
    try {
      await this.db.collection('chargers').updateOne(
        { chargerId },
        { 
          $set: { 
            chargePointModel: bootInfo.chargePointModel,
            chargePointVendor: bootInfo.chargePointVendor,
            firmwareVersion: bootInfo.firmwareVersion,
            chargePointSerialNumber: bootInfo.chargePointSerialNumber,
            lastBootNotification: new Date(),
            updatedAt: new Date()
          } 
        }
      );
    } catch (error) {
      console.error('❌ Error updating charger info:', error);
    }
  }

  async verifyAuthorization(idTag) {
    try {
      // Check if the ID tag corresponds to a valid order
      const order = await this.db.collection('orders').findOne({
        $or: [
          { phone: idTag },
          { email: idTag },
          { _id: idTag }
        ],
        paid: true,
        status: { $in: ['paid', 'charging'] }
      });

      return !!order;
    } catch (error) {
      console.error('❌ Error verifying authorization:', error);
      return false;
    }
  }

  async createTransaction(chargerId, startPayload) {
    try {
      const transaction = {
        chargerId,
        transactionId: uuidv4(),
        idTag: startPayload.idTag,
        connectorId: startPayload.connectorId,
        meterStart: startPayload.meterStart,
        timestamp: new Date(startPayload.timestamp),
        status: 'active',
        createdAt: new Date()
      };

      const result = await this.db.collection('ocppTransactions').insertOne(transaction);
      return result.insertedId.toString();
    } catch (error) {
      console.error('❌ Error creating transaction:', error);
      throw error;
    }
  }

  async completeTransaction(chargerId, stopPayload) {
    try {
      await this.db.collection('ocppTransactions').updateOne(
        { 
          chargerId,
          transactionId: stopPayload.transactionId.toString(),
          status: 'active'
        },
        {
          $set: {
            meterStop: stopPayload.meterStop,
            timestamp: new Date(stopPayload.timestamp),
            reason: stopPayload.reason,
            status: 'completed',
            completedAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      console.error('❌ Error completing transaction:', error);
      throw error;
    }
  }

  async storeMeterValues(chargerId, meterPayload) {
    try {
      const meterData = {
        chargerId,
        transactionId: meterPayload.transactionId,
        meterValue: meterPayload.meterValue,
        timestamp: new Date(),
        createdAt: new Date()
      };

      await this.db.collection('ocppMeterValues').insertOne(meterData);
    } catch (error) {
      console.error('❌ Error storing meter values:', error);
    }
  }

  // OCPP Communication Methods
  sendCall(chargePointId, action, payload) {
    const chargePoint = this.chargePoints.get(chargePointId);
    if (!chargePoint || chargePoint.ws.readyState !== WebSocket.OPEN) {
      console.error(`❌ Cannot send to ${chargePointId}: not connected`);
      return null;
    }

    const messageId = uuidv4();
    const message = [2, messageId, action, payload]; // CALL message type

    chargePoint.ws.send(JSON.stringify(message));
    console.log(`📤 Sent OCPP call to ${chargePointId}:`, { action, messageId });
    
    return messageId;
  }

  sendCallResult(chargePointId, messageId, payload) {
    const chargePoint = this.chargePoints.get(chargePointId);
    if (!chargePoint || chargePoint.ws.readyState !== WebSocket.OPEN) {
      console.error(`❌ Cannot send result to ${chargePointId}: not connected`);
      return;
    }

    const message = [3, messageId, payload]; // CALLRESULT message type
    chargePoint.ws.send(JSON.stringify(message));
    console.log(`📤 Sent OCPP result to ${chargePointId}:`, { messageId });
  }

  sendCallError(chargePointId, messageId, errorCode, errorDescription) {
    const chargePoint = this.chargePoints.get(chargePointId);
    if (!chargePoint || chargePoint.ws.readyState !== WebSocket.OPEN) {
      console.error(`❌ Cannot send error to ${chargePointId}: not connected`);
      return;
    }

    const message = [4, messageId, errorCode, errorDescription, {}]; // CALLERROR message type
    chargePoint.ws.send(JSON.stringify(message));
    console.log(`📤 Sent OCPP error to ${chargePointId}:`, { messageId, errorCode });
  }

  // Remote Commands
  async remoteStartTransaction(chargerId, idTag, connectorId = 1) {
    console.log(`🎮 Remote start transaction for ${chargerId}`);
    
    const messageId = this.sendCall(chargerId, 'RemoteStartTransaction', {
      idTag,
      connectorId
    });

    return messageId;
  }

  async remoteStopTransaction(chargerId, transactionId) {
    console.log(`🎮 Remote stop transaction for ${chargerId}`);
    
    const messageId = this.sendCall(chargerId, 'RemoteStopTransaction', {
      transactionId
    });

    return messageId;
  }

  async unlockConnector(chargerId, connectorId = 1) {
    console.log(`🔓 Unlock connector for ${chargerId}`);
    
    const messageId = this.sendCall(chargerId, 'UnlockConnector', {
      connectorId
    });

    return messageId;
  }

  async resetChargePoint(chargerId, type = 'Soft') {
    console.log(`🔄 Reset charge point ${chargerId} (${type})`);
    
    const messageId = this.sendCall(chargerId, 'Reset', {
      type
    });

    return messageId;
  }

  // Utility Methods
  handleDisconnection(chargePointId) {
    console.log(`❌ OCPP charge point disconnected: ${chargePointId}`);
    
    this.chargePoints.delete(chargePointId);
    this.updateChargerStatus(chargePointId, 'Unavailable', false);
  }

  handleError(chargePointId, error) {
    console.error(`❌ OCPP WebSocket error for ${chargePointId}:`, error);
  }

  sendBootNotificationResponse(chargePointId) {
    // This is handled in handleBootNotification when the charge point sends the request
  }

  getConnectedChargePoints() {
    return Array.from(this.chargePoints.keys());
  }

  getChargePointStatus(chargePointId) {
    return this.chargePoints.get(chargePointId);
  }

  getAllChargePointStatuses() {
    const statuses = {};
    this.chargePoints.forEach((value, key) => {
      statuses[key] = {
        status: value.status,
        connectedAt: value.connectedAt,
        lastHeartbeat: value.lastHeartbeat,
        currentTransaction: value.currentTransaction
      };
    });
    return statuses;
  }
}

module.exports = OCPPServer;

