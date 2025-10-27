const User = require("../models/user");
const bcrypt = require("bcrypt");
const {generateToken} = require("../utils/jwtUtils");

async function login(email,password) {
    try {
        const existingUser=await User.findOne({email});
        if(!existingUser){
            throw new Error("User not found");
        }
        const isPasswordValid = await bcrypt.compare(password,existingUser.password);    
        if(!isPasswordValid){
            throw new Error("Incorrect password");
        }
        const token = generateToken(existingUser);
        return {token, existingUser};
    } catch (error) {
        throw new Error(error.message);
    }
}

module.exports = {
    login
};