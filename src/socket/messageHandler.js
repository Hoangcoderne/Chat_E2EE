// src/socket/messageHandler.js
// Xử lý tất cả sự kiện liên quan đến tin nhắn 1-1 (DM):
//   request_public_key, send_message, mark_read,
//   broadcast_delete_message, broadcast_reaction

const Message    = require('../models/Message');
const User       = require('../models/User');
const Friendship = require('../models/Friendship');
const logger     = require('../utils/logger');
const { validateSocketPayload, SCHEMAS } = require('../utils/socketValidator');

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
module.exports = function messageHandler(io, socket) {

    //  request_public_key: lấy public key + signing key của đối tác 
    socket.on('request_public_key', async (data) => {
        try {
            const check = validateSocketPayload(data, SCHEMAS.request_public_key);
            if (!check.valid) return socket.emit('error', check.error);

            const { username } = data;
            const user = await User.findOne({ username }).select('_id username publicKey signingPublicKey');
            if (user) {
                socket.emit('response_public_key', {
                    userId:         user._id.toString(),
                    publicKey:      user.publicKey,
                    signingPublicKey: user.signingPublicKey,
                    username:       user.username,
                });
            } else {
                socket.emit('error', 'User không tồn tại');
            }
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'request_public_key', error: err.message });
        }
    });

    //  send_message: relay tin nhắn E2EE
    socket.on('send_message', async (data) => {
        try {
            const check = validateSocketPayload(data, SCHEMAS.send_message);
            if (!check.valid) return socket.emit('error', check.error);

            const { recipientId, encryptedContent, iv, signature, replyTo } = data;

            if (!socket.userId)
                return socket.emit('error', 'Phiên kết nối bị gián đoạn. Vui lòng nhấn F5.');

            const senderId = socket.userId;

            // Kiểm tra quan hệ bạn bè
            const friendship = await Friendship.findOne({
                $or: [
                    { requester: senderId,    recipient: recipientId },
                    { requester: recipientId, recipient: senderId    },
                ],
            });

            if (!friendship || friendship.status === 'pending') {
                socket.emit('system_message', {
                    text: 'Hai bạn chưa phải là bạn bè. Hãy gửi lời mời kết bạn trước.',
                });
                io.to(recipientId).emit('system_message', {
                    text: `${socket.username || 'Ai đó'} cố gắng nhắn tin nhưng hai bạn chưa phải bạn bè.`,
                });
                return;
            }

            if (friendship.status === 'blocked') {
                socket.emit('error', 'Không thể gửi tin nhắn. Cuộc trò chuyện đã bị chặn.');
                return;
            }

            // Lưu vào DB — server chỉ lưu ciphertext, không bao giờ thấy plaintext
            const newMessage = new Message({
                sender:           senderId,
                recipient:        recipientId,
                encryptedContent,
                iv,
                signature:        signature || null,
                replyTo:          replyTo   || null,
            });
            await newMessage.save();

            const payload = {
                messageId:        newMessage._id.toString(),
                senderId,
                encryptedContent,
                iv,
                signature:        signature || null,
                replyTo:          newMessage.replyTo || null,
                timestamp:        newMessage.timestamp,
            };

            // Gửi tới recipient
            io.to(recipientId).emit('receive_message', payload);

            // Đồng bộ multi-device: gửi tới TẤT CẢ thiết bị của sender
            io.to(senderId).emit('message_sent_sync', {
                ...payload,
                senderSocketId: socket.id,
                recipientId,
            });

        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'send_message', error: err.message });
        }
    });

    //  mark_read: đánh dấu đã đọc khi mở chat 
    socket.on('mark_read', async ({ partnerId }) => {
        try {
            if (!socket.userId) return;

            const result = await Message.updateMany(
                { sender: partnerId, recipient: socket.userId, read: false },
                { read: true }
            );

            if (result.modifiedCount > 0) {
                io.to(partnerId).emit('messages_read', { by: socket.userId });
            }
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'mark_read', error: err.message });
        }
    });

    //  broadcast_delete_message: xoá tin nhắn real-time 
    socket.on('broadcast_delete_message', ({ messageId, recipientId }) => {
        if (!socket.userId) return;
        io.to(recipientId).emit('message_deleted', { messageId });
        io.to(socket.userId).emit('message_deleted', { messageId }); // sync thiết bị khác của sender
    });

    //  broadcast_reaction: cập nhật reaction real-time ─
    socket.on('broadcast_reaction', ({ messageId, reactions, partnerId }) => {
        if (!socket.userId) return;
        io.to(partnerId).emit('reaction_updated', { messageId, reactions });
        io.to(socket.userId).emit('reaction_updated', { messageId, reactions }); // sync thiết bị khác
    });

    //  notify_block / notify_unblock 
    socket.on('notify_block', ({ targetId }) => {
        if (!socket.userId) return;
        socket.to(targetId).emit('you_have_been_blocked', { blockerId: socket.userId });
    });

    socket.on('notify_unblock', ({ targetId }) => {
        if (!socket.userId) return;
        socket.to(targetId).emit('you_have_been_unblocked', { unblockerId: socket.userId });
    });
};
