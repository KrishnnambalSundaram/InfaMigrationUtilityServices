const fileAnalysisService = require('../services/fileAnalysisService');
const fs = require('fs-extra');
const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('controllers/uploadController');

const handleUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No ZIP file uploaded' });
    }

    log.info(`📁 File uploaded successfully: ${req.file.filename}`);
    
    // Return simple upload confirmation
    res.status(200).json({
      success: true,
      message: 'Oracle ZIP file uploaded successfully',
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        size: fileAnalysisService.formatFileSize(req.file.size),
        mimetype: req.file.mimetype
      }
    });
    
  } catch (error) {
    log.error('❌ Upload failed', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message 
    });
  }
};


module.exports = { 
  handleUpload
};