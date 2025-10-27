const authService = require("../services/loginService");
const { logger } = require('../utils/logger');
const { catchAsync } = require('../middleware/errorHandler');

const login = catchAsync(async (req, res) => {
  try {
    const { email, password } = req.body;
    const { token, existingUser } = await authService.login(email, password);
    
    logger.info('User login successful', {
      userId: existingUser._id,
      email: existingUser.email,
      ip: req.ip
    });
    
    res.json({
      success: true,
      token: token, 
      user: existingUser
    });
  } catch (error) {
    logger.warn('User login failed', {
      error: error.message,
      email: req.body.email,
      ip: req.ip
    });
    throw error;
  }
});

module.exports = {
  login
};