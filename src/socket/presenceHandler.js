// src/socket/presenceHandler.js
// Xử lý sự kiện: kết nối / ngắt kết nối và trạng thái online của người dùng.

const User   = require('../models/User');
const logger = require('../utils/logger');

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
module.exports = function presenceHandler(io, socket) {

    // ── join_user: user xác nhận danh tính sau khi kết nối ────────────────
        socket.on('join_user', async (userId) => {
            try {
                socket.join(userId);
                socket.userId = userId;

                const user = await User.findById(userId).select('username');
                if (user) socket.username = user.username;

                if (!global.onlineUsers.has(userId)) {
                    global.onlineUsers.set(userId, new Set());
                }
                global.onlineUsers.get(userId).add(socket.id);

                if (global.onlineUsers.get(userId).size === 1) {
                    socket.broadcast.emit('user_status_change', { userId, status: 'online' });
                }

            } catch (err) {
                logger.error({ event: 'socket_error', handler: 'join_user', error: err.message });
            }
        });

    // ── disconnect: cleanup khi socket ngắt ───────────────────────────────
    socket.on('disconnect', () => {
        if (socket.userId) {
            const sockets = global.onlineUsers.get(socket.userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    global.onlineUsers.delete(socket.userId);
                    // Chỉ broadcast offline khi không còn tab nào
                    socket.broadcast.emit('user_status_change', { userId: socket.userId, status: 'offline' });
                    logger.info({ event: 'user_offline', userId: socket.userId });
                }
            }
        }
    });
};
