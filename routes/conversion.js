const express = require('express');
const router = express.Router();
const { handleTestConversion, handleConvert, getProgress, serveZipFile } = require('../controllers/oracleConversionController');
const authMiddleware = require('../middleware/authMiddleware');
const { conversionLimiter } = require('../middleware/security');
const { validateFileUpload, validateJobId, validateDownloadRequest } = require('../middleware/validation');

// Conversion routes with rate limiting and validation
router.post('/test', conversionLimiter, handleTestConversion);
router.post('/convert', conversionLimiter, authMiddleware.authenticateToken, validateFileUpload, handleConvert);
router.get('/progress/:jobId', validateJobId, getProgress);
router.post('/download', authMiddleware.authenticateToken, validateDownloadRequest, serveZipFile);

module.exports = router;
