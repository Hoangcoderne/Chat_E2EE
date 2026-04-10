// src/socket/friendHandler.js
// Xử lý tất cả sự kiện liên quan đến kết bạn:
//   send_friend_request, accept_friend_request, clear_notification

const User       = require('../models/User');
const Friendship = require('../models/Friendship');
const logger     = require('../utils/logger');

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
module.exports = function friendHandler(io, socket) {

    // send_friend_request
    socket.on('send_friend_request', async ({ targetUsername }) => {
        try {
            if (!socket.userId)
                return socket.emit('error', 'Phiên kết nối bị gián đoạn. Vui lòng nhấn F5.');

            const targetUser = await User.findOne({ username: targetUsername }).select('_id username');
            if (!targetUser)
                return socket.emit('error', 'Người dùng không tồn tại');
            if (targetUser._id.toString() === socket.userId)
                return socket.emit('error', 'Không thể kết bạn với chính mình');

            const existing = await Friendship.findOne({
                $or: [
                    { requester: socket.userId, recipient: targetUser._id },
                    { requester: targetUser._id, recipient: socket.userId },
                ],
            });

            if (existing) {
                if (existing.status === 'accepted') return socket.emit('error', 'Hai bạn đã là bạn bè');
                if (existing.status === 'pending')  return socket.emit('error', 'Đang chờ chấp nhận');
            }

            await new Friendship({
                requester: socket.userId,
                recipient: targetUser._id,
                status:    'pending',
            }).save();

            // Thông báo real-time tới người nhận
            socket.to(targetUser._id.toString()).emit('receive_friend_request', {
                fromUser: socket.username,
                fromId:   socket.userId,
            });

            // Lưu notification vào DB của người gửi
            const notifContent = `Đã gửi lời mời tới ${targetUsername}`;
            await User.findByIdAndUpdate(socket.userId, {
                $push: { notifications: { content: notifContent, type: 'friend_request_sent' } },
            });

            socket.emit('request_sent_success', notifContent);

        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'send_friend_request', error: err.message });
            socket.emit('error', 'Lỗi server');
        }
    });

    // accept_friend_request
    socket.on('accept_friend_request', async ({ requesterId }) => {
        try {
            if (!socket.userId)
                return socket.emit('error', 'Phiên kết nối bị gián đoạn. Vui lòng nhấn F5.');

            const friendship = await Friendship.findOneAndUpdate(
                { requester: requesterId, recipient: socket.userId, status: 'pending' },
                { status: 'accepted' },
                { new: true }
            );
            if (!friendship) return;

            // Lưu notification cho người gửi lời mời
            const notifContent = `${socket.username} đã chấp nhận lời mời kết bạn!`;
            await User.findByIdAndUpdate(requesterId, {
                $push: { notifications: { content: notifContent, type: 'friend_accept' } },
            });

            // Thông báo cho người gửi lời mời
            socket.to(requesterId).emit('request_accepted', {
                accepterId:   socket.userId,
                accepterName: socket.username,
                notification: { content: notifContent },
            });

            // Kích hoạt handshake E2EE phía accepter
            const requester = await User.findById(requesterId).select('username');
            socket.emit('start_handshake_init', {
                targetId:       requesterId,
                targetUsername: requester.username,
            });

            logger.info({ event: 'friend_accepted', accepter: socket.userId, requester: requesterId });
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'accept_friend_request', error: err.message });
        }
    });

    // clear_notification: xoá một notification cụ thể
    socket.on('clear_notification', async ({ notifId }) => {
        try {
            if (!notifId || notifId.toString().startsWith('temp_')) return;
            await User.findByIdAndUpdate(socket.userId, {
                $pull: { notifications: { _id: notifId } },
            });
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'clear_notification', error: err.message });
        }
    });
};
