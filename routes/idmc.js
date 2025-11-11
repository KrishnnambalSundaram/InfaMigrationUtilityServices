const express = require('express');
const router = express.Router();
const { 
  handleBatchToIdmcSummary,
  handleBatchToHumanLanguage
} = require('../controllers/batchScriptController');
const { handleConvertIdmcSummaryToJson } = require('../controllers/idmcSummaryToJsonController');
const { conversionLimiter } = require('../middleware/security');
const { validateBatchProcessing, validateIdmcSummaryToJson } = require('../middleware/validation');
const authMiddleware = require('../middleware/authMiddleware');

// Batch to IDMC Summary API - converts batch scripts to structured IDMC mapping summaries
router.post('/batch-idmc-summary', conversionLimiter, validateBatchProcessing, handleBatchToIdmcSummary);

// Batch to Human Language API - converts batch scripts to conversational human-readable summaries
router.post('/batch-human-language', conversionLimiter, validateBatchProcessing, handleBatchToHumanLanguage);

// IDMC Summary to JSON API - converts IDMC mapping summaries to IDMC mapping JSON files
router.post('/summary-to-json', conversionLimiter, validateIdmcSummaryToJson, handleConvertIdmcSummaryToJson);

module.exports = router;
