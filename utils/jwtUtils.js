const jwt = require('jsonwebtoken');

function generateToken(user){
    const payload = {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
    }
    return jwt.sign(payload, process.env.JWT_SECRET);
};

module.exports = {
    generateToken
};