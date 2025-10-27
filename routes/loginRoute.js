const express = require('express');
const router = express.Router();
const loginController = require("../controllers/loginController");
const { validateUserLogin } = require('../middleware/validation');
const { authLimiter } = require('../middleware/security');

router.post('/login', authLimiter, validateUserLogin, loginController.login);

module.exports = router;