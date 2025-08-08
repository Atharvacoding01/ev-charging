// ===== ENHANCED OCPP SERVER WITH PCB INTEGRATION =====
// backend/ocpp/ocpp-pcb-integration.js

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

class OCPPPCBIntegration {
  constructor(database) {
    this.db = database;
    this.pcbDevices = database.collection('pcbDevices');
    this.deviceCredentials = database.collection('deviceCredentials');
    this.deviceSessions = database.collection('deviceSessions');
    this.externalConnections = database.collection('externalConnections');
    
    // JWT secret for device authentication
    this.JWT_SECRET = process.env.OCPP_JWT_SECRET || 'your-secure-jwt-secret-here';
  }

  // ========== PCB DEVICE REGISTRATION ==========
  
  async registerPCBDevice(deviceData) {
    try {
      // Generate unique device credentials
      const deviceId = this.generateDeviceId();
      const apiKey = this.generateSecureToken(32);
      const deviceSecret = this.generateSecureToken(64);
      
      const pcbDevice = {
        deviceId,
        hardwareId: deviceData.hardwareId || null,
        chargePointId: deviceData.chargePointId,
        deviceName: deviceData.deviceName || `PCB-${deviceId}`,
        deviceType: 'PCB_CONTROLLER',
        firmwareVersion: deviceData.firmwareVersion || '1.0.0',
        hardwareVersion: deviceData.hardwareVersion || '1.0.0',
        
        // Connection credentials
        apiKey,
        deviceSecret,
        
        // OCPP connection details
        ocppEndpoint: `ws://localhost:8080/${deviceData.chargePointId}`,
        ocppProtocol: 'ocpp1.6',
        
        // Device capabilities
        capabilities: {
          canRemoteStart: true,
          canRemoteStop: true,
          canUnlock: true,
          canReset: true,
          supportsReservation: false,
          maxConnectors: deviceData.maxConnectors || 1
        },
        
        // Status tracking
        status: 'registered',
        isOnline: false,
        lastHeartbeat: null,
        lastConnection: null,
        
        // Security
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await this.pcbDevices.insertOne(pcbDevice);
      
      // Create device credentials record
      await this.createDeviceCredentials(deviceId, apiKey, deviceSecret);
      
      console.log(`✅ PCB Device registered: ${deviceId}`);
      return {
        deviceId,
        apiKey,
        connectionUrl: pcbDevice.ocppEndpoint,
        credentials: this.generateConnectionCredentials(deviceId)
      };
      
    } catch (error) {
      console.error('❌ Error registering PCB device:', error);
      throw error;
    }
  }

  // ========== CREDENTIAL GENERATION ==========
  
  generateDeviceId() {
    return 'PCB_' + crypto.randomBytes(8).toString('hex').toUpperCase();
  }

  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  async createDeviceCredentials(deviceId, apiKey, deviceSecret) {
    const credentials = {
      deviceId,
      apiKey,
      deviceSecret: crypto.createHash('sha256').update(deviceSecret).digest('hex'), // Hash the secret
      
      // OCPP specific credentials
      ocppUsername: deviceId,
      ocppPassword: this.generateSecureToken(16),
      
      // External API access
      externalApiToken: this.generateJWT(deviceId),
      
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
    };

    await this.deviceCredentials.insertOne(credentials);
    return credentials;
  }

  generateJWT(deviceId, expiresIn = '1y') {
    return jwt.sign(
      { 
        deviceId, 
        type: 'pcb_device',
        permissions: ['ocpp_connect', 'status_update', 'remote_control']
      },
      this.JWT_SECRET,
      { expiresIn }
    );
  }

  generateConnectionCredentials(deviceId) {
    return {
      websocketUrl: `ws://localhost:8080/${deviceId}`,
      authHeaders: {
        'Authorization': `Bearer ${this.generateJWT(deviceId)}`,
        'X-Device-ID': deviceId
      },
      ocppProtocol: 'ocpp1.6'
    };
  }

  // ========== PCB AUTHENTICATION ==========
  
  async authenticatePCBDevice(apiKey, deviceSecret = null) {
    try {
      const device = await this.pcbDevices.findOne({ apiKey, isActive: true });
      
      if (!device) {
        throw new Error('Invalid API key');
      }

      if (deviceSecret) {
        const credentials = await this.deviceCredentials.findOne({ deviceId: device.deviceId });
        const hashedSecret = crypto.createHash('sha256').update(deviceSecret).digest('hex');
        
        if (!credentials || credentials.deviceSecret !== hashedSecret) {
          throw new Error('Invalid device secret');
        }
      }

      // Update last connection
      await this.pcbDevices.updateOne(
        { deviceId: device.deviceId },
        { 
          $set: { 
            lastConnection: new Date(),
            isOnline: true,
            updatedAt: new Date()
          } 
        }
      );

      return device;
    } catch (error) {
      console.error('❌ PCB authentication failed:', error);
      throw error;
    }
  }

  async verifyJWT(token) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET);
      const device = await this.pcbDevices.findOne({ 
        deviceId: decoded.deviceId, 
        isActive: true 
      });
      
      if (!device) {
        throw new Error('Device not found or inactive');
      }

      return { device, decoded };
    } catch (error) {
      console.error('❌ JWT verification failed:', error);
      throw error;
    }
  }

  // ========== EXTERNAL WEBSITE INTEGRATION ==========
  
  async generateWebsiteCredentials(websiteData) {
    try {
      const connectionId = this.generateSecureToken(16);
      const apiSecret = this.generateSecureToken(32);
      
      const connection = {
        connectionId,
        websiteName: websiteData.websiteName,
        websiteUrl: websiteData.websiteUrl,
        contactEmail: websiteData.contactEmail,
        
        // API credentials
        apiKey: this.generateSecureToken(24),
        apiSecret,
        
        // JWT for external access
        accessToken: this.generateExternalJWT(connectionId),
        
        // Permissions
        permissions: websiteData.permissions || [
          'read_charge_points',
          'read_transactions',
          'remote_start',
          'remote_stop'
        ],
        
        // Rate limiting
        rateLimit: {
          requestsPerMinute: websiteData.rateLimit || 100,
          requestsPerHour: websiteData.hourlyLimit || 1000
        },
        
        // Status
        isActive: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      };

      await this.externalConnections.insertOne(connection);
      
      console.log(`✅ External website credentials generated: ${connectionId}`);
      return {
        connectionId,
        apiKey: connection.apiKey,
        apiSecret,
        accessToken: connection.accessToken,
        endpoints: this.generateApiEndpoints()
      };
      
    } catch (error) {
      console.error('❌ Error generating website credentials:', error);
      throw error;
    }
  }

  generateExternalJWT(connectionId, expiresIn = '1y') {
    return jwt.sign(
      { 
        connectionId, 
        type: 'external_website',
        permissions: ['api_access', 'webhook_receive']
      },
      this.JWT_SECRET,
      { expiresIn }
    );
  }

  generateApiEndpoints() {
    const baseUrl = process.env.API_BASE_URL || 'https://your-domain.com/api';
    
    return {
      chargePoints: `${baseUrl}/external/charge-points`,
      transactions: `${baseUrl}/external/transactions`,
      remoteStart: `${baseUrl}/external/remote-start`,
      remoteStop: `${baseUrl}/external/remote-stop`,
      status: `${baseUrl}/external/status`,
      webhook: `${baseUrl}/external/webhook`
    };
  }

  // ========== PCB COMMUNICATION PROTOCOLS ==========
  
  async handlePCBCommand(deviceId, command, parameters = {}) {
    try {
      const device = await this.pcbDevices.findOne({ deviceId, isActive: true });
      if (!device) {
        throw new Error('Device not found');
      }

      const commandData = {
        deviceId,
        command,
        parameters,
        timestamp: new Date(),
        status: 'pending'
      };

      // Store command for tracking
      await this.db.collection('deviceCommands').insertOne(commandData);

      switch (command) {
        case 'START_CHARGING':
          return await this.sendStartChargingCommand(device, parameters);
          
        case 'STOP_CHARGING':
          return await this.sendStopChargingCommand(device, parameters);
          
        case 'UNLOCK_CONNECTOR':
          return await this.sendUnlockCommand(device, parameters);
          
        case 'UPDATE_STATUS':
          return await this.requestStatusUpdate(device);
          
        case 'RESET_DEVICE':
          return await this.sendResetCommand(device, parameters.type || 'Soft');
          
        default:
          throw new Error(`Unknown command: ${command}`);
      }
      
    } catch (error) {
      console.error(`❌ Error handling PCB command ${command}:`, error);
      throw error;
    }
  }

  async sendStartChargingCommand(device, parameters) {
    // Implementation for starting charging via PCB
    const payload = {
      connectorId: parameters.connectorId || 1,
      idTag: parameters.authTag || parameters.orderId,
      chargingProfile: parameters.chargingProfile || null
    };

    console.log(`🔌 Sending start charging command to PCB ${device.deviceId}`);
    return { command: 'START_CHARGING', status: 'sent', payload };
  }

  async sendStopChargingCommand(device, parameters) {
    const payload = {
      transactionId: parameters.transactionId,
      reason: parameters.reason || 'Local'
    };

    console.log(`🛑 Sending stop charging command to PCB ${device.deviceId}`);
    return { command: 'STOP_CHARGING', status: 'sent', payload };
  }

  // ========== STATUS MONITORING ==========
  
  async updatePCBStatus(deviceId, statusData) {
    try {
      const updateData = {
        ...statusData,
        lastHeartbeat: new Date(),
        isOnline: true,
        updatedAt: new Date()
      };

      await this.pcbDevices.updateOne(
        { deviceId },
        { $set: updateData }
      );

      // Store status history
      await this.db.collection('deviceStatusHistory').insertOne({
        deviceId,
        status: statusData,
        timestamp: new Date()
      });

      return { success: true };
    } catch (error) {
      console.error('❌ Error updating PCB status:', error);
      throw error;
    }
  }

  async getPCBDevices(includeOffline = false) {
    try {
      const query = includeOffline ? {} : { isOnline: true };
      return await this.pcbDevices.find(query).sort({ createdAt: -1 }).toArray();
    } catch (error) {
      console.error('❌ Error getting PCB devices:', error);
      throw error;
    }
  }

  // ========== UTILITY METHODS ==========
  
  async revokePCBDevice(deviceId) {
    try {
      await this.pcbDevices.updateOne(
        { deviceId },
        { 
          $set: { 
            isActive: false, 
            revokedAt: new Date(),
            updatedAt: new Date()
          } 
        }
      );

      await this.deviceCredentials.updateOne(
        { deviceId },
        { $set: { isRevoked: true, revokedAt: new Date() } }
      );

      console.log(`✅ PCB device revoked: ${deviceId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error revoking PCB device:', error);
      throw error;
    }
  }

  async refreshDeviceCredentials(deviceId) {
    try {
      const newApiKey = this.generateSecureToken(32);
      const newSecret = this.generateSecureToken(64);
      const newToken = this.generateJWT(deviceId);

      await this.pcbDevices.updateOne(
        { deviceId },
        { 
          $set: { 
            apiKey: newApiKey,
            updatedAt: new Date()
          } 
        }
      );

      await this.deviceCredentials.updateOne(
        { deviceId },
        {
          $set: {
            apiKey: newApiKey,
            deviceSecret: crypto.createHash('sha256').update(newSecret).digest('hex'),
            externalApiToken: newToken,
            updatedAt: new Date()
          }
        }
      );

      return {
        deviceId,
        apiKey: newApiKey,
        deviceSecret: newSecret,
        accessToken: newToken
      };
    } catch (error) {
      console.error('❌ Error refreshing device credentials:', error);
      throw error;
    }
  }
}

module.exports = OCPPPCBIntegration;