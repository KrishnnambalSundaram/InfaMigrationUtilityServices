const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');

// Ensure logs directory exists
const logsDir = process.env.LOG_FILE_PATH || './logs';
fs.ensureDirSync(logsDir);

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Define console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'oracle-snowflake-migration' },
  transports: [
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Add console transport for all environments (internal app)
logger.add(new winston.transports.Console({
  format: consoleFormat
}));

// Create specialized loggers for different modules
const createModuleLogger = (moduleName) => {
  return {
    info: (message, meta = {}) => logger.info(message, { module: moduleName, ...meta }),
    error: (message, meta = {}) => logger.error(message, { module: moduleName, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { module: moduleName, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { module: moduleName, ...meta }),
    http: (message, meta = {}) => logger.info(message, { module: moduleName, type: 'http', ...meta })
  };
};

// Export logger and module logger factory
module.exports = {
  logger,
  createModuleLogger
};
