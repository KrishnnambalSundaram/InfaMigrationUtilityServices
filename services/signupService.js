const User = require("../models/user");
const bcrypt = require("bcrypt");

async function createUser(userData) {
    try {
        const { name, email, password, companyName } = userData;
        const hashedPassword = await bcrypt.hash(password, 10);
        const createdUser = new User({
            name,
            email,
            password: hashedPassword,
            companyName
        });

        const savedUser = await createdUser.save();
        return savedUser;
    } catch (error) {        
        throw new Error(error.message);
    }


}

module.exports = { createUser };