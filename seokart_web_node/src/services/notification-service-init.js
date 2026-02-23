// services/notification-service-init.js
const notificationService = require('./notification-service');
const logger = require('../config/logger');

class NotificationServiceInit {
  static initialize(socketService) {
    try {
      if (socketService && typeof socketService.emitToUser === 'function') {
        notificationService.init(socketService);
        logger.info('NotificationService initialized successfully');
        return notificationService;
      } else if (socketService && typeof socketService.emit === 'function') {
        // Wrap the socket service if it doesn't have emitToUser method
        const wrappedSocketService = {
          emitToUser: (userId, event, data) => {
            try {
              // Try different emission methods
              if (typeof socketService.to === 'function') {
                socketService.to(userId).emit(event, data);
              } else if (typeof socketService.emit === 'function') {
                socketService.emit(event, { userId, ...data });
              } else {
                logger.warn('No suitable socket emission method found');
              }
            } catch (error) {
              logger.error('Error in wrapped socket emission', error);
            }
          }
        };
        
        notificationService.init(wrappedSocketService);
        logger.info('NotificationService initialized with wrapped socket service');
        return notificationService;
      } else {
        // Create a fallback service that just logs
        const fallbackService = createFallbackService();
        logger.warn('Created fallback notification service - socket service not available');
        return fallbackService;
      }
    } catch (error) {
      logger.error('Error initializing notification service', error);
      return createFallbackService();
    }
  }
}

function createFallbackService() {
  const fallbackMethods = [
    'emitProgress',
    'emitBatchComplete', 
    'emitBatchProgress',
    'emitPhaseChange',
    'emitAnalysisComplete',
    'emitError',
    'emitWarning',
    'emitStatus',
    'emitUrlProcessed',
    'emitDuplicatesFound',
    'emitBrokenLinksFound',
    'emitGrammarIssuesFound',
    'emitStatistics',
    'emitCrawlComplete',
    'emitActivityUpdate',
    'emitBulk'
  ];

  const fallbackService = {
    initialized: true,
    isReady: () => true,
    getStatus: () => ({ initialized: true, hasSocketService: false, ready: true })
  };

  fallbackMethods.forEach(method => {
    fallbackService[method] = (userId, data) => {
      logger.debug(`Fallback notification: ${method}`, { userId, data: Object.keys(data || {}) });
    };
  });

  return fallbackService;
}

module.exports = NotificationServiceInit;