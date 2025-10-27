const express = require('express');
const router = express.Router();
const signupController = require("../controllers/signupController");
const { validateUserRegistration } = require('../middleware/validation');
const { authLimiter } = require('../middleware/security');

router.post('/signup', authLimiter, validateUserRegistration, signupController.createUser);

module.exports = router;