const winston = require('winston');
const path = require('path');

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  performance: 4
};

// Define colors for console output
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  performance: 'magenta'
};

winston.addColors(logColors);

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, userId, stack }) => {
    const userInfo = userId ? ` [User:${userId}]` : '';
    const errorStack = stack ? `\n${stack}` : '';
    return `${timestamp} [${level.toUpperCase()}]${userInfo} ${message}${errorStack}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create transports array
const transports = [];

// Console transport (always enabled in development)
if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_CONSOLE_LOGS === 'true') {
  transports.push(
    new winston.transports.Console({
      level: process.env.LOG_LEVEL || 'info',
      format: consoleFormat,
      handleExceptions: true,
      handleRejections: true
    })
  );
}

// File transports (enabled in production or when explicitly configured)
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_FILE_LOGS === 'true') {
  const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  
  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      level: 'info',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true
    })
  );
  
  // Error log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
  
  // Performance log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'performance.log'),
      level: 'performance',
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 3
    })
  );
}

// Create the logger instance
const logger = winston.createLogger({
  levels: logLevels,
  transports,
  exitOnError: false
});

// Create wrapper class for enhanced functionality
class ScraperLogger {
  constructor(winstonLogger) {
    this.winston = winstonLogger;
    this.performanceTimers = new Map();
  }

  info(message, userId = null, metadata = {}) {
    this.winston.info(message, { userId, ...metadata });
  }

  warn(message, userId = null, metadata = {}) {
    this.winston.warn(message, { userId, ...metadata });
  }

  error(message, error = null, userId = null, metadata = {}) {
    const errorData = { userId, ...metadata };
    
    if (error instanceof Error) {
      errorData.error = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
      this.winston.error(message, errorData);
    } else if (typeof error === 'string') {
      this.winston.error(`${message}: ${error}`, errorData);
    } else {
      this.winston.error(message, errorData);
    }
  }

  debug(message, userId = null, metadata = {}) {
    this.winston.debug(message, { userId, ...metadata });
  }

  // Performance logging
  performance(message, startTime = null, userId = null, metadata = {}) {
    const perfData = { userId, ...metadata };
    
    if (startTime) {
      const duration = Date.now() - startTime;
      perfData.duration = duration;
      message = `${message} (${duration}ms)`;
    }
    
    this.winston.log('performance', message, perfData);
  }

  // Start a performance timer
  startTimer(timerName, userId = null) {
    this.performanceTimers.set(timerName, {
      startTime: Date.now(),
      userId
    });
  }

  // End a performance timer and log
  endTimer(timerName, message = null, metadata = {}) {
    const timer = this.performanceTimers.get(timerName);
    if (!timer) {
      this.warn(`Timer '${timerName}' not found`);
      return 0;
    }

    const duration = Date.now() - timer.startTime;
    this.performanceTimers.delete(timerName);

    const logMessage = message || `Timer '${timerName}' completed`;
    this.performance(logMessage, timer.startTime, timer.userId, metadata);

    return duration;
  }

  // Log HTTP requests
  logRequest(method, url, statusCode, responseTime, userId = null) {
    const level = statusCode >= 400 ? 'warn' : 'info';
    const message = `${method} ${url} ${statusCode}`;
    
    this.winston.log(level, message, {
      userId,
      method,
      url,
      statusCode,
      responseTime,
      type: 'http_request'
    });
  }

  // Log scraping results
  logScrapeResult(url, success, responseTime, errorMessage = null, userId = null) {
    const level = success ? 'info' : 'warn';
    const status = success ? 'SUCCESS' : 'FAILED';
    const message = `[SCRAPE] ${status}: ${url}`;
    
    this.winston.log(level, message, {
      userId,
      url,
      success,
      responseTime,
      errorMessage,
      type: 'scrape_result'
    });
  }

  // Log job progress
  logJobProgress(jobId, phase, progress, message, userId = null) {
    this.info(`[JOB ${jobId}] ${phase}: ${progress}% - ${message}`, userId, {
      jobId,
      phase,
      progress,
      type: 'job_progress'
    });
  }

  // Log system metrics
  logSystemMetrics(metrics) {
    this.winston.log('performance', 'System metrics', {
      ...metrics,
      type: 'system_metrics'
    });
  }

  // Create child logger with default context
  child(defaultContext = {}) {
    const childLogger = Object.create(this);
    childLogger.defaultContext = defaultContext;
    
    // Override methods to include default context
    ['info', 'warn', 'error', 'debug', 'performance'].forEach(method => {
      childLogger[method] = (message, userId = null, metadata = {}) => {
        this[method](message, userId || defaultContext.userId, {
          ...defaultContext,
          ...metadata
        });
      };
    });
    
    return childLogger;
  }

  // Get current log level
  getLevel() {
    return this.winston.level;
  }

  // Set log level
  setLevel(level) {
    this.winston.level = level;
    this.winston.transports.forEach(transport => {
      if (transport.level) {
        transport.level = level;
      }
    });
  }

  // Flush all transports (useful for testing)
  async flush() {
    const promises = this.winston.transports.map(transport => {
      if (transport.close) {
        return new Promise(resolve => {
          transport.close(() => resolve());
        });
      }
      return Promise.resolve();
    });
    
    await Promise.all(promises);
  }
}

// Create and export the enhanced logger
const scraperLogger = new ScraperLogger(logger);

// Add uncaught exception handling
process.on('uncaughtException', (error) => {
  scraperLogger.error('Uncaught Exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  scraperLogger.error('Unhandled Promise Rejection', reason);
});

module.exports = scraperLogger;