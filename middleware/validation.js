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

// Download request validation: allow either filename (zip) OR filePath under allowed roots
const validateDownloadRequest = [
  body().custom((value, { req }) => {
    const { filename, filePath } = req.method === 'GET' ? req.query : req.body;
    if (!filename && !filePath) {
      throw new Error('Either filename or filePath is required');
    }
    if (filename) {
      if (typeof filename !== 'string' || !filename.match(/\.zip$/i)) {
        throw new Error('When provided, filename must be a .zip file');
      }
      if (filename.length < 1 || filename.length > 255) {
        throw new Error('Filename must be between 1 and 255 characters');
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
    .withMessage('zipFilePath must be a string')
    .matches(/\.zip$/i)
    .withMessage('zipFilePath must point to a ZIP file'),

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
  validateJobId,
  validateDownloadRequest,
  validateWebSocketNotification,
  validatePagination,
  sanitizeInput,
  handleValidationErrors
};
