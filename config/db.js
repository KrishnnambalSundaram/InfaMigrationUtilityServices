const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    if (process.env.MONGO_URI) {
      await mongoose.connect(process.env.MONGO_URI);
      console.log('MongoDB Atlas connected successfully');
    } else {
      console.log('MongoDB connection skipped - no MONGO_URI provided');
    }
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    console.log('Continuing without database connection for testing...');
  }
};

module.exports = connectDB;