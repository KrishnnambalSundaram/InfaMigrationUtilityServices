const socketService = require('./socketService');

class ProgressEmitter {
  constructor() {
    this.socketService = socketService;
  }

  // Emit job creation event
  emitJobCreated(jobId, jobData) {
    this.socketService.emitProgressUpdate(jobId, {
      status: 'created',
      progress: 0,
      currentStep: 'Job created',
      steps: jobData.steps,
      result: null,
      error: null,
      createdAt: jobData.createdAt
    });
  }

  // Emit progress update
  emitProgressUpdate(jobId, progressData) {
    this.socketService.emitProgressUpdate(jobId, {
      status: progressData.status || 'pending',
      progress: progressData.progress,
      currentStep: progressData.currentStep,
      steps: progressData.steps,
      result: progressData.result,
      error: progressData.error,
      createdAt: progressData.createdAt,
      updatedAt: progressData.updatedAt,
      completedAt: progressData.completedAt,
      failedAt: progressData.failedAt
    });
  }

  // Emit job completion
  emitJobCompleted(jobId, result) {
    this.socketService.emitProgressUpdate(jobId, {
      status: 'completed',
      progress: 100,
      currentStep: 'Conversion completed',
      result: result,
      completedAt: new Date()
    });
  }

  // Emit job failure
  emitJobFailed(jobId, error) {
    this.socketService.emitProgressUpdate(jobId, {
      status: 'failed',
      progress: 0,
      currentStep: 'Conversion failed',
      error: error,
      failedAt: new Date()
    });
  }

  // Emit step update
  emitStepUpdate(jobId, stepIndex, progress, currentStep) {
    this.socketService.emitProgressUpdate(jobId, {
      status: 'pending',
      progress: progress,
      currentStep: currentStep,
      stepIndex: stepIndex,
      updatedAt: new Date()
    });
  }

  // Emit file conversion progress
  emitFileConversionProgress(jobId, convertedCount, totalFiles, elapsedTime, estimatedTime) {
    this.socketService.emitProgressUpdate(jobId, {
      status: 'pending',
      progress: Math.round((convertedCount / totalFiles) * 90),
      currentStep: `Converted ${convertedCount}/${totalFiles} files (${Math.round(elapsedTime/1000)}s elapsed, ~${Math.round(estimatedTime/1000)}s remaining)`,
      filesConverted: convertedCount,
      totalFiles: totalFiles,
      elapsedTime: elapsedTime,
      estimatedTime: estimatedTime,
      updatedAt: new Date()
    });
  }

  // Emit system notification
  emitSystemNotification(message, type = 'info') {
    this.socketService.emitToAll('system-notification', {
      message,
      type,
      timestamp: new Date().toISOString()
    });
  }

  // Emit job statistics
  emitJobStatistics() {
    const stats = {
      connectedClients: this.socketService.getConnectedClientsCount(),
      activeJobs: this.getActiveJobsCount(),
      timestamp: new Date().toISOString()
    };
    
    this.socketService.emitToAll('job-statistics', stats);
  }

  // Get active jobs count (this would need to be integrated with your job management)
  getActiveJobsCount() {
    // This would need to be connected to your job management system
    // For now, return a placeholder
    return 0;
  }
}

module.exports = new ProgressEmitter();
