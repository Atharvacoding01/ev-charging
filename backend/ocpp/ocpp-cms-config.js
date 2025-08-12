// ===== OCPP CMS CONFIGURATION MANAGER =====
// backend/ocpp/ocpp-cms-config.js

import { ObjectId } from 'mongodb';

class OCPPCMSConfig {
  constructor(database) {
    this.db = database;
    this.chargePoints = database.collection('chargePoints');
    this.transactions = database.collection('transactions');
    this.users = database.collection('users');
    this.messages = database.collection('ocppMessages');
    this.config = database.collection('ocppConfig');
  }

  // Initialize default OCPP configuration
  async initializeDefaultConfig() {
    try {
      // Check if default config exists
      const existingConfig = await this.config.findOne({ type: 'default' });
      
      if (!existingConfig) {
        // Create default configuration
        await this.config.insertOne({
          type: 'default',
          heartbeatInterval: 300,
          connectionTimeout: 300,
          resetRetries: 3,
          createdAt: new Date(),
          defaultProfile: {
            vendors: ['Unknown'],
            firmwareVersions: ['1.0.0'],
            supported: {
              protocols: ['OCPP1.6J'],
              features: ['Heartbeat', 'StatusNotification']
            }
          }
        });
        console.log('✅ Default OCPP configuration initialized');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize default config:', error);
      throw error;
    }
  }

  // Get charge point by ID
  async getChargePoint(chargePointId) {
    return await this.chargePoints.findOne({ chargePointId });
  }

  // Update charge point status
  async updateChargePointStatus(chargePointId, status) {
    return await this.chargePoints.updateOne(
      { chargePointId },
      { 
        $set: { 
          ...status,
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );
  }

  // Register new charge point
  async registerChargePoint(data) {
    return await this.chargePoints.updateOne(
      { chargePointId: data.chargePointId },
      {
        $set: {
          ...data,
          registeredAt: new Date(),
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );
  }

  // Log OCPP messages
  async logMessage(messageData) {
    return await this.messages.insertOne({
      ...messageData,
      timestamp: new Date()
    });
  }

  // Update connector status
  async updateConnectorStatus(chargePointId, connectorId, status, errorCode = null) {
    return await this.chargePoints.updateOne(
      { chargePointId },
      {
        $set: {
          [`connectors.${connectorId}`]: {
            status,
            errorCode,
            lastUpdated: new Date()
          }
        }
      }
    );
  }

  // Start transaction
  async startTransaction(transactionData) {
    return await this.transactions.insertOne({
      ...transactionData,
      startTime: new Date(),
      status: 'Started'
    });
  }

  // Stop transaction
  async stopTransaction(transactionId, meterStop, reason) {
    return await this.transactions.updateOne(
      { transactionId },
      {
        $set: {
          meterStop,
          stopReason: reason,
          stopTime: new Date(),
          status: 'Completed'
        }
      }
    );
  }

  // Store meter values
  async storeMeterValues(meterData) {
    return await this.transactions.updateOne(
      { transactionId: meterData.transactionId },
      {
        $push: {
          meterValues: {
            ...meterData,
            timestamp: new Date()
          }
        }
      }
    );
  }
}

export default OCPPCMSConfig;
