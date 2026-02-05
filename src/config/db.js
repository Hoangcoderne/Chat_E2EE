// src/config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        // Thử kết nối với URI lấy từ biến môi trường
        const conn = await mongoose.connect(process.env.MONGO_URI);
        
        console.log(`\n========================================`);
        console.log(`MongoDB Connected Successfully!`);
        console.log(`Host: ${conn.connection.host}`);
        console.log(`Database Name: ${conn.connection.name}`);
        console.log(`========================================\n`);
    } catch (error) {
        console.error(`\nMongoDB Connection Error: ${error.message}`);
        // Dừng server nếu lỗi database nghiêm trọng
        process.exit(1);
    }
};

module.exports = connectDB;