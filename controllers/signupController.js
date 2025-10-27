const userService = require('../services/signupService');
const { logger } = require('../utils/logger');
const { catchAsync } = require('../middleware/errorHandler');

const createUser = catchAsync(async (req, res) => {
  try {
    const userData = req.body;
    const user = await userService.createUser(userData);
    
    logger.info('User created successfully', {
      userId: user._id,
      email: user.email,
      ip: req.ip
    });
    
    res.status(201).json({
      success: true,
      user: user, 
      message: "User created successfully"
    });
  } catch (error) {
    logger.error('User creation failed', {
      error: error.message,
      email: req.body.email,
      ip: req.ip
    });
    throw error;
  }
});

module.exports = { createUser };
