// Security middleware temporarily disabled for debugging
// Keeping exports as no-ops to avoid changing app wiring.

const passThrough = (req, res, next) => next();
const generalLimiter = passThrough;

const authLimiter = passThrough;

const uploadLimiter = passThrough;

const conversionLimiter = passThrough;
const securityHeaders = passThrough;

const requestSizeLimiter = passThrough;

// Helper function removed - no size limits for internal app

const ipWhitelist = () => passThrough;

module.exports = {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  conversionLimiter,
  securityHeaders,
  requestSizeLimiter,
  ipWhitelist
};
