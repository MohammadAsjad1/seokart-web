// controllers/health-controller.js - NEW FILE OR ADD TO EXISTING

const { scraperService } = require("../services/scraper-service");
const crashRecoveryService = require("../services/crash-recovery-service");
const { UserActivity } = require("../models/activity-models");

const getHealthStatus = async (req, res) => {
  try {
    await scraperService.initialize();

    const health = await scraperService.getSystemHealth();

    // ADD CRASH RECOVERY STATUS
    const activeJobs = await UserActivity.countDocuments({
      status: { $in: ["processing", "analyzing"] }
    });

    const stalledJobs = await UserActivity.countDocuments({
      status: { $in: ["processing", "analyzing"] },
      lastHeartbeat: { $lt: new Date(Date.now() - 30000) }
    });

    const crashRecoveredJobs = await UserActivity.countDocuments({
      crashRecovered: true
    });

    const enhancedHealth = {
      ...health,
      crashRecovery: {
        serverInstance: crashRecoveryService.getInstanceId(),
        activeJobs,
        stalledJobs,
        crashRecoveredTotal: crashRecoveredJobs,
        stalledMonitorActive: true
      }
    };

    res.status(200).json(enhancedHealth);
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      error: error.message
    });
  }
};

// ADD TO YOUR ROUTES FILE
// router.get('/health', getHealthStatus);

module.exports = { getHealthStatus };