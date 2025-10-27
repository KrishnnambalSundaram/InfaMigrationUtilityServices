class ProgressService {
  constructor() {
    this.jobs = new Map();
  }

  // Emit progress update via WebSocket
  emitProgressUpdate(jobId, job) {
    if (global.websocket) {
      global.websocket.emitProgressUpdate(jobId, {
        status: job.status,
        progress: job.progress,
        currentStep: job.currentStep,
        steps: job.steps,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
        failedAt: job.failedAt
      });
      
      // Also emit to all connected clients without job ID requirement
      if (global.websocket) {
        console.log('🔍 Checking emitProgressUpdateToAll method...');
        console.log('🔍 Method exists:', typeof global.websocket.emitProgressUpdateToAll);
        if (typeof global.websocket.emitProgressUpdateToAll === 'function') {
          console.log('📡 Calling emitProgressUpdateToAll...');
          global.websocket.emitProgressUpdateToAll({
            jobId: jobId,
            status: job.status,
            progress: job.progress,
            currentStep: job.currentStep,
            steps: job.steps,
            result: job.result,
            error: job.error,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            completedAt: job.completedAt,
            failedAt: job.failedAt
          });
        } else {
          console.log('⚠️ emitProgressUpdateToAll method not available, using emitToAll instead');
          global.websocket.emitToAll('progress-update', {
            jobId: jobId,
            status: job.status,
            progress: job.progress,
            currentStep: job.currentStep,
            steps: job.steps,
            result: job.result,
            error: job.error,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            completedAt: job.completedAt,
            failedAt: job.failedAt
          });
        }
      }
    }
  }

  createJob(jobId) {
    const job = {
      id: jobId,
      status: 'pending',
      progress: 0,
      currentStep: '',
      steps: [
        { name: 'Analyzing .NET project', progress: 0 },
        { name: 'Converting C# to Java', progress: 0 },
        { name: 'Generating Quarkus project', progress: 0 },
        { name: 'Creating final package', progress: 0 }
      ],
      result: null,
      error: null,
      createdAt: new Date()
    };
    
    this.jobs.set(jobId, job);
    this.emitProgressUpdate(jobId, job);
    return job;
  }

  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      job.updatedAt = new Date();
      this.emitProgressUpdate(jobId, job);
    }
    return job;
  }

  updateProgress(jobId, stepIndex, progress, currentStep = '') {
    const job = this.jobs.get(jobId);
    if (job) {
      job.steps[stepIndex].progress = progress;
      job.progress = this.calculateOverallProgress(job);
      job.currentStep = currentStep || job.steps[stepIndex].name;
      job.updatedAt = new Date();
      this.emitProgressUpdate(jobId, job);
    }
    return job;
  }

  calculateOverallProgress(job) {
    const totalSteps = job.steps.length;
    const totalProgress = job.steps.reduce((sum, step) => sum + step.progress, 0);
    return Math.round(totalProgress / totalSteps);
  }

  completeJob(jobId, result) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'completed';
      job.progress = 100;
      job.result = result;
      job.completedAt = new Date();
      this.emitProgressUpdate(jobId, job);
    }
    return job;
  }

  failJob(jobId, error) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error;
      job.failedAt = new Date();
      this.emitProgressUpdate(jobId, job);
    }
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  deleteJob(jobId) {
    return this.jobs.delete(jobId);
  }

  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  // Clean up old jobs (older than 1 hour)
  cleanup() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.createdAt < oneHourAgo) {
        this.jobs.delete(jobId);
      }
    }
  }
}

module.exports = new ProgressService();
