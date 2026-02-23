const Redis = require("ioredis");
const { Emitter } = require("@socket.io/redis-emitter");

let redisClient = null;
let emitter = null;
let initialized = false;

/**
 * Initialize Redis emitter (call once per process)
 */
async function initEmitter() {
  if (initialized) return;

  redisClient = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  });

  redisClient.on("connect", () => {
    console.log("✅ ioredis connected (socket emitter)");
  });

  redisClient.on("error", (err) => {
    console.error("❌ ioredis emitter error:", err);
  });

  emitter = new Emitter(redisClient);

  initialized = true;
}

/**
 * Emit event to a specific user room
 */
function emitToUser(userId, event, data) {
  if (!emitter) {
    console.warn("⚠️ Emitter not initialized");
    return;
  }

  emitter.to(`user_${userId}`).emit(event, data);
}

/**
 * Broadcast to all connected clients
 */
function emitToAll(event, data) {
  if (!emitter) {
    console.warn("⚠️ Emitter not initialized");
    return;
  }

  emitter.emit(event, data);
}

module.exports = {
  initEmitter,
  emitToUser,
  emitToAll,
};
