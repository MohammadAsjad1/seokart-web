const { server } = require("./app");
const dotenv = require('dotenv');
dotenv.config();
const { connect } = require("./config/database");
const rankTrackerScheduler = require('./utils/rankTrackerScheduler');
const mongoose = require('mongoose');
const PORT = process.env.PORT || 5000;
const axios = require('axios');
const https = require("https");
const crashRecoveryService = require("./services/crash-recovery-service");
const { scraperService } = require("./services/scraper-service");
const logger = require("./config/logger");

async function startServer() {
  try {
    // Connect to database
    await connect();
    console.log("✅ Database connected");

    // Initialize rank tracker scheduler
    await rankTrackerScheduler.init();
    console.log("✅ Rank tracker scheduler initialized");

    // Start the server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });

    await scraperService.initialize();
    logger.info("✅ Scraper service initialized");

    // Handle graceful shutdown
    const gracefulShutdown = async () => {
      console.log("🛑 Shutting down gracefully...");

      await crashRecoveryService.cleanupOnShutdown();
      
      // Stop rank tracker scheduler if it has a cleanup method
      if (rankTrackerScheduler.stop) {
        await rankTrackerScheduler.stop();
        console.log("✅ Rank tracker scheduler stopped");
      }
      
      server.close(() => {
        console.log("✅ Server closed");
        mongoose.connection.close(false, () => {
          console.log("✅ MongoDB disconnected");
          process.exit(0);
        });
      });

      // Force close after 30s
      setTimeout(() => {
        console.error("⚠️ Forced shutdown after timeout");
        process.exit(1);
      }, 30000);
    };

    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);

  } catch (error) {
    console.error("❌ Server startup failed", error);
    process.exit(1);
  }
}

startServer();