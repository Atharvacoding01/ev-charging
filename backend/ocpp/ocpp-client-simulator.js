const WebSocket = require('ws');

class OCPPClientSimulator {
  constructor(chargePointId, serverUrl = 'ws://localhost:8080/ocpp') {
    this.chargePointId = chargePointId;
    this.serverUrl = `${serverUrl}/${chargePointId}`;
    this.ws = null;
    this.heartbeatInterval = null;
    this.currentTransaction = null;
  }

  connect() {
    console.log(`🔌 Connecting OCPP client: ${this.chargePointId}`);
    
    this.ws = new WebSocket(this.serverUrl, ['ocpp1.6']);
    
    this.ws.on('open', () => {
      console.log(`✅ Connected: ${this.chargePointId}`);
      this.sendBootNotification();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(JSON.parse(data.toString()));
    });

    this.ws.on('close', () => {
      console.log(`❌ Disconnected: ${this.chargePointId}`);
      this.stopHeartbeat();
    });
  }

  sendBootNotification() {
    this.sendCall('BootNotification', {
      chargePointVendor: 'TestVendor',
      chargePointModel: 'TestModel',
      chargePointSerialNumber: this.chargePointId,
      firmwareVersion: '1.0.0'
    });
  }

  startHeartbeat(interval = 300) {
    this.heartbeatInterval = setInterval(() => {
      this.sendCall('Heartbeat', {});
    }, interval * 1000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  sendCall(action, payload) {
    const messageId = Date.now().toString();
    const message = [2, messageId, action, payload];
    this.ws.send(JSON.stringify(message));
    console.log(`📤 Sent ${action}:`, payload);
    return messageId;
  }

  sendCallResult(messageId, payload) {
    const message = [3, messageId, payload];
    this.ws.send(JSON.stringify(message));
    console.log(`📤 Sent result for ${messageId}`);
  }

  handleMessage(message) {
    const [messageType, messageId, action, payload] = message;
    
    console.log(`📥 Received:`, { messageType, messageId, action, payload });

    if (messageType === 2) { // CALL
      this.handleCall(messageId, action, payload);
    } else if (messageType === 3) { // CALLRESULT
      this.handleCallResult(messageId, payload);
    }
  }

  handleCall(messageId, action, payload) {
    switch (action) {
      case 'RemoteStartTransaction':
        this.handleRemoteStartTransaction(messageId, payload);
        break;
      case 'RemoteStopTransaction':
        this.handleRemoteStopTransaction(messageId, payload);
        break;
      case 'UnlockConnector':
        this.handleUnlockConnector(messageId, payload);
        break;
      case 'Reset':
        this.handleReset(messageId, payload);
        break;
      default:
        console.log(`⚠️ Unknown action: ${action}`);
        this.sendCallError(messageId, 'NotSupported', 'Action not supported');
    }
  }

  handleCallResult(messageId, payload) {
    console.log(`✅ Call result for ${messageId}:`, payload);
    
    // Start heartbeat after boot notification response
    if (payload.interval) {
      this.startHeartbeat(payload.interval);
    }
  }

  handleRemoteStartTransaction(messageId, payload) {
    console.log(`▶️ Remote start transaction:`, payload);
    
    // Simulate starting transaction
    this.currentTransaction = Date.now().toString();
    
    this.sendCallResult(messageId, { status: 'Accepted' });
    
    // Send status notification
    setTimeout(() => {
      this.sendCall('StatusNotification', {
        connectorId: payload.connectorId || 1,
        status: 'Charging',
        errorCode: 'NoError'
      });
    }, 1000);

    // Send start transaction
    setTimeout(() => {
      this.sendCall('StartTransaction', {
        connectorId: payload.connectorId || 1,
        idTag: payload.idTag,
        meterStart: Math.floor(Math.random() * 1000),
        timestamp: new Date().toISOString()
      });
    }, 2000);

    // Simulate meter values during charging
    this.startMeterValueSimulation();
  }

  handleRemoteStopTransaction(messageId, payload) {
    console.log(`⏹️ Remote stop transaction:`, payload);
    
    this.sendCallResult(messageId, { status: 'Accepted' });
    
    // Send stop transaction
    setTimeout(() => {
      this.sendCall('StopTransaction', {
        transactionId: this.currentTransaction,
        meterStop: Math.floor(Math.random() * 2000) + 1000,
        timestamp: new Date().toISOString(),
        reason: 'Remote'
      });
      
      this.currentTransaction = null;
      this.stopMeterValueSimulation();
    }, 1000);

    // Send status notification
    setTimeout(() => {
      this.sendCall('StatusNotification', {
        connectorId: 1,
        status: 'Available',
        errorCode: 'NoError'
      });
    }, 2000);
  }

  handleUnlockConnector(messageId, payload) {
    console.log(`🔓 Unlock connector:`, payload);
    this.sendCallResult(messageId, { status: 'Unlocked' });
  }

  handleReset(messageId, payload) {
    console.log(`🔄 Reset:`, payload);
    this.sendCallResult(messageId, { status: 'Accepted' });
    
    // Simulate reset by disconnecting and reconnecting
    setTimeout(() => {
      this.ws.close();
      setTimeout(() => this.connect(), 2000);
    }, 1000);
  }

  sendCallError(messageId, errorCode, errorDescription) {
    const message = [4, messageId, errorCode, errorDescription, {}];
    this.ws.send(JSON.stringify(message));
  }

  startMeterValueSimulation() {
    this.meterInterval = setInterval(() => {
      if (this.currentTransaction) {
        this.sendCall('MeterValues', {
          connectorId: 1,
          transactionId: this.currentTransaction,
          meterValue: [{
            timestamp: new Date().toISOString(),
            sampledValue: [{
              value: (Math.random() * 10 + 5).toFixed(2),
              context: 'Sample.Periodic',
              measurand: 'Energy.Active.Import.Register',
              unit: 'kWh'
            }]
          }]
        });
      }
    }, 30000); // Send meter values every 30 seconds
  }

  stopMeterValueSimulation() {
    if (this.meterInterval) {
      clearInterval(this.meterInterval);
      this.meterInterval = null;
    }
  }

  disconnect() {
    this.stopHeartbeat();
    this.stopMeterValueSimulation();
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Usage example:
// const client = new OCPPClientSimulator('CHARGER_001');
// client.connect();

module.exports = OCPPClientSimulator;
