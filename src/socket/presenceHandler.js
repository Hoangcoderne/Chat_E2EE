// src/socket/presenceHandler.js
// Xử lý sự kiện: kết nối / ngắt kết nối và trạng thái online của người dùng.
// userId và username đã được xác thực bởi JWT middleware trong socket/index.js.

const logger      = require('../utils/logger');
const onlineUsers = require('../utils/onlineUsers');

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
module.exports = function presenceHandler(io, socket) {

    // join_user: user join vào room cá nhân sau khi kết nối
    // userId đã được verify từ JWT middleware — không tin tưởng client gửi gì
    socket.on('join_user', () => {
        const userId = socket.userId; // Từ JWT, không phải từ client

        socket.join(userId);

        onlineUsers.addSocket(userId, socket.id);

        if (onlineUsers.isFirstSocket(userId)) {
            socket.broadcast.emit('user_status_change', { userId, status: 'online' });
        }

        logger.info({ event: 'user_online', userId, username: socket.username });
    });

    // disconnect: cleanup khi socket ngắt
    socket.on('disconnect', () => {
        if (!socket.userId) return;

        const remaining = onlineUsers.removeSocket(socket.userId, socket.id);

        if (remaining === 0) {
            socket.broadcast.emit('user_status_change', { userId: socket.userId, status: 'offline' });
            logger.info({ event: 'user_offline', userId: socket.userId });
        }
    });
};
