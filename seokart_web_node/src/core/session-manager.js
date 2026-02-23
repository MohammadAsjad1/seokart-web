const config = require('../config/scraper');
const logger = require('../config/logger');

class SessionManager {
  constructor() {
    this.userSessions = new Map(); // userId -> Set of jobIds
    this.sessionData = new Map(); // sessionId -> session details
    this.globalStats = {
      totalSessions: 0,
      activeSessions: 0,
      totalUsers: 0,
      activeUsers: 0
    };
  }

  createSession(userId, jobId) {
    const sessionId = `${userId}_${jobId}`;
    
    // Initialize user session tracking if not exists
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
      this.globalStats.totalUsers++;
      this.globalStats.activeUsers++;
    }

    // Add job to user's active sessions
    this.userSessions.get(userId).add(jobId);

    // Create session data
    const session = {
      sessionId,
      userId,
      jobId,
      startTime: Date.now(),
      lastActivity: Date.now(),
      status: 'active',
      stats: {
        pagesProcessed: 0,
        pagesSuccessful: 0,
        pagesFailed: 0,
        sitemapsProcessed: 0,
        duplicatesFound: 0,
        brokenLinksFound: 0
      }
    };

    this.sessionData.set(sessionId, session);
    this.globalStats.totalSessions++;
    this.globalStats.activeSessions++;

    logger.info(`Created session ${sessionId} for user ${userId}`, userId);
    return session;
  }

  getSession(sessionId) {
    const session = this.sessionData.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  updateSessionStats(sessionId, stats) {
    const session = this.sessionData.get(sessionId);
    if (session) {
      Object.assign(session.stats, stats);
      session.lastActivity = Date.now();
    }
  }

  endSession(userId, jobId) {
    const sessionId = `${userId}_${jobId}`;
    const session = this.sessionData.get(sessionId);
    
    if (session) {
      session.status = 'completed';
      session.endTime = Date.now();
      session.duration = session.endTime - session.startTime;
      
      this.globalStats.activeSessions--;
      logger.info(`Ended session ${sessionId} (${session.duration}ms)`, userId);
    }

    // Remove job from user's active sessions
    if (this.userSessions.has(userId)) {
      this.userSessions.get(userId).delete(jobId);
      
      // If user has no more active sessions, remove from active users
      if (this.userSessions.get(userId).size === 0) {
        this.userSessions.delete(userId);
        this.globalStats.activeUsers--;
      }
    }

    // Keep session data for a while for reference, but mark as completed
    // In production, you might want to move this to a database or cleanup after some time
  }

  getUserSessions(userId) {
    const userJobIds = this.userSessions.get(userId);
    if (!userJobIds) {
      return [];
    }

    const sessions = [];
    for (const jobId of userJobIds) {
      const sessionId = `${userId}_${jobId}`;
      const session = this.sessionData.get(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  isUserAtCapacity(userId) {
    const userJobIds = this.userSessions.get(userId);
    if (!userJobIds) {
      return false;
    }

    // Allow max 2 concurrent jobs per user
    const maxConcurrentPerUser = 2;
    return userJobIds.size >= maxConcurrentPerUser;
  }

  isSystemAtCapacity() {
    return this.globalStats.activeUsers >= config.concurrency.max_users;
  }

  getActiveSessionsForUser(userId) {
    const userJobIds = this.userSessions.get(userId) || new Set();
    return userJobIds.size;
  }

  getAllActiveSessions() {
    const activeSessions = [];
    
    for (const [sessionId, session] of this.sessionData.entries()) {
      if (session.status === 'active') {
        activeSessions.push({
          sessionId: session.sessionId,
          userId: session.userId,
          jobId: session.jobId,
          startTime: session.startTime,
          duration: Date.now() - session.startTime,
          stats: session.stats
        });
      }
    }

    return activeSessions;
  }

  cleanup() {
    const now = Date.now();
    const maxSessionAge = 24 * 60 * 60 * 1000; // 24 hours
    const staleSessions = [];

    // Find stale sessions
    for (const [sessionId, session] of this.sessionData.entries()) {
      const sessionAge = now - session.startTime;
      const timeSinceActivity = now - session.lastActivity;
      
      // Remove if session is very old or inactive for too long
      if (sessionAge > maxSessionAge || timeSinceActivity > 3600000) { // 1 hour inactive
        staleSessions.push(sessionId);
      }
    }

    // Clean up stale sessions
    for (const sessionId of staleSessions) {
      const session = this.sessionData.get(sessionId);
      if (session) {
        if (session.status === 'active') {
          this.endSession(session.userId, session.jobId);
        }
        this.sessionData.delete(sessionId);
      }
    }

    if (staleSessions.length > 0) {
      logger.info(`Cleaned up ${staleSessions.length} stale sessions`);
    }
  }

  getSessionsByStatus(status) {
    const sessions = [];
    
    for (const [sessionId, session] of this.sessionData.entries()) {
      if (session.status === status) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  getStats() {
    return {
      ...this.globalStats,
      sessionDetails: {
        activeSessions: this.getSessionsByStatus('active').length,
        completedSessions: this.getSessionsByStatus('completed').length,
        totalSessionsInMemory: this.sessionData.size
      },
      capacity: {
        isAtCapacity: this.isSystemAtCapacity(),
        usagePercentage: (this.globalStats.activeUsers / config.concurrency.max_users * 100).toFixed(1) + '%',
        maxUsers: config.concurrency.max_users
      }
    };
  }

  // Get detailed session information for monitoring
  getDetailedStats() {
    const stats = this.getStats();
    const activeSessions = this.getAllActiveSessions();
    
    // Calculate average session duration for active sessions
    const totalDuration = activeSessions.reduce((sum, session) => sum + session.duration, 0);
    const avgDuration = activeSessions.length > 0 ? totalDuration / activeSessions.length : 0;

    // Calculate total pages processed across all active sessions
    const totalPagesProcessed = activeSessions.reduce((sum, session) => sum + session.stats.pagesProcessed, 0);
    const totalPagesSuccessful = activeSessions.reduce((sum, session) => sum + session.stats.pagesSuccessful, 0);

    return {
      ...stats,
      performance: {
        avgSessionDuration: Math.round(avgDuration),
        totalPagesProcessed,
        totalPagesSuccessful,
        overallSuccessRate: totalPagesProcessed > 0 ? 
          (totalPagesSuccessful / totalPagesProcessed * 100).toFixed(2) + '%' : '0%'
      },
      activeSessions: activeSessions.map(session => ({
        ...session,
        durationMinutes: Math.round(session.duration / 60000)
      }))
    };
  }

  // Emergency cleanup - force end all sessions
  emergencyCleanup() {
    logger.warn('Emergency cleanup initiated - ending all active sessions');
    
    const activeSessionCount = this.globalStats.activeSessions;
    
    // End all active sessions
    for (const [sessionId, session] of this.sessionData.entries()) {
      if (session.status === 'active') {
        this.endSession(session.userId, session.jobId);
      }
    }

    // Clear all data
    this.userSessions.clear();
    this.sessionData.clear();
    
    // Reset stats
    this.globalStats.activeSessions = 0;
    this.globalStats.activeUsers = 0;

    logger.warn(`Emergency cleanup completed - ended ${activeSessionCount} sessions`);
  }
}

module.exports = SessionManager;