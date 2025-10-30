const express = require('express');
const router = express.Router();
// Only keep batch script processing routes; unified conversion supersedes IDMC conversion endpoints
const { 
  handleProcessBatchUnified,
  handleSummarizeBatchScript
} = require('../controllers/batchScriptController');
const authMiddleware = require('../middleware/authMiddleware');
const { conversionLimiter } = require('../middleware/security');
const { validateUnifiedBatch } = require('../middleware/validation');

// Unified batch script processing route
router.post('/batch', conversionLimiter, validateUnifiedBatch, handleProcessBatchUnified);
router.post('/batch-summary', conversionLimiter, handleSummarizeBatchScript);

module.exports = router;
