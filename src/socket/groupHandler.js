// src/socket/groupHandler.js
// Xử lý tất cả sự kiện Socket.io liên quan đến nhóm chat:
//   join_groups, send_group_message, mark_group_read,
//   broadcast_group_member_added/removed, broadcast_delete_group_message,
//   broadcast_group_reaction, broadcast_group_left

const Group        = require('../models/Group');
const GroupMessage = require('../models/GroupMessage');
const logger       = require('../utils/logger');
const { validateSocketPayload, SCHEMAS } = require('../utils/socketValidator');

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
module.exports = function groupHandler(io, socket) {

    // join_groups: tham gia các socket room của nhóm — verify membership
    socket.on('join_groups', async (groupIds) => {
        if (!Array.isArray(groupIds) || groupIds.length > 100) return;
        try {
            // Query chỉ các group mà user thật sự là member
            const groups = await Group.find({
                _id: { $in: groupIds },
                'members.userId': socket.userId,
            }).select('_id');

            const validIds = groups.map(g => g._id.toString());
            validIds.forEach(gid => socket.join('group:' + gid));

            if (validIds.length < groupIds.length) {
                logger.warn({
                    event: 'join_groups_filtered',
                    userId: socket.userId,
                    requested: groupIds.length,
                    allowed: validIds.length,
                });
            }
        } catch (err) {
            logger.error({ event: 'join_groups_error', error: err.message });
        }
    });

    // send_group_message: relay tin nhắn nhóm E2EE
    socket.on('send_group_message', async (data) => {
        try {
            const check = validateSocketPayload(data, SCHEMAS.send_group_message);
            if (!check.valid) return socket.emit('error', check.error);

            const { groupId, encryptedContent, iv, signature, replyTo } = data;

            if (!socket.userId)
                return socket.emit('error', 'Phiên kết nối bị gián đoạn.');

            // Bảo mật: verify user thật sự là member của nhóm
            const group = await Group.findById(groupId);
            if (!group || !group.members.some(m => m.userId.toString() === socket.userId))
                return socket.emit('error', 'Bạn không trong nhóm này.');

            const msg = await GroupMessage.create({
                groupId,
                sender:           socket.userId,
                encryptedContent,
                iv,
                signature:        signature || null,
                readBy:           [socket.userId], // sender tự coi là đã đọc
                replyTo:          replyTo   || null,
            });

            const payload = {
                messageId:        msg._id.toString(),
                groupId,
                senderId:         socket.userId,
                senderName:       socket.username,
                encryptedContent,
                iv,
                signature:        signature || null,
                timestamp:        msg.timestamp,
                replyTo:          msg.replyTo || null,
            };

            // Broadcast tới các member khác (trừ sender)
            socket.to('group:' + groupId).emit('receive_group_message', payload);

            // Sync multi-device của chính sender
            io.to(socket.userId).emit('group_message_sent_sync', {
                ...payload,
                senderSocketId: socket.id,
            });

        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'send_group_message', error: err.message });
        }
    });

    // mark_group_read: đánh dấu đã đọc toàn bộ tin trong nhóm
    socket.on('mark_group_read', async ({ groupId }) => {
        try {
            if (!socket.userId) return;

            await GroupMessage.updateMany(
                { groupId, readBy: { $ne: socket.userId } },
                { $addToSet: { readBy: socket.userId } }
            );

            // Thông báo cho các member khác biết user này đã đọc
            socket.to('group:' + groupId).emit('group_read_update', {
                groupId,
                userId:   socket.userId,
                username: socket.username,
            });
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'mark_group_read', error: err.message });
        }
    });

    // broadcast_group_member_added: admin thêm thành viên
    socket.on('broadcast_group_member_added', async ({ groupId, newMemberIds, groupName }) => {
        if (!socket.userId) return;
        try {
            const group = await Group.findById(groupId).populate('members.userId', 'username _id');
            if (!group) return;

            const memberCount    = group.members.length;
            const newMembers     = group.members.filter(m =>
                newMemberIds.includes((m.userId?._id || m.userId).toString())
            );
            const newMemberNames = newMembers.map(m => m.userId?.username || '').filter(Boolean);

            // Thông báo toàn bộ nhóm về thành viên mới
            io.to('group:' + groupId).emit('group_member_added', {
                groupId,
                memberCount,
                newMemberNames,
            });

            // Lưu system message vào DB cho mỗi thành viên mới
            for (const name of newMemberNames) {
                await GroupMessage.create({
                    groupId,
                    sender:           socket.userId,
                    type:             'system',
                    systemText:       `${name} đã tham gia nhóm`,
                    encryptedContent: 'system',
                    iv:               'system',
                });
            }

            // Thông báo riêng cho từng member mới để họ render group vào sidebar
            if (Array.isArray(newMemberIds)) {
                newMemberIds.forEach(uid => {
                    io.to(uid).emit('group_invited', { groupId, groupName, memberCount });
                });
            }
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'broadcast_group_member_added', error: err.message });
        }
    });

    // broadcast_group_member_removed: admin xoá thành viên
    socket.on('broadcast_group_member_removed', ({ groupId, removedUserId, removedName }) => {
        if (!socket.userId) return;
        io.to('group:' + groupId).emit('group_member_removed', { groupId, removedUserId, removedName });
        io.to(removedUserId).emit('group_kicked', { groupId });
    });

    // broadcast_delete_group_message: xoá tin nhắn nhóm real-time
    socket.on('broadcast_delete_group_message', ({ groupId, messageId }) => {
        if (!socket.userId) return;
        // Dùng socket.to() (không bao gồm sender — sender đã tự remove khỏi UI rồi)
        socket.to('group:' + groupId).emit('message_deleted', { messageId });
    });

    // broadcast_group_reaction: cập nhật reaction nhóm real-time
    socket.on('broadcast_group_reaction', ({ groupId, messageId, reactions }) => {
        if (!socket.userId) return;
        socket.to('group:' + groupId).emit('reaction_updated', { messageId, reactions });
    });

    // broadcast_group_left: user tự rời nhóm
    socket.on('broadcast_group_left', ({ groupId, leavingName }) => {
        if (!socket.userId) return;
        socket.to('group:' + groupId).emit('group_member_removed', {
            groupId,
            removedUserId: socket.userId,
            leavingName,
        });
        socket.leave('group:' + groupId);
    });
};
