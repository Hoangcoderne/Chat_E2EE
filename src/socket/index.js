// src/socket/index.js
// Khởi tạo Socket.io connection listener và đăng ký các handler theo domain.
// Mỗi handler file chỉ xử lý một nhóm sự kiện liên quan.

const jwt              = require('jsonwebtoken');
const logger           = require('../utils/logger');
const presenceHandler  = require('./presenceHandler');
const messageHandler   = require('./messageHandler');
const friendHandler    = require('./friendHandler');
const groupHandler     = require('./groupHandler');

/**
 * Đăng ký tất cả Socket.io event handlers lên instance io.
 * Được gọi một lần duy nhất từ server.js.
 * @param {import('socket.io').Server} io
 */
function registerSocketHandlers(io) {
    // Connection rate limiting — chống reconnect spam / DDoS
    const connectionAttempts = new Map(); // Map<ip, { count, resetTime }>
    const MAX_CONNECTIONS_PER_WINDOW = 10;
    const WINDOW_MS = 30000; // 30 giây

    io.use((socket, next) => {
        const ip = socket.handshake.address;
        const now = Date.now();
        let entry = connectionAttempts.get(ip);

        if (!entry || now > entry.resetTime) {
            entry = { count: 0, resetTime: now + WINDOW_MS };
            connectionAttempts.set(ip, entry);
        }

        entry.count++;
        if (entry.count > MAX_CONNECTIONS_PER_WINDOW) {
            logger.warn({ event: 'socket_rate_limited', ip, count: entry.count });
            return next(new Error('Too many connection attempts. Try again later.'));
        }
        next();
    });

    // JWT authentication middleware — chặn kết nối không có token hợp lệ
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            logger.warn({ event: 'socket_auth_rejected', reason: 'missing_token', socketId: socket.id });
            return next(new Error('Authentication required'));
        }
        try {
            const decoded = jwt.verify(token, process.env.SESSION_SECRET);
            socket.userId   = decoded.userId;
            socket.username = decoded.username;
            next();
        } catch (err) {
            logger.warn({ event: 'socket_auth_rejected', reason: err.message, socketId: socket.id });
            next(new Error('Invalid or expired token'));
        }
    });

    io.on('connection', (socket) => {
        logger.info({ event: 'socket_connected', socketId: socket.id, userId: socket.userId });

        // Gắn io vào socket để các handler có thể broadcast tới rooms khác
        socket.io = io;

        // Đăng ký handlers theo domain
        presenceHandler(io, socket);
        messageHandler(io, socket);
        friendHandler(io, socket);
        groupHandler(io, socket);
    });
}

module.exports = registerSocketHandlers;
