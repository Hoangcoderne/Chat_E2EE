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
