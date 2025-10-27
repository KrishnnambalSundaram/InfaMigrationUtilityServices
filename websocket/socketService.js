const { Server } = require('socket.io');

class SocketService {
  constructor() {
    this.io = null;
    this.connectedClients = new Map();
  }

  // Initialize Socket.IO with HTTP server
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupEventHandlers();
    console.log('🔌 Socket.IO service initialized');
    return this.io;
  }

  // Setup Socket.IO event handlers
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);
      this.connectedClients.set(socket.id, {
        id: socket.id,
        connectedAt: new Date(),
        rooms: new Set()
      });
      
      // Send welcome message to the newly connected client
      socket.emit('connection-established', {
        message: 'Connected to migration tool WebSocket',
        clientId: socket.id,
        timestamp: new Date().toISOString()
      });
      
      // Handle joining a specific job room for progress updates (optional)
      socket.on('join-job', (jobId) => {
        socket.join(jobId);
        const client = this.connectedClients.get(socket.id);
        if (client) {
          client.rooms.add(jobId);
        }
        console.log(`📡 Client ${socket.id} joined job room: ${jobId}`);
      });
      
      // Handle leaving a job room
      socket.on('leave-job', (jobId) => {
        socket.leave(jobId);
        const client = this.connectedClients.get(socket.id);
        if (client) {
          client.rooms.delete(jobId);
        }
        console.log(`📡 Client ${socket.id} left job room: ${jobId}`);
      });
      
      // Handle custom events
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date().toISOString() });
      });
      
      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });
      
      // Handle job completion cleanup
      socket.on('job-completed', (jobId) => {
        console.log(`📋 Job completed, cleaning up room: ${jobId}`);
        socket.leave(jobId);
        const client = this.connectedClients.get(socket.id);
        if (client) {
          client.rooms.delete(jobId);
        }
      });
    });
  }

  // Emit progress update to specific job room
  emitProgressUpdate(jobId, data) {
    if (this.io) {
      this.io.to(jobId).emit('progress-update', {
        jobId,
        timestamp: new Date().toISOString(),
        ...data
      });
      console.log(`📡 Emitted progress update for job: ${jobId} (${data.progress}%)`);
    }
  }

  // Emit progress update to all connected clients (without job ID requirement)
  emitProgressUpdateToAll(data) {
    if (this.io) {
      this.io.emit('progress-update', {
        timestamp: new Date().toISOString(),
        ...data
      });
      console.log(`📡 Emitted progress update to all clients (${data.progress}%)`);
    }
  }

  // Emit to all connected clients
  emitToAll(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  // Emit system notification to all connected clients
  emitSystemNotification(message, type = 'info') {
    if (this.io) {
      this.io.emit('system-notification', {
        message,
        type,
        timestamp: new Date().toISOString()
      });
      console.log(`📢 System notification sent to all clients: ${message}`);
    }
  }

  // Emit to specific client
  emitToClient(socketId, event, data) {
    if (this.io) {
      this.io.to(socketId).emit(event, data);
    }
  }

  // Get connected clients count
  getConnectedClientsCount() {
    return this.connectedClients.size;
  }

  // Get clients in specific room
  getClientsInRoom(roomId) {
    if (this.io) {
      return this.io.sockets.adapter.rooms.get(roomId)?.size || 0;
    }
    return 0;
  }

  // Get all connected clients info
  getConnectedClients() {
    return Array.from(this.connectedClients.values());
  }

  // Cleanup method
  cleanup() {
    if (this.io) {
      this.io.close();
      this.io = null;
    }
    this.connectedClients.clear();
  }
}

module.exports = new SocketService();
