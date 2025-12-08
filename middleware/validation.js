const { body, param, query, validationResult } = require('express-validator');
const { ValidationError } = require('./errorHandler');

// Validation result handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));
    
    throw new ValidationError('Validation failed', errorMessages);
  }
  next();
};

// User login validation
const validateUserLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  
  handleValidationErrors
];

// File upload validation
const validateFileUpload = [
  body('zipFilePath')
    .optional()
    .isString()
    .withMessage('ZIP file path must be a string')
    .matches(/\.zip$/i)
    .withMessage('File must be a ZIP file'),
  
  body('sourceCode')
    .optional()
    .isString()
    .withMessage('Source code must be a string'),
    
  body('fileName')
    .optional()
    .isString()
    .withMessage('File name must be a string'),
  
  handleValidationErrors
];

// Direct code input validation
const validateDirectCodeInput = [
  body('sourceCode')
    .notEmpty()
    .withMessage('Source code is required')
    .isString()
    .withMessage('Source code must be a string'),
  
  body('fileName')
    .optional()
    .isString()
    .withMessage('File name must be a string'),
  
  body('conversionType')
    .optional()
    .isString()
    .withMessage('Conversion type must be a string')
    .isIn(['oracle-to-snowflake', 'oracle-to-idmc', 'redshift-to-idmc'])
    .withMessage('Invalid conversion type'),
  
  handleValidationErrors
];

// Job ID parameter validation
const validateJobId = [
  param('jobId')
    .isString()
    .notEmpty()
    .withMessage('Job ID is required')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Job ID can only contain letters, numbers, underscores, and hyphens'),
  
  handleValidationErrors
];

// Download request validation: allow either filename OR filePath under allowed roots
const validateDownloadRequest = [
  body().custom((value, { req }) => {
    const { filename, filePath } = req.method === 'GET' ? req.query : req.body;
    if (!filename && !filePath) {
      throw new Error('Either filename or filePath is required');
    }
    if (filename) {
      if (typeof filename !== 'string') {
        throw new Error('filename must be a string');
      }
      if (filename.length < 1 || filename.length > 255) {
        throw new Error('Filename must be between 1 and 255 characters');
      }
      // Security: prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        throw new Error('Filename cannot contain invalid characters (.., /, \\)');
      }
    }
    if (filePath) {
      if (typeof filePath !== 'string') {
        throw new Error('filePath must be a string');
      }
    }
    // Normalize for controller usage
    if (req.method === 'GET') {
      req.body = { filename, filePath };
    }
    return true;
  }),
  handleValidationErrors
];

// Unified convert validation
const validateUnifiedConvert = [
  body('inputType')
    .isString()
    .withMessage('inputType is required')
    .isIn(['zip', 'single'])
    .withMessage('inputType must be one of: zip, single'),

  body('target')
    .isString()
    .withMessage('target is required')
    .isIn(['snowflake', 'idmc'])
    .withMessage('target must be one of: snowflake, idmc'),

  body('sourceType')
    .optional()
    .isIn(['oracle', 'redshift', 'auto'])
    .withMessage('sourceType must be one of: oracle, redshift, auto'),

  body('zipFilePath')
    .optional()
    .isString()
    .withMessage('zipFilePath must be a string'),

  body('filePath')
    .optional()
    .isString()
    .withMessage('filePath must be a string'),

  body('sourceCode')
    .optional()
    .isString()
    .withMessage('sourceCode must be a string'),

  body('fileName')
    .optional()
    .isString()
    .withMessage('fileName must be a string'),

  body('outputFormat')
    .optional()
    .isIn(['json', 'docx', 'pdf', 'all'])
    .withMessage('outputFormat must be one of: json, docx, pdf, all'),

  // Conditional validation: require zipFilePath or filePath for zip inputType, sourceCode or filePath for single inputType
  body().custom((value, { req }) => {
    const { inputType, zipFilePath, filePath, sourceCode } = req.body;
    
    if (inputType === 'zip') {
      const hasZipPath = zipFilePath && typeof zipFilePath === 'string' && zipFilePath.trim() !== '';
      const hasFilePath = filePath && typeof filePath === 'string' && filePath.trim() !== '';
      if (!hasZipPath && !hasFilePath) {
        throw new Error('zipFilePath or filePath is required when inputType is "zip"');
      }
    }
    
    if (inputType === 'single') {
      const hasSourceCode = sourceCode && typeof sourceCode === 'string' && sourceCode.trim() !== '';
      const hasFilePath = filePath && typeof filePath === 'string' && filePath.trim() !== '';
      if (!hasSourceCode && !hasFilePath) {
        throw new Error('sourceCode or filePath is required when inputType is "single"');
      }
    }
    
    return true;
  }),

  handleValidationErrors
];

// Unified batch processing validation
const validateUnifiedBatch = [
  body('inputType')
    .isString()
    .withMessage('inputType is required')
    .isIn(['zip', 'single'])
    .withMessage('inputType must be one of: zip, single'),

  body('zipFilePath')
    .optional()
    .isString()
    .withMessage('zipFilePath must be a string')
    .matches(/\.zip$/i)
    .withMessage('zipFilePath must point to a ZIP file'),

  body('script')
    .optional()
    .isString()
    .withMessage('script must be a string'),

  body('fileName')
    .optional()
    .isString()
    .withMessage('fileName must be a string'),

  body('scriptType')
    .optional()
    .isIn(['oracle', 'redshift'])
    .withMessage('scriptType must be one of: oracle, redshift'),

  handleValidationErrors
];

// New batch processing validation (without scriptType - auto-detected)
const validateBatchProcessing = [
  body('inputType')
    .isString()
    .withMessage('inputType is required')
    .isIn(['zip', 'single'])
    .withMessage('inputType must be one of: zip, single'),

  body('outputFormat')
    .optional()
    .isIn(['doc', 'txt'])
    .withMessage('outputFormat must be one of: doc, txt'),

  body('name')
    .optional()
    .isString()
    .withMessage('name must be a string')
    .custom((value, { req }) => {
      // If inputType is single and script is provided (but no filePath), name is required
      if (req.body.inputType === 'single' && req.body.script && !req.body.filePath && !value) {
        throw new Error('name is required when inputType is "single" and script is provided');
      }
      return true;
    }),

  // For zip inputType - allow zipPath, zipFilePath, or filePath (for single files)
  body('zipPath')
    .optional()
    .isString()
    .withMessage('zipPath must be a string'),

  body('zipFilePath')
    .optional()
    .isString()
    .withMessage('zipFilePath must be a string'),

  // For single inputType
  body('script')
    .optional()
    .isString()
    .withMessage('script must be a string'),

  body('filePath')
    .optional()
    .isString()
    .withMessage('filePath must be a string')
    .custom((value, { req }) => {
      const { inputType, zipPath, zipFilePath, script } = req.body;
      
      // For zip inputType: require zipPath, zipFilePath, or filePath
      if (inputType === 'zip') {
        const hasZipPath = zipPath && typeof zipPath === 'string' && zipPath.trim() !== '';
        const hasZipFilePath = zipFilePath && typeof zipFilePath === 'string' && zipFilePath.trim() !== '';
        const hasFilePath = value && typeof value === 'string' && value.trim() !== '';
        if (!hasZipPath && !hasZipFilePath && !hasFilePath) {
          throw new Error('zipPath, zipFilePath, or filePath is required when inputType is "zip"');
        }
      }
      
      // For single inputType: require script or filePath
      if (inputType === 'single') {
        const hasScript = script && typeof script === 'string' && script.trim() !== '';
        const hasFilePath = value && typeof value === 'string' && value.trim() !== '';
        if (!hasScript && !hasFilePath) {
          throw new Error('script or filePath is required when inputType is "single"');
        }
      }
      
      return true;
    }),

  handleValidationErrors
];

// WebSocket notification validation
const validateWebSocketNotification = [
  body('message')
    .isString()
    .notEmpty()
    .withMessage('Message is required')
    .isLength({ min: 1, max: 500 })
    .withMessage('Message must be between 1 and 500 characters'),
  
  body('type')
    .optional()
    .isIn(['info', 'success', 'warning', 'error'])
    .withMessage('Type must be one of: info, success, warning, error'),
  
  handleValidationErrors
];

// IDMC Summary to JSON validation
const validateIdmcSummaryToJson = [
  body('zipFilePath')
    .optional()
    .isString()
    .withMessage('zipFilePath must be a string'),
  
  body('filePath')
    .optional()
    .isString()
    .withMessage('filePath must be a string'),
  
  body('sourceCode')
    .optional()
    .isString()
    .withMessage('sourceCode must be a string'),
  
  body('fileName')
    .optional()
    .isString()
    .withMessage('fileName must be a string'),
  
  body().custom((value, { req }) => {
    // Either sourceCode, zipFilePath, or filePath must be provided
    const { sourceCode, zipFilePath, filePath } = req.body;
    const hasSourceCode = sourceCode && typeof sourceCode === 'string' && sourceCode.trim() !== '';
    const hasZipFilePath = zipFilePath && typeof zipFilePath === 'string' && zipFilePath.trim() !== '';
    const hasFilePath = filePath && typeof filePath === 'string' && filePath.trim() !== '';
    
    if (!hasSourceCode && !hasZipFilePath && !hasFilePath) {
      throw new Error('Either sourceCode, zipFilePath, or filePath is required');
    }
    // If sourceCode is provided, fileName is recommended but not strictly required
    return true;
  }),
  
  handleValidationErrors
];

// Query parameter validation
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  handleValidationErrors
];

// Sanitization middleware
const sanitizeInput = (req, res, next) => {
  // Remove any potentially dangerous characters
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/[<>\"'%;()&+]/g, '');
  };

  // Sanitize body
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    });
  }

  // Sanitize query parameters
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = sanitizeString(req.query[key]);
      }
    });
  }

  next();
};

module.exports = {
  validateUserLogin,
  validateFileUpload,
  validateDirectCodeInput,
  validateUnifiedConvert,
  validateUnifiedBatch,
  validateBatchProcessing,
  validateIdmcSummaryToJson,
  validateJobId,
  validateDownloadRequest,
  validateWebSocketNotification,
  validatePagination,
  sanitizeInput,
  handleValidationErrors
};
