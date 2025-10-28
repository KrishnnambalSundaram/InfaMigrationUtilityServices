const {generateToken} = require("../utils/jwtUtils");

async function login(email, password) {
    try {
        // Hardcoded admin credentials
        const ADMIN_EMAIL = "admin@admin.com";
        const ADMIN_PASSWORD = "Admin@123";
        
        // Check if credentials match admin
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            // Create admin user object
            const adminUser = {
                _id: "admin_user_id",
                email: ADMIN_EMAIL,
                firstName: "Admin",
                lastName: "User",
                role: "admin"
            };
            
            const token = generateToken(adminUser);
            return {token, existingUser: adminUser};
        } else {
            throw new Error("Invalid credentials");
        }
    } catch (error) {
        throw new Error(error.message);
    }
}

module.exports = {
    login
};