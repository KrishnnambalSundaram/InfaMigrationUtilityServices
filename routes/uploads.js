const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
const { handleUpload } = require('../controllers/uploadController');
const authMiddleware = require('../middleware/authMiddleware');
const { uploadLimiter } = require('../middleware/security');

// Upload routes with rate limiting
router.post('/upload', uploadLimiter, upload.single('zipFile'), handleUpload);

module.exports = router;
