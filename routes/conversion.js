const express = require('express');
const router = express.Router();
const { validateFileUpload, validateJobId, validateDownloadRequest, validateUnifiedConvert } = require('../middleware/validation');
const { getProgress, serveZipFile, handleUnifiedConvert, handleTestConversion, handleTestUnifiedIDMC } = require('../controllers/oracleConversionController');
const { conversionLimiter } = require('../middleware/security');
const authMiddleware = require('../middleware/authMiddleware');

// Health check
router.get('/test', (req, res) => res.send('Conversion API is working!'));
// Trigger sample Oracle/Redshift → IDMC conversion with progress events (no auth)
router.post('/test', conversionLimiter, handleTestUnifiedIDMC);
router.post('/convert-unified', authMiddleware.authenticateToken, conversionLimiter, validateUnifiedConvert, handleUnifiedConvert);
router.get('/progress/:jobId', authMiddleware.authenticateToken, validateJobId, getProgress);
// Support both GET (legacy) and POST (JSON body) for download
router.get('/download', authMiddleware.authenticateToken, validateDownloadRequest, serveZipFile);
router.post('/download', authMiddleware.authenticateToken, validateDownloadRequest, serveZipFile);

module.exports = router;
