const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
const { handleUpload } = require('../controllers/uploadController');
const authMiddleware = require('../middleware/authMiddleware');
const { uploadLimiter } = require('../middleware/security');

// Upload routes with rate limiting - supports both ZIP and single files
// Accepts 'zipFile' (legacy) or 'file' (new) field names
router.post('/upload', uploadLimiter, upload.fields([
  { name: 'zipFile', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]), (req, res, next) => {
  // Normalize to req.file for backward compatibility
  if (!req.file && req.files) {
    req.file = req.files.zipFile?.[0] || req.files.file?.[0];
  }
  next();
}, handleUpload);

module.exports = router;
