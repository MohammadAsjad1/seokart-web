const logger = require('../config/logger');

class NotificationService {
  constructor() {
    this.socketService = null;
    this.initialized = false;
  }

  init(socketService) {
    this.socketService = socketService;
    this.initialized = true;
    logger.info('NotificationService initialized');
  }

  // Progress notifications
  emitProgress(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'crawl_progress', {
        type: 'progress_update',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting progress', error, userId);
    }
  }

  // Batch completion notifications
  emitBatchComplete(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'batch_complete', {
        type: 'batch_completed',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting batch complete', error, userId);
    }
  }

  // Batch progress notifications
  emitBatchProgress(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'batch_progress', {
        type: 'batch_progress',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting batch progress', error, userId);
    }
  }

  // Phase change notifications
  emitPhaseChange(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'phase_change', {
        type: 'phase_changed',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting phase change', error, userId);
    }
  }

  // Analysis completion notifications
  emitAnalysisComplete(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'analysis_complete', {
        type: 'analysis_completed',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting analysis complete', error, userId);
    }
  }

  // Error notifications
  emitError(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'crawl_error', {
        type: 'error',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting error notification', error, userId);
    }
  }

  // Warning notifications
  emitWarning(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'crawl_warning', {
        type: 'warning',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting warning', error, userId);
    }
  }

  // Status notifications
  emitStatus(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'crawl_status', {
        type: 'status_update',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting status', error, userId);
    }
  }

  // URL processing notifications
  emitUrlProcessed(userId, data) {
    if (!this.isReady()) return;
    
    try {
      // Only emit every 10th URL to avoid spam
      if (data.processed % 10 === 0 || data.processed === data.total) {
        this.socketService.emitToUser(userId, 'url_processed', {
          type: 'url_processed',
          timestamp: new Date().toISOString(),
          ...data
        });
      }
    } catch (error) {
      logger.error('Error emitting URL processed', error, userId);
    }
  }

  // Duplicate detection notifications
  emitDuplicatesFound(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'duplicates_found', {
        type: 'duplicates_detected',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting duplicates found', error, userId);
    }
  }

  // Broken links notifications
  emitBrokenLinksFound(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'broken_links_found', {
        type: 'broken_links_detected',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting broken links found', error, userId);
    }
  }

  // Grammar issues notifications
  emitGrammarIssuesFound(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'grammar_issues_found', {
        type: 'grammar_issues_detected',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting grammar issues found', error, userId);
    }
  }

  // Statistics notifications
  emitStatistics(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'crawl_statistics', {
        type: 'statistics_update',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting statistics', error, userId);
    }
  }

  // Final completion notification
  emitCrawlComplete(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'crawl_complete', {
        type: 'crawl_completed',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting crawl complete', error, userId);
    }
  }

  // Activity update notifications
  emitActivityUpdate(userId, data) {
    if (!this.isReady()) return;
    
    try {
      this.socketService.emitToUser(userId, 'activity_update', {
        type: 'activity_updated',
        timestamp: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      logger.error('Error emitting activity update', error, userId);
    }
  }

  // Bulk notification for multiple events
  emitBulk(userId, notifications) {
    if (!this.isReady() || !Array.isArray(notifications)) return;
    
    try {
      notifications.forEach(notification => {
        if (notification.type && notification.event) {
          this.socketService.emitToUser(userId, notification.event, {
            timestamp: new Date().toISOString(),
            ...notification.data
          });
        }
      });
    } catch (error) {
      logger.error('Error emitting bulk notifications', error, userId);
    }
  }

  // Helper method to check if service is ready
  isReady() {
    if (!this.initialized || !this.socketService) {
      logger.warn('NotificationService not initialized or socketService not available');
      return false;
    }
    return true;
  }

  // Get service status
  getStatus() {
    return {
      initialized: this.initialized,
      hasSocketService: !!this.socketService,
      ready: this.isReady()
    };
  }
}

// Create singleton instance
const notificationService = new NotificationService();

module.exports = notificationService;