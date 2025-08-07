// ===== OCPP CMS CONFIGURATION MANAGER =====
// backend/ocpp/ocpp-cms-config.js

const { ObjectId } = require('mongodb');

class OCPPCMSConfig {
  constructor(database) {
    this.db = database;
    this.ocppConfigs = database.collection('ocppConfigs');
    this.chargePoints = database.collection('chargePoints');
    this.transactions = database.collection('ocppTransactions');
    this.meterValues = database.collection('ocppMeterValues');
    this.logs = database.collection('ocppLogs');
  }

  // Initialize default OCPP configuration
  async initializeDefaultConfig() {
    try {
      const existingConfig = await this.ocppConfigs.findOne({ type: 'default' });
      
      if (!existingConfig) {
        const defaultConfig = {
          type: 'default',
          websocketUrl: 'ws://localhost:8080',
          protocol: 'ocpp1.6',
          heartbeatInterval: 300,
          meterValueSampleInterval: 60,
          clockAlignedDataInterval: 900,
          connectionTimeOut: 60,
          getConfigurationMaxKeys: 50,
          localAuthorizeOffline: true,
          localPreAuthorize: false,
          maxEnergyOnInvalidId: 0,
          meterValuesAlignedData: ['Energy.Active.Import.Register'],
          meterValuesSampledData: ['Energy.Active.Import.Register', 'Power.Active.Import', 'Current.Import', 'Voltage'],
          numberOfConnectors: 1,
          resetRetries: 3,
          connectorPhaseRotation: 'RST',
          stopTransactionOnEVSideDisconnect: true,
          stopTransactionOnInvalidId: true,
          unlockConnectorOnEVSideDisconnect: true,
          authorizationCacheEnabled: true,
          authorizationCacheLifeTime: 86400,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await this.ocppConfigs.insertOne(defaultConfig);
        console.log('✅ Default OCPP configuration initialized');
        return defaultConfig;
      }
      
      return existingConfig;
    } catch (error) {
      console.error('❌ Error initializing OCPP config:', error);
      throw error;
    }
  }

  // Get OCPP configuration
  async getConfig(configId = null) {
    try {
      if (configId && ObjectId.isValid(configId)) {
        return await this.ocppConfigs.findOne({ _id: new ObjectId(configId) });
      } else {
        return await this.ocppConfigs.findOne({ type: 'default' });
      }
    } catch (error) {
      console.error('❌ Error getting OCPP config:', error);
      throw error;
    }
  }

  // Update OCPP configuration
  async updateConfig(configData, configId = null) {
    try {
      const updateData = {
        ...configData,
        updatedAt: new Date()
      };

      let result;
      if (configId && ObjectId.isValid(configId)) {
        result = await this.ocppConfigs.updateOne(
          { _id: new ObjectId(configId) },
          { $set: updateData }
        );
      } else {
        result = await this.ocppConfigs.updateOne(
          { type: 'default' },
          { $set: updateData },
          { upsert: true }
        );
      }

      console.log('✅ OCPP configuration updated');
      return result;
    } catch (error) {
      console.error('❌ Error updating OCPP config:', error);
      throw error;
    }
  }

  // Register new charge point
  async registerChargePoint(chargePointData) {
    try {
      const chargePointDoc = {
        chargePointId: chargePointData.chargePointId,
        vendor: chargePointData.vendor || 'Unknown',
        model: chargePointData.model || 'Unknown',
        serialNumber: chargePointData.serialNumber || '',
        firmwareVersion: chargePointData.firmwareVersion || '',
        numberOfConnectors: chargePointData.numberOfConnectors || 1,
        status: 'Offline',
        lastHeartbeat: null,
        registeredAt: new Date(),
        updatedAt: new Date(),
        connectors: []
      };

      // Initialize connectors
      for (let i = 1; i <= chargePointDoc.numberOfConnectors; i++) {
        chargePointDoc.connectors.push({
          connectorId: i,
          status: 'Unavailable',
          errorCode: 'NoError',
          currentTransaction: null,
          lastStatusUpdate: new Date()
        });
      }

      const result = await this.chargePoints.insertOne(chargePointDoc);
      console.log(`✅ Charge point registered: ${chargePointData.chargePointId}`);
      return result;
    } catch (error) {
      console.error('❌ Error registering charge point:', error);
      throw error;
    }
  }

  // Update charge point status
  async updateChargePointStatus(chargePointId, statusData) {
    try {
      const updateData = {
        ...statusData,
        lastHeartbeat: new Date(),
        updatedAt: new Date()
      };

      const result = await this.chargePoints.updateOne(
        { chargePointId },
        { $set: updateData }
      );

      return result;
    } catch (error) {
      console.error('❌ Error updating charge point status:', error);
      throw error;
    }
  }

  // Update connector status
  async updateConnectorStatus(chargePointId, connectorId, status, errorCode = 'NoError') {
    try {
      const result = await this.chargePoints.updateOne(
        { chargePointId, 'connectors.connectorId': connectorId },
        {
          $set: {
            'connectors.$.status': status,
            'connectors.$.errorCode': errorCode,
            'connectors.$.lastStatusUpdate': new Date(),
            updatedAt: new Date()
          }
        }
      );

      console.log(`✅ Connector ${connectorId} status updated: ${status}`);
      return result;
    } catch (error) {
      console.error('❌ Error updating connector status:', error);
      throw error;
    }
  }

  // Start transaction
  async startTransaction(transactionData) {
    try {
      const transaction = {
        transactionId: transactionData.transactionId,
        chargePointId: transactionData.chargePointId,
        connectorId: transactionData.connectorId,
        idTag: transactionData.idTag,
        meterStart: transactionData.meterStart || 0,
        startTimestamp: new Date(transactionData.timestamp),
        status: 'active',
        orderId: transactionData.orderId || null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await this.transactions.insertOne(transaction);

      // Update connector with current transaction
      await this.chargePoints.updateOne(
        { chargePointId: transactionData.chargePointId, 'connectors.connectorId': transactionData.connectorId },
        {
          $set: {
            'connectors.$.currentTransaction': transactionData.transactionId,
            'connectors.$.status': 'Charging',
            updatedAt: new Date()
          }
        }
      );

      console.log(`✅ Transaction started: ${transactionData.transactionId}`);
      return result;
    } catch (error) {
      console.error('❌ Error starting transaction:', error);
      throw error;
    }
  }

  // Stop transaction
  async stopTransaction(transactionId, meterStop, reason = 'Local') {
    try {
      const stopTimestamp = new Date();
      
      const result = await this.transactions.updateOne(
        { transactionId },
        {
          $set: {
            meterStop,
            stopTimestamp,
            stopReason: reason,
            status: 'completed',
            energyDelivered: meterStop - (await this.getTransaction(transactionId)).meterStart,
            updatedAt: new Date()
          }
        }
      );

      // Clear current transaction from connector
      const transaction = await this.getTransaction(transactionId);
      if (transaction) {
        await this.chargePoints.updateOne(
          { chargePointId: transaction.chargePointId, 'connectors.connectorId': transaction.connectorId },
          {
            $set: {
              'connectors.$.currentTransaction': null,
              'connectors.$.status': 'Available',
              updatedAt: new Date()
            }
          }
        );
      }

      console.log(`✅ Transaction stopped: ${transactionId}`);
      return result;
    } catch (error) {
      console.error('❌ Error stopping transaction:', error);
      throw error;
    }
  }

  // Get transaction by ID
  async getTransaction(transactionId) {
    try {
      return await this.transactions.findOne({ transactionId });
    } catch (error) {
      console.error('❌ Error getting transaction:', error);
      throw error;
    }
  }

  // Store meter values
  async storeMeterValues(meterData) {
    try {
      const meterValue = {
        chargePointId: meterData.chargePointId,
        connectorId: meterData.connectorId,
        transactionId: meterData.transactionId || null,
        timestamp: new Date(meterData.timestamp),
        sampledValues: meterData.sampledValues,
        createdAt: new Date()
      };

      const result = await this.meterValues.insertOne(meterValue);
      return result;
    } catch (error) {
      console.error('❌ Error storing meter values:', error);
      throw error;
    }
  }

  // Get all charge points
  async getAllChargePoints() {
    try {
      return await this.chargePoints.find({}).sort({ registeredAt: -1 }).toArray();
    } catch (error) {
      console.error('❌ Error getting charge points:', error);
      throw error;
    }
  }

  // Get charge point by ID
  async getChargePoint(chargePointId) {
    try {
      return await this.chargePoints.findOne({ chargePointId });
    } catch (error) {
      console.error('❌ Error getting charge point:', error);
      throw error;
    }
  }

  // Get active transactions
  async getActiveTransactions() {
    try {
      return await this.transactions.find({ status: 'active' }).toArray();
    } catch (error) {
      console.error('❌ Error getting active transactions:', error);
      throw error;
    }
  }

  // Log OCPP messages
  async logMessage(messageData) {
    try {
      const logEntry = {
        chargePointId: messageData.chargePointId,
        messageType: messageData.messageType,
        direction: messageData.direction, // 'incoming' or 'outgoing'
        messageId: messageData.messageId,
        action: messageData.action,
        payload: messageData.payload,
        timestamp: new Date(),
        createdAt: new Date()
      };

      await this.logs.insertOne(logEntry);
    } catch (error) {
      console.error('❌ Error logging OCPP message:', error);
    }
  }

  // Get logs
  async getLogs(chargePointId = null, limit = 100) {
    try {
      const query = chargePointId ? { chargePointId } : {};
      return await this.logs.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      console.error('❌ Error getting logs:', error);
      throw error;
    }
  }

  // Validate WebSocket URL
  validateWebSocketUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'ws:' || parsedUrl.protocol === 'wss:';
    } catch (error) {
      return false;
    }
  }

  // Generate charge point configuration
  async generateChargePointConfig(chargePointId) {
    try {
      const globalConfig = await this.getConfig();
      const chargePoint = await this.getChargePoint(chargePointId);
      
      if (!chargePoint) {
        throw new Error('Charge point not found');
      }

      return {
        chargePointId: chargePointId,
        websocketUrl: `${globalConfig.websocketUrl}/${chargePointId}`,
        protocol: globalConfig.protocol,
        heartbeatInterval: globalConfig.heartbeatInterval,
        meterValueSampleInterval: globalConfig.meterValueSampleInterval,
        numberOfConnectors: chargePoint.numberOfConnectors,
        connectorPhaseRotation: globalConfig.connectorPhaseRotation,
        authorizationCacheEnabled: globalConfig.authorizationCacheEnabled,
        meterValuesAlignedData: globalConfig.meterValuesAlignedData,
        meterValuesSampledData: globalConfig.meterValuesSampledData
      };
    } catch (error) {
      console.error('❌ Error generating charge point config:', error);
      throw error;
    }
  }
}

module.exports = OCPPCMSConfig;
