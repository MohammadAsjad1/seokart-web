const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const authRoutes = require("./routes/authRoutes");
const webpageRoutes = require("./routes/webpageRoutes");
const scraperRoutes = require("./routes/scraperRoutes");
const proxyRoutes = require("./routes/proxy-route");
const userPlanRoutes = require("./routes/userPlanRoutes");
const rankTrackerRoutes = require("./routes/rankTrackerRoutes");
const backlinkRoutes = require("./routes/backlinkRoute");
const cron = require("node-cron");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const {
  handleSitemapCrawl,
  checkCrawlStatus,
} = require("./controllers/scraperController");
const cookieParser = require("cookie-parser");
const crashRecoveryService = require("./services/crash-recovery-service");
const storeRoutes = require("./routes/storeRoutes");
const loadRoute = require("./routes/loadRoute");
const Redis = require("ioredis");
const { createAdapter } = require("@socket.io/redis-adapter");

if (process.env.ENABLE_WORKER === "true") {
  require("./workers/scrapeWorker");
}

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://52.27.43.67/backend",
  "http://52.27.43.67/",
  "https://52.27.43.67/backend",
  "http://localhost:3000",
  process.env.FRONTEND_URL,
];

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST"],
  },
});


const pubClient = new Redis(process.env.REDIS_HOST);
const subClient = pubClient.duplicate();
// io adapter, we need only when we have multiple servers
io.adapter(createAdapter(pubClient, subClient));

const corsOpts = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, or same-origin)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Set-Cookie"], // Important for cookies
};

app.set('trust proxy', 1);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, // Helpful for OAuth
  })
);
app.use(cors(corsOpts));

app.use(
  express.json({
    limit: "5mb",
    verify: (req, res, buf) => {
        req.rawBody = buf
    },
  })
);
app.use(cookieParser());

io.use(async (socket, next) => {
  try {
    let token = null;

    // Method 1: From HTTP-only cookies (PRIORITY for your setup)
    if (socket.handshake.headers.cookie) {
      const cookies = socket.handshake.headers.cookie.split(";");
      for (let cookie of cookies) {
        const [name, value] = cookie.trim().split("=");
        if (name === "token") {
          token = value;
          console.log("🔑 Token found in HTTP-only cookie");
          break;
        }
      }
    }

    // Method 2: From socket handshake auth (fallback)
    if (!token && socket.handshake.auth && socket.handshake.auth.token) {
      token = socket.handshake.auth.token;
      console.log("🔑 Token found in handshake.auth.token");
    }

    // Method 3: From Authorization header (fallback)
    if (!token && socket.handshake.headers.authorization) {
      token = socket.handshake.headers.authorization.replace("Bearer ", "");
      console.log("🔑 Token found in Authorization header");
    }

    // Method 4: From custom header (fallback)
    if (!token && socket.handshake.headers["x-socket-token"]) {
      token = socket.handshake.headers["x-socket-token"];
      console.log("🔑 Token found in x-socket-token header");
    }

    // Method 5: From query parameters (last resort)
    if (!token && socket.handshake.query && socket.handshake.query.token) {
      token = socket.handshake.query.token;
      console.log("🔑 Token found in query parameters");
    }

    // Enhanced debug logging
    console.log("🔍 Socket auth debug:", {
      hasCookieHeader: !!socket.handshake.headers.cookie,
      cookieHeader: socket.handshake.headers.cookie,
      hasAuthObject: !!socket.handshake.auth,
      authKeys: socket.handshake.auth ? Object.keys(socket.handshake.auth) : [],
      hasAuthHeader: !!socket.handshake.headers.authorization,
      hasCustomHeader: !!socket.handshake.headers["x-socket-token"],
      hasQueryToken: !!socket.handshake.query?.token,
      clientAddress: socket.handshake.address,
      origin: socket.handshake.headers.origin,
      tokenFound: !!token,
    });

    if (!token) {
      throw new Error(
        "No token provided - checked cookies, auth, headers, and query params"
      );
    }

    // Verify JWT token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );
    socket.userId = decoded.id || decoded.userId;
    socket.user = decoded;
    socket.isAuthenticated = true;

    console.log(`✅ Socket authenticated for user: ${socket.userId}`);
    next();
  } catch (error) {
    console.error("❌ Socket authentication failed:", error.message);

    console.log("🚫 Auth failure details:", {
      errorMessage: error.message,
      cookieHeader: socket.handshake.headers.cookie,
      handshakeAuth: socket.handshake.auth,
      authHeader: socket.handshake.headers.authorization,
      customHeader: socket.handshake.headers["x-socket-token"],
      queryToken: socket.handshake.query?.token,
      origin: socket.handshake.headers.origin,
    });

    if (process.env.NODE_ENV !== "production") {
      socket.userId = null;
      socket.isAuthenticated = false;
      console.log("🔓 Development mode: allowing unauthenticated connection");
      return next();
    }

    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.userId;
  console.log(
    `🔌 User ${userId || "unauthenticated"} connected via socket from ${
      socket.handshake.address
    }`
  );

  // Only join user room if authenticated
  if (userId && socket.isAuthenticated) {
    socket.join(`user_${userId}`);
    console.log(`🏠 User ${userId} joined personal room: user_${userId}`);

    // Also join with user- prefix for compatibility
    socket.join(`user-${userId}`);
    console.log(`🏠 User ${userId} joined personal room: user-${userId}`);
  }

  // Handle explicit room joining
  socket.on("join-user-room", (requestedUserId) => {
    if (socket.isAuthenticated && requestedUserId === socket.userId) {
      socket.join(`user-${requestedUserId}`);
      console.log(
        `🏠 User ${socket.userId} explicitly joined room: user-${requestedUserId}`
      );
    } else {
      console.log(
        `❌ User ${socket.userId} denied access to room: user-${requestedUserId}`
      );
    }
  });

  socket.on("join-activity-room", (activityId) => {
    if (socket.isAuthenticated) {
      socket.join(`activity-${activityId}`);
      console.log(
        `🏠 User ${socket.userId} joined activity room: activity-${activityId}`
      );
    }
  });

  socket.on("leave-activity-room", (activityId) => {
    if (socket.isAuthenticated) {
      socket.leave(`activity-${activityId}`);
      console.log(
        `🚪 User ${socket.userId} left activity room: activity-${activityId}`
      );
    }
  });

  socket.on("crawl_progress", async ({ activityId, progress, status }) => {
    try {
      const activity = await UserActivity.findById(activityId);
      if (activity && activity.userId.toString() === userId) {
        io.to(`user_${userId}`).emit("activity_status_update", {
          success: true,
          activityId,
          status: activity.status,
          progress: activity.progress || 0,
          isSitemapCrawling: activity.isSitemapCrawling,
          isWebpageCrawling: activity.isWebpageCrawling,
          sitemapCount: activity.sitemapCount || 0,
          webpageCount: activity.webpageCount || 0,
          webpagesSuccessful: activity.webpagesSuccessful || 0,
          webpagesFailed: activity.webpagesFailed || 0,
        });
      }
    } catch (error) {
      console.error("Error handling crawl progress:", error);
    }
  });

  // Handle user requesting their activities
  socket.on("get_user_activities", async () => {
    try {
      // CHECK FOR AUTHENTICATION AND VALID USER ID
      if (
        !socket.isAuthenticated ||
        !userId ||
        userId === "anonymous" ||
        !mongoose.Types.ObjectId.isValid(userId)
      ) {
        socket.emit("user_activities_update", {
          success: false,
          message: "Authentication required",
          error: "Invalid or missing user ID",
        });
        return;
      }

      const { UserActivity } = require("./models/activity-models");
      const userActivities = await UserActivity.find({ userId }).sort({
        lastCrawlStarted: -1,
      });

      console.log(
        `📋 Sending ${userActivities.length} activities to user ${userId}`
      );

      socket.emit("user_activities_update", {
        success: true,
        count: userActivities.length,
        data: userActivities,
      });
    } catch (error) {
      console.error("Error fetching user activities via socket:", error);
      socket.emit("user_activities_update", {
        success: false,
        message: "Failed to fetch activities",
        error: error.message,
      });
    }
  });

  // Handle user requesting specific activity status
  socket.on("get_activity_status", async (activityId) => {
    try {
      // CHECK FOR AUTHENTICATION AND VALID USER ID
      if (
        !socket.isAuthenticated ||
        !userId ||
        userId === "anonymous" ||
        !mongoose.Types.ObjectId.isValid(userId)
      ) {
        socket.emit("activity_status_update", {
          success: false,
          message: "Authentication required",
        });
        return;
      }

      // VALIDATE ACTIVITY ID TOO
      if (!activityId || !mongoose.Types.ObjectId.isValid(activityId)) {
        socket.emit("activity_status_update", {
          success: false,
          message: "Invalid activity ID",
        });
        return;
      }

      const { UserActivity } = require("./models/activity-models");
      const activity = await UserActivity.findOne({
        _id: activityId,
        userId,
      });

      if (!activity) {
        socket.emit("activity_status_update", {
          success: false,
          message: "Activity not found",
        });
        return;
      }

      const { calculateTimeRemaining } = require("./services/scraperService");

      socket.emit("activity_status_update", {
        success: true,
        activityId,
        status: activity.status,
        progress: activity.progress || 0,
        isSitemapCrawling: activity.isSitemapCrawling,
        isWebpageCrawling: activity.isWebpageCrawling,
        isBacklinkFetching: activity.isBacklinkFetching,
        sitemapCount: activity.sitemapCount || 0,
        webpageCount: activity.webpageCount || 0,
        webpagesSuccessful: activity.webpagesSuccessful || 0,
        webpagesFailed: activity.webpagesFailed || 0,
        startTime: activity.startTime,
        endTime: activity.endTime,
        errorMessages: activity.errorMessages || [],
        estimatedTimeRemaining:
          activity.progress < 100 ? calculateTimeRemaining(activity) : 0,
        websiteUrl: activity.websiteUrl,
      });
    } catch (error) {
      console.error("Error fetching activity status via socket:", error);
      socket.emit("activity_status_update", {
        success: false,
        message: "Failed to fetch activity status",
        error: error.message,
      });
    }
  });

  // Handle authenticate event (optional - for explicit auth)
  socket.on("authenticate", (data) => {
    if (socket.isAuthenticated) {
      console.log(`🔐 Authentication confirmation for user ${socket.userId}`);
      socket.emit("authenticated", {
        success: true,
        userId: socket.userId,
        message: "Already authenticated via cookie",
      });
    } else {
      socket.emit("authentication_error", {
        success: false,
        message: "Not authenticated",
      });
    }
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    console.log(
      `🔌 User ${
        userId || "unauthenticated"
      } disconnected from socket: ${reason}`
    );
  });
});

// Make io available globally for other modules
global.io = io;

// Initialize socket service in controllers
const { initializeSocket } = require("./controllers/scraperController");
initializeSocket(io);

app.get("/", (req, res) => {
  res.send("Node.js app with Socket.io is running successfully");
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/scraper", scraperRoutes);
app.use("/api/webpage", webpageRoutes);
app.use("/api/proxy_rotate", proxyRoutes);
app.use("/api/user-plan", userPlanRoutes);
app.use("/api/rank-tracker", rankTrackerRoutes);
app.use("/api/backlinks", backlinkRoutes);

app.use("/api/load", loadRoute);
app.use("/store", storeRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "production" ? null : err.message,
  });
});

// app.use((req, res, next) => {
//   if (req.path.startsWith("/socket.io/") || req.method === "OPTIONS") {
//     return next();
//   }

//   const allowedPublicRoutes = [
//     "/api/proxy_rotate",
//     "/",
//     "/api/rank-tracker/pingback"
//   ];

//   const isPublic = allowedPublicRoutes.includes(req.path);

//   const clientIP = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
//   console.log(`Request from IP: ${clientIP} to ${req.path}`);

//   if (process.env.NODE_ENV !== "production") {
//     return next();
//   }

//   if (
//     !isPublic &&
//     !clientIP.includes("127.0.0.1") &&
//     !clientIP.includes("localhost")
//   ) {
//     console.log(`Access denied for IP: ${clientIP} to ${req.path}`);
//     return res.status(403).json({ message: "Access denied" });
//   }

//   next();
// });
module.exports = { server, io };
