const logger = require('../config/logger');

class MockSocketService {
  constructor() {
    this.connectedUsers = new Set();
    this.eventLog = [];
    this.maxLogSize = 1000;
  }

  // Mock user connection
  addUser(userId) {
    this.connectedUsers.add(userId);
    logger.debug(`Mock socket: User ${userId} connected`);
  }

  // Mock user disconnection
  removeUser(userId) {
    this.connectedUsers.delete(userId);
    logger.debug(`Mock socket: User ${userId} disconnected`);
  }

  // Mock emit to specific user
  emitToUser(userId, event, data) {
    try {
      if (this.connectedUsers.has(userId)) {
        // Log the event
        this.logEvent(userId, event, data);
        
        // In a real implementation, this would emit to the actual socket
        logger.debug(`Mock socket emit to ${userId}:`, { event, dataKeys: Object.keys(data || {}) });
        
        return true;
      } else {
        logger.debug(`Mock socket: User ${userId} not connected, event ${event} not sent`);
        return false;
      }
    } catch (error) {
      logger.error('Error in mock socket emit', error);
      return false;
    }
  }

  // Mock broadcast to all users
  broadcast(event, data) {
    try {
      let sentCount = 0;
      this.connectedUsers.forEach(userId => {
        if (this.emitToUser(userId, event, data)) {
          sentCount++;
        }
      });
      
      logger.debug(`Mock socket broadcast: ${event} sent to ${sentCount} users`);
      return sentCount;
    } catch (error) {
      logger.error('Error in mock socket broadcast', error);
      return 0;
    }
  }

  // Log events for debugging
  logEvent(userId, event, data) {
    const eventEntry = {
      timestamp: new Date().toISOString(),
      userId,
      event,
      data: data ? Object.keys(data) : [],
      dataSize: JSON.stringify(data || {}).length
    };

    this.eventLog.push(eventEntry);

    // Keep log size manageable
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }
  }

  // Get event log for debugging
  getEventLog(userId = null, limit = 50) {
    let events = this.eventLog;
    
    if (userId) {
      events = events.filter(event => event.userId === userId);
    }
    
    return events.slice(-limit);
  }

  // Get connected users
  getConnectedUsers() {
    return Array.from(this.connectedUsers);
  }

  // Get statistics
  getStats() {
    return {
      connectedUsers: this.connectedUsers.size,
      totalEvents: this.eventLog.length,
      recentEvents: this.eventLog.slice(-10).map(event => ({
        timestamp: event.timestamp,
        userId: event.userId,
        event: event.event
      }))
    };
  }

  // Clear event log
  clearEventLog() {
    this.eventLog = [];
    logger.debug('Mock socket event log cleared');
  }

  // Simulate real socket service methods
  to(userId) {
    return {
      emit: (event, data) => this.emitToUser(userId, event, data)
    };
  }

  emit(event, data) {
    return this.broadcast(event, data);
  }

  // For compatibility with different socket implementations
  in(room) {
    return this.to(room);
  }

  join(userId, room) {
    logger.debug(`Mock socket: User ${userId} joined room ${room}`);
    return true;
  }

  leave(userId, room) {
    logger.debug(`Mock socket: User ${userId} left room ${room}`);
    return true;
  }
}

// Create singleton instance
const mockSocketService = new MockSocketService();

module.exports = mockSocketService;