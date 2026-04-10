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
const mongoose   = require('mongoose');
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

// ── Graceful Shutdown ──
// Xử lý SIGTERM (Docker/PM2 stop) và SIGINT (Ctrl+C) một cách an toàn.
// Thứ tự: ngừng nhận kết nối mới → đóng Socket.io → đóng DB → exit.
function gracefulShutdown(signal) {
    logger.info({ event: 'shutdown_initiated', signal });
    console.log(`\n>>> Received ${signal}. Shutting down gracefully...`);

    // 1. Ngừng nhận HTTP connections mới
    server.close(() => {
        logger.info({ event: 'http_server_closed' });

        // 2. Đóng tất cả Socket.io connections
        io.close(() => {
            logger.info({ event: 'socketio_closed' });

            // 3. Đóng kết nối MongoDB
            mongoose.connection.close(false).then(() => {
                logger.info({ event: 'mongodb_closed' });
                console.log('>>> All connections closed. Goodbye!');
                process.exit(0);
            });
        });
    });

    // Timeout: force exit sau 10 giây nếu shutdown bị treo
    setTimeout(() => {
        logger.error({ event: 'shutdown_timeout', message: 'Forced exit after 10s timeout' });
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info({ event: 'server_start', port: PORT, env: process.env.NODE_ENV || 'development' });
    console.log(`>>> SecureChat Server running on http://localhost:${PORT}`);
});
