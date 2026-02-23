const mongoose = require('mongoose');
const logger = require('./logger');

class DatabaseManager {
  constructor() {
    this.isConnected = false;
    this.connection = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000; // 5 seconds
  }

  async connect() {
    if (this.isConnected) {
      logger.warn('Database already connected');
      return this.connection;
    }

    const mongoUri = this.buildConnectionString();
    const options = this.getConnectionOptions();

    try {
      logger.info('Connecting to database...');
      logger.debug(`Using connection string: ${mongoUri.replace(/\/\/.*@/, '//***:***@')}`); // Hide credentials in logs
      
      this.connection = await mongoose.connect(mongoUri, options);
      this.isConnected = true;
      this.retryCount = 0;

      this.setupEventHandlers();
      
      logger.info('✅ Database connected successfully');
      return this.connection;

    } catch (error) {
      logger.error('❌ Database connection failed', error);
      
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        logger.info(`Retrying database connection in ${this.retryDelay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
        
        await this.sleep(this.retryDelay);
        return this.connect();
      } else {
        logger.error('Max database connection retries exceeded');
        throw error;
      }
    }
  }

  buildConnectionString() {
    const {
      DB_HOST = 'localhost',
      DB_PORT = '27017',
      DB_NAME = 'seo_scraper',
      DB_USER,
      DB_PASSWORD,
      DB_URI,
      MONGO_URI
    } = process.env;

    if (MONGO_URI) {
      return MONGO_URI;
    }
    if (DB_URI) {
      return DB_URI;
    }

    // Build URI from components
    let uri = 'mongodb://';
    
    if (DB_USER && DB_PASSWORD) {
      uri += `${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@`;
    }
    
    uri += `${DB_HOST}:${DB_PORT}/${DB_NAME}`;
    
    return uri;
  }

  getConnectionOptions() {
    return {
      // Connection settings
      maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 10,
      minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE) || 2,
      maxIdleTimeMS: parseInt(process.env.DB_MAX_IDLE_TIME) || 30000,
      serverSelectionTimeoutMS: parseInt(process.env.DB_SERVER_SELECTION_TIMEOUT) || 10000,
      socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT) || 45000,
      connectTimeoutMS: parseInt(process.env.DB_CONNECT_TIMEOUT) || 10000,
      
      // Retry settings
      retryWrites: true,
      retryReads: true,
      
      // Buffering
      bufferCommands: false,
      
      // Topology monitoring
      heartbeatFrequencyMS: 10000,
      
      // Additional options
      appName: 'SEO-Scraper',
      readPreference: 'primary',
      writeConcern: {
        w: 'majority',
        j: true,
        wtimeoutMS: 10000
      }
    };
  }

  setupEventHandlers() {
    if (!this.connection) return;

    const db = this.connection.connection;

    db.on('connected', () => {
      logger.info('Database connection established');
      this.isConnected = true;
    });

    db.on('disconnected', () => {
      logger.warn('Database disconnected');
      this.isConnected = false;
    });

    db.on('reconnected', () => {
      logger.info('Database reconnected');
      this.isConnected = true;
    });

    db.on('error', (error) => {
      logger.error('Database connection error', error);
      this.isConnected = false;
      
      // Attempt to reconnect on error
      if (this.retryCount < this.maxRetries) {
        setTimeout(() => {
          this.connect().catch(err => {
            logger.error('Reconnection attempt failed', err);
          });
        }, this.retryDelay);
      }
    });

    db.on('close', () => {
      logger.warn('Database connection closed');
      this.isConnected = false;
    });

    // Monitor slow operations
    if (process.env.NODE_ENV === 'development') {
      mongoose.set('debug', (collectionName, method, query, doc) => {
        logger.debug(`Database query: ${collectionName}.${method}`, null, {
          collection: collectionName,
          method,
          query: JSON.stringify(query),
          doc: doc ? JSON.stringify(doc).substring(0, 100) : null
        });
      });
    }
  }

  async disconnect() {
    if (!this.isConnected) {
      logger.warn('Database not connected');
      return;
    }

    try {
      logger.info('Disconnecting from database...');
      await mongoose.disconnect();
      this.isConnected = false;
      logger.info('Database disconnected successfully');
    } catch (error) {
      logger.error('Error disconnecting from database', error);
      throw error;
    }
  }

  async getConnectionStatus() {
    if (!this.connection) {
      return {
        connected: false,
        readyState: 0,
        host: null,
        port: null,
        name: null
      };
    }

    const db = this.connection.connection;
    
    return {
      connected: this.isConnected,
      readyState: db.readyState,
      host: db.host,
      port: db.port,
      name: db.name,
      collections: Object.keys(db.collections),
      connectionCount: db.connections?.length || 0
    };
  }

  async getStats() {
    if (!this.isConnected) {
      return null;
    }

    try {
      const admin = this.connection.connection.db.admin();
      const stats = await admin.serverStatus();
      
      return {
        version: stats.version,
        uptime: stats.uptime,
        connections: stats.connections,
        network: stats.network,
        opcounters: stats.opcounters,
        memory: stats.mem
      };
    } catch (error) {
      logger.error('Error getting database stats', error);
      return null;
    }
  }

  async healthCheck() {
    if (!this.isConnected) {
      return { healthy: false, message: 'Not connected to database' };
    }

    try {
      // Simple ping to check connection
      await this.connection.connection.db.admin().ping();
      
      return { 
        healthy: true, 
        message: 'Database connection healthy',
        responseTime: Date.now()
      };
    } catch (error) {
      logger.error('Database health check failed', error);
      return { 
        healthy: false, 
        message: `Database health check failed: ${error.message}` 
      };
    }
  }

  // Create database indexes
  async createIndexes() {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }

    try {
      logger.info('Creating database indexes...');
      
      // Get all models and create their indexes
      const models = mongoose.models;
      const indexPromises = [];

      for (const modelName in models) {
        const model = models[modelName];
        if (model.createIndexes) {
          indexPromises.push(
            model.createIndexes().catch(error => {
              logger.warn(`Failed to create indexes for ${modelName}`, null, { error: error.message });
            })
          );
        }
      }

      await Promise.all(indexPromises);
      logger.info('Database indexes created successfully');
      
    } catch (error) {
      logger.error('Error creating database indexes', error);
      throw error;
    }
  }

  // Database maintenance operations
  async runMaintenance() {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }

    try {
      logger.info('Running database maintenance...');
      
      const db = this.connection.connection.db;
      
      // Get database stats before maintenance
      const statsBefore = await db.stats();
      
      // Run database commands
      const results = {
        compactCollections: [],
        reindexCollections: [],
        sizeBefore: statsBefore.dataSize,
        sizeAfter: 0
      };
      
      // Get all collections
      const collections = await db.listCollections().toArray();
      
      // Compact collections (be careful in production)
      if (process.env.ENABLE_DB_COMPACT === 'true') {
        for (const collection of collections) {
          try {
            await db.command({ compact: collection.name });
            results.compactCollections.push(collection.name);
          } catch (error) {
            logger.warn(`Failed to compact collection ${collection.name}`, null, { error: error.message });
          }
        }
      }
      
      // Get stats after maintenance
      const statsAfter = await db.stats();
      results.sizeAfter = statsAfter.dataSize;
      
      logger.info('Database maintenance completed', null, results);
      return results;
      
    } catch (error) {
      logger.error('Database maintenance failed', error);
      throw error;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create singleton instance
const databaseManager = new DatabaseManager();

// Export both the manager instance and convenience functions
module.exports = {
  databaseManager,
  
  // Convenience functions
  connect: () => databaseManager.connect(),
  disconnect: () => databaseManager.disconnect(),
  getStatus: () => databaseManager.getConnectionStatus(),
  getStats: () => databaseManager.getStats(),
  healthCheck: () => databaseManager.healthCheck(),
  createIndexes: () => databaseManager.createIndexes(),
  runMaintenance: () => databaseManager.runMaintenance(),
  
  // Direct access to mongoose for advanced usage
  mongoose
};