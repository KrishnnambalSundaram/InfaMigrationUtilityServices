const express = require('express');
const router = express.Router();
const { validateFileUpload, validateJobId, validateDownloadRequest, validateUnifiedConvert } = require('../middleware/validation');
const { getProgress, serveZipFile, handleUnifiedConvert } = require('../controllers/oracleConversionController');
const { conversionLimiter } = require('../middleware/security');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/test', (req, res) => res.send('Conversion API is working!'));
router.post('/convert-unified', authMiddleware.authenticateToken, conversionLimiter, validateUnifiedConvert, handleUnifiedConvert);
router.get('/progress/:jobId', authMiddleware.authenticateToken, validateJobId, getProgress);
router.get('/download', authMiddleware.authenticateToken, validateDownloadRequest, serveZipFile);

module.exports = router;
