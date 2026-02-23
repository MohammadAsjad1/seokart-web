import { io, Socket } from 'socket.io-client';

interface SocketConfig {
  serverUrl?: string;
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionDelay?: number;
  reconnectionAttempts?: number;
  timeout?: number;
}

class SocketManager {
  private socket: Socket | null = null;
  private config: SocketConfig;
  private isInitialized = false;
  private connectionCallbacks: Array<(connected: boolean) => void> = [];
  private isDebugMode = false;

  constructor(config: SocketConfig = {}) {
    this.isDebugMode = process.env.NEXT_PUBLIC_SOCKET_DEBUG === 'true';
    
    this.config = {
      serverUrl: process.env.NEXT_PUBLIC_SOCKET_URL,
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 5,
      timeout: 20000,
      ...config
    };

    if (this.isDebugMode) {
      console.log('🔧 Socket Manager initialized with config:', {
        serverUrl: this.config.serverUrl,
        timeout: this.config.timeout,
        reconnectionAttempts: this.config.reconnectionAttempts,
        environment: typeof window !== 'undefined' ? 'client' : 'server'
      });
    }
  }

  async init(): Promise<Socket | null> {
    if (typeof window === 'undefined') {
      if (this.isDebugMode) {
        console.log('⚠️ Skipping socket init on server side');
      }
      return null;
    }

    if (this.isInitialized && this.socket?.connected) {
      if (this.isDebugMode) {
        console.log('♻️ Socket already initialized and connected');
      }
      return this.socket;
    }

    if (!this.config.serverUrl) {
      console.error('❌ No socket server URL configured');
      this.notifyConnectionCallbacks(false);
      return null;
    }

    try {
      if (this.isDebugMode) {
        console.log('🚀 Initializing socket connection to:', this.config.serverUrl);
      }

      // Disconnect existing socket if any
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }

      this.socket = io(this.config.serverUrl, {
        withCredentials: true,
        autoConnect: this.config.autoConnect,
        reconnection: this.config.reconnection,
        reconnectionDelay: this.config.reconnectionDelay,
        reconnectionAttempts: this.config.reconnectionAttempts,
        timeout: this.config.timeout,
        forceNew: true,
        transports: ['polling', 'websocket'],
        upgrade: true,
        rememberUpgrade: false
      });

      this.setupEventListeners();
      this.isInitialized = true;

      // Force connect if not auto-connecting
      if (!this.config.autoConnect) {
        this.socket.connect();
      }

      return this.socket;
    } catch (error) {
      console.error('💥 Failed to initialize socket:', error);
      this.notifyConnectionCallbacks(false);
      return null;
    }
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      if (this.isDebugMode) {
        console.log('✅ Socket connected:', {
          id: this.socket?.id,
          transport: this.socket?.io.engine.transport.name,
          connected: this.socket?.connected
        });
      }
      this.notifyConnectionCallbacks(true);
    });

    this.socket.on('disconnect', (reason, details) => {
      console.log('❌ Socket disconnected:', { reason, details });
      this.notifyConnectionCallbacks(false);
      
      if (reason === 'io server disconnect') {
        setTimeout(() => {
          if (this.isDebugMode) {
            console.log('🔄 Attempting reconnection due to server disconnect');
          }
          this.socket?.connect();
        }, 1000);
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('💥 Socket connection error:', {
        message: error.message,
      });
      this.notifyConnectionCallbacks(false);
    });

    this.socket.on('reconnect', (attemptNumber) => {
      if (this.isDebugMode) {
        console.log('🔄 Socket reconnected after', attemptNumber, 'attempts');
      }
      this.notifyConnectionCallbacks(true);
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('🔄❌ Socket reconnection error:', error.message);
    });

    this.socket.on('reconnect_failed', () => {
      console.error('🔄💀 Socket reconnection failed - giving up');
      this.notifyConnectionCallbacks(false);
    });

    this.socket.on('authenticated', (data) => {
      if (this.isDebugMode) {
        console.log('🔐 Socket authenticated:', data);
      }
    });

    this.socket.on('authentication_error', (error) => {
      console.error('🔐❌ Socket authentication error:', error);
    });

    // Transport upgrade events
    this.socket.on('upgrade', () => {
      if (this.isDebugMode) {
        console.log('⬆️ Transport upgraded to:', this.socket?.io.engine.transport.name);
      }
    });

    this.socket.on('upgradeError', (error) => {
      console.warn('⬆️❌ Transport upgrade failed:', error);
    });

    // Periodic connection check
    setInterval(() => {
      if (this.socket) {
        const currentStatus = this.socket.connected;
        if (this.isDebugMode) {
          console.log('🔍 Connection check:', {
            connected: currentStatus,
            id: this.socket.id,
            transport: this.socket.io.engine?.transport?.name
          });
        }
      }
    }, 30000);
  }

  joinUserRoom(userId: string): void {
    if (this.socket?.connected && userId) {
      this.socket.emit('join-user-room', userId);
      if (this.isDebugMode) {
        console.log(`🏠 Joined user room: user-${userId}`);
      }
    }
  }

  joinActivityRoom(activityId: string): void {
    if (this.socket?.connected && activityId) {
      this.socket.emit('join-activity-room', activityId);
      if (this.isDebugMode) {
        console.log(`🏠 Joined activity room: activity-${activityId}`);
      }
    }
  }

  leaveActivityRoom(activityId: string): void {
    if (this.socket?.connected && activityId) {
      this.socket.emit('leave-activity-room', activityId);
      if (this.isDebugMode) {
        console.log(`🚪 Left activity room: activity-${activityId}`);
      }
    }
  }

  on(eventName: string, callback: (...args: any[]) => void): () => void {
    if (this.socket) {
      this.socket.on(eventName, callback);
      
      return () => {
        this.socket?.off(eventName, callback);
      };
    }
    return () => {};
  }

  off(eventName: string, callback?: (...args: any[]) => void): void {
    if (this.socket) {
      this.socket.off(eventName, callback);
    }
  }

  emit(eventName: string, data?: any): void {
    if (this.socket?.connected) {
      this.socket.emit(eventName, data);
      if (this.isDebugMode) {
        console.log(`📤 Emitted event: ${eventName}`, data);
      }
    } else {
      console.warn(`⚠️ Cannot emit ${eventName} - socket not connected. Status:`, {
        socketExists: !!this.socket,
        connected: this.socket?.connected,
        id: this.socket?.id
      });
    }
  }

  requestActivityStatus(activityId: string): void {
    if (this.socket?.connected && activityId) {
      this.socket.emit('request-activity-status', activityId);
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.connectionCallbacks.push(callback);
    
    // Call immediately with current status
    callback(this.isConnected());
    
    return () => {
      this.connectionCallbacks = this.connectionCallbacks.filter(cb => cb !== callback);
    };
  }

  private notifyConnectionCallbacks(connected: boolean): void {
    this.connectionCallbacks.forEach(callback => {
      try {
        callback(connected);
      } catch (error) {
        console.error('💥 Error in connection callback:', error);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      if (this.isDebugMode) {
        console.log('🔌 Disconnecting socket');
      }
      this.socket.disconnect();
      this.socket = null;
      this.isInitialized = false;
      this.notifyConnectionCallbacks(false);
    }
  }

  reconnect(): void {
    if (this.socket && !this.socket.connected) {
      if (this.isDebugMode) {
        console.log('🔄 Reconnecting existing socket');
      }
      this.socket.connect();
    } else {
      if (this.isDebugMode) {
        console.log('🔄 Creating new socket connection');
      }
      this.init();
    }
  }
}

const socketManager = new SocketManager();

export const socketUtils = {
  init: () => socketManager.init(),
  joinUserRoom: (userId: string) => socketManager.joinUserRoom(userId),
  joinActivityRoom: (activityId: string) => socketManager.joinActivityRoom(activityId),
  leaveActivityRoom: (activityId: string) => socketManager.leaveActivityRoom(activityId),
  on: (eventName: string, callback: (...args: any[]) => void) => socketManager.on(eventName, callback),
  off: (eventName: string, callback?: (...args: any[]) => void) => socketManager.off(eventName, callback),
  emit: (eventName: string, data?: any) => socketManager.emit(eventName, data),
  isConnected: () => socketManager.isConnected(),
  getSocket: () => socketManager.getSocket(),
  onConnectionChange: (callback: (connected: boolean) => void) => socketManager.onConnectionChange(callback),
  disconnect: () => socketManager.disconnect(),
  reconnect: () => socketManager.reconnect(),
  requestActivityStatus: (activityId: string) => socketManager.requestActivityStatus(activityId),
};

export { socketManager };
export default socketUtils;