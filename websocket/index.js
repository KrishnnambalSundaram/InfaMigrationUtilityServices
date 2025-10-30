const socketService = require('./socketService');
const progressEmitter = require('./progressEmitter');

// Export the main services
module.exports = {
  socketService,
  progressEmitter,
  
  // Convenience methods
  initialize: (server) => socketService.initialize(server),
  emitProgressUpdate: (jobId, data) => progressEmitter.emitProgressUpdate(jobId, data),
  emitJobCompleted: (jobId, result) => progressEmitter.emitJobCompleted(jobId, result),
  emitJobFailed: (jobId, error) => progressEmitter.emitJobFailed(jobId, error),
  emitFileConversionProgress: (jobId, convertedCount, totalFiles, elapsedTime, estimatedTime) => 
    progressEmitter.emitFileConversionProgress(jobId, convertedCount, totalFiles, elapsedTime, estimatedTime),
  emitSystemNotification: (message, type) => progressEmitter.emitSystemNotification(message, type),
  setJobContext: (jobId, context) => progressEmitter.setJobContext(jobId, context),
  
  // New methods for broadcasting to all clients
  emitProgressUpdateToAll: (data) => socketService.emitProgressUpdateToAll(data),
  emitToAll: (event, data) => socketService.emitToAll(event, data),
  
  // Get statistics
  getConnectedClientsCount: () => socketService.getConnectedClientsCount(),
  getConnectedClients: () => socketService.getConnectedClients(),
  getClientsInRoom: (roomId) => socketService.getClientsInRoom(roomId),
  
  // Cleanup
  cleanup: () => socketService.cleanup()
};
