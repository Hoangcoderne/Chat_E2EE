// src/server.js
// Entry point: kiểm tra env → kết nối DB → khởi tạo HTTP + Socket.io → lắng nghe.

require('dotenv').config();

// Kiểm tra biến môi trường bắt buộc
const REQUIRED_ENV = ['MONGO_URI', 'SESSION_SECRET', 'FRONTEND_URL'];
REQUIRED_ENV.forEach(key => {
    if (!process.env[key]) {
        console.error(`[FATAL] Thiếu biến môi trường bắt buộc: ${key}`);
        console.error('Hãy kiểm tra file .env của bạn.');
        process.exit(1);
    }
});

const http       = require('http');
const { Server } = require('socket.io');
const connectDB  = require('./config/db');
const logger     = require('./utils/logger');
const app        = require('./app');
const registerSocketHandlers = require('./socket');

// HTTP server
const server = http.createServer(app);

// Socket.io
const io = new Server(server, {
    cors: {
        origin:      process.env.FRONTEND_URL,
        methods:     ['GET', 'POST'],
        credentials: true,
    },
});

// Đăng ký toàn bộ Socket.io event handlers
registerSocketHandlers(io);

// Database
connectDB();

// Process-level error guards
process.on('unhandledRejection', (reason) => {
    logger.error({ event: 'unhandled_rejection', error: String(reason) });
});

process.on('uncaughtException', (err) => {
    logger.error({ event: 'uncaught_exception', error: err.message, stack: err.stack });
    process.exit(1); // Crash có kiểm soát để PM2 / Docker restart lại
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info({ event: 'server_start', port: PORT, env: process.env.NODE_ENV || 'development' });
    console.log(`>>> SecureChat Server running on http://localhost:${PORT}`);
});
