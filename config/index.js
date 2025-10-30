const path = require('path');

function getBool(envVal, defaultVal = false) {
  if (envVal === undefined) return defaultVal;
  return /^(1|true|yes|on)$/i.test(String(envVal));
}

function resolvePathOrDefault(envKey, def) {
  const v = process.env[envKey];
  return path.resolve(v || def);
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3001),
  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  paths: {
    uploads: resolvePathOrDefault('UPLOAD_PATH', './uploads'),
    zips: resolvePathOrDefault('ZIPS_PATH', './zips'),
    output: resolvePathOrDefault('OUTPUT_PATH', './output'),
    idmc: resolvePathOrDefault('IDMC_PATH', './idmc'),
    logs: resolvePathOrDefault('LOG_FILE_PATH', './logs'),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    prettyConsole: getBool(process.env.LOG_PRETTY_CONSOLE, true),
  }
};

module.exports = config;


