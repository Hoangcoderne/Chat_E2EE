// src/socket/index.js
// Khởi tạo Socket.io connection listener và đăng ký các handler theo domain.
// Mỗi handler file chỉ xử lý một nhóm sự kiện liên quan.

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
    io.on('connection', (socket) => {
        logger.info({ event: 'socket_connected', socketId: socket.id });

        // Gắn io vào socket để các handler có thể broadcast tới rooms khác
        socket.io = io;

        // ── Đăng ký handlers theo domain ──────────────────────────────────
        presenceHandler(io, socket);
        messageHandler(io, socket);
        friendHandler(io, socket);
        groupHandler(io, socket);
    });
}

module.exports = registerSocketHandlers;
