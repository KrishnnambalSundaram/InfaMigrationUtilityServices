const express = require('express');
const router = express.Router();
const { 
  handleBatchToIdmcSummary,
  handleBatchToHumanLanguage
} = require('../controllers/batchScriptController');
const { conversionLimiter } = require('../middleware/security');
const { validateBatchProcessing } = require('../middleware/validation');

// Batch to IDMC Summary API - converts batch scripts to structured IDMC mapping summaries
router.post('/batch-idmc-summary', conversionLimiter, validateBatchProcessing, handleBatchToIdmcSummary);

// Batch to Human Language API - converts batch scripts to conversational human-readable summaries
router.post('/batch-human-language', conversionLimiter, validateBatchProcessing, handleBatchToHumanLanguage);

module.exports = router;
