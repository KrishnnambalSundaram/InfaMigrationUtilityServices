const {generateToken} = require("../utils/jwtUtils");

async function login(email, password) {
    try {
        // Hardcoded admin credentials
        const ADMIN_EMAILS = ["admin@admin.com", "admin@axxeltechnologies.com"];
        const ADMIN_PASSWORD = "Admin@123";
        
        // Check if credentials match admin
        if (ADMIN_EMAILS.includes(email) && password === ADMIN_PASSWORD) {
            // Create admin user object
            const adminUser = {
                _id: "admin_user_id",
                email: email,
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