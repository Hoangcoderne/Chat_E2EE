// src/controllers/chatController.js
const mongoose = require('mongoose');
const Message    = require('../models/Message');
const User       = require('../models/User');
const Friendship = require('../models/Friendship');

// Lịch sử chat 
exports.getChatHistory = async (req, res) => {
    try {
        const currentUserId = req.user.userId;
        const { partnerId }  = req.params;

        const messages = await Message.find({
            $or: [
                { sender: currentUserId, recipient: partnerId },
                { sender: partnerId,     recipient: currentUserId }
            ]
        }).sort({ timestamp: 1 });

        await Message.updateMany(
            { sender: partnerId, recipient: currentUserId, read: false },
            { read: true }
        );

        res.json(messages);
    } catch (err) {
        console.error("Lỗi lấy lịch sử chat:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// Danh sách bạn bè + unread count 
exports.getContacts = async (req, res) => {
    try {
        const currentUserId = req.user.userId;

        const friendships = await Friendship.find({
            $or: [{ requester: currentUserId }, { recipient: currentUserId }],
            status: { $in: ['accepted', 'blocked'] }
        }).populate('requester recipient', 'username _id');

        const unreadAgg = await Message.aggregate([
            { $match: { recipient: new mongoose.Types.ObjectId(currentUserId), read: false } },
            { $group: { _id: '$sender', count: { $sum: 1 } } }
        ]);

        const unreadMap = {};
        unreadAgg.forEach(({ _id, count }) => { unreadMap[_id.toString()] = count; });

        const contacts = friendships.map(f => {
            const isRequester = f.requester._id.toString() === currentUserId;
            const friend       = isRequester ? f.recipient : f.requester;
            return {
                _id:         friend._id,
                username:    friend.username,
                online:      global.onlineUsers ? global.onlineUsers.has(friend._id.toString()) : false,
                status:      f.status,
                isBlocker:   (f.status === 'blocked' && isRequester),
                unreadCount: unreadMap[friend._id.toString()] || 0
            };
        });

        res.json(contacts);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

// Bỏ chặn 
exports.unblockUser = async (req, res) => {
    try {
        const { targetId } = req.body;
        const currentUserId = req.user.userId;
        const friendship = await Friendship.findOneAndUpdate(
            { requester: currentUserId, recipient: targetId, status: 'blocked' },
            { status: 'accepted' },
            { new: true }
        );
        if (!friendship) return res.status(400).json({ success: false, message: "Không thể bỏ chặn" });
        res.json({ success: true, message: "Đã bỏ chặn thành công" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// Lời mời kết bạn 
exports.getFriendRequests = async (req, res) => {
    try {
        const currentUserId = req.user.userId;
        const requests = await Friendship.find({
            recipient: currentUserId, status: 'pending'
        }).populate('requester', 'username _id');
        res.json(requests.map(r => ({ fromId: r.requester._id, fromUser: r.requester.username })));
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

// Thông báo 
exports.getNotifications = async (req, res) => {
    try {
        const currentUserId = req.user.userId;
        const user = await User.findById(currentUserId).select('notifications');
        res.json(user.notifications.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

// Hủy kết bạn 
exports.unfriend = async (req, res) => {
    try {
        const { targetId } = req.body;
        const currentUserId = req.user.userId;
        if (!targetId || !mongoose.Types.ObjectId.isValid(targetId))
            return res.status(400).json({ success: false, message: "ID không hợp lệ." });
        const result = await Friendship.findOneAndDelete({
            $or: [
                { requester: currentUserId, recipient: targetId },
                { requester: targetId,      recipient: currentUserId }
            ]
        });
        if (!result) return res.status(404).json({ success: false, message: "Không tìm thấy quan hệ bạn bè." });
        res.json({ success: true, message: "Đã hủy kết bạn." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Lỗi server." });
    }
};

// Chặn người dùng 
exports.blockUser = async (req, res) => {
    try {
        const { targetId } = req.body;
        const currentUserId = req.user.userId;
        if (!targetId || !mongoose.Types.ObjectId.isValid(targetId))
            return res.status(400).json({ success: false, message: "ID không hợp lệ." });
        await Friendship.findOneAndDelete({
            $or: [
                { requester: currentUserId, recipient: targetId },
                { requester: targetId,      recipient: currentUserId }
            ]
        });
        await Friendship.create({ requester: currentUserId, recipient: targetId, status: 'blocked' });
        res.json({ success: true, message: "Đã chặn người dùng." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Lỗi server." });
    }
};

// Xoá tin nhắn hoàn toàn khỏi database 
exports.deleteMessage = async (req, res) => {
    try {
        const { messageId } = req.body;
        const currentUserId = req.user.userId;

        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId))
            return res.status(400).json({ success: false, message: "messageId không hợp lệ." });

        const msg = await Message.findById(messageId);
        if (!msg)
            return res.status(404).json({ success: false, message: "Tin nhắn không tồn tại." });

        // Chỉ người gửi mới được xoá
        if (msg.sender.toString() !== currentUserId)
            return res.status(403).json({ success: false, message: "Bạn không có quyền xoá tin nhắn này." });

        const recipientId = msg.recipient.toString();
        await Message.findByIdAndDelete(messageId);

        res.json({ success: true, messageId, recipientId });
    } catch (err) {
        console.error("Lỗi xoá tin nhắn:", err);
        res.status(500).json({ success: false, message: "Lỗi server." });
    }
};

// Toggle cảm xúc 
// Chưa có → thêm | cùng emoji → xoá (toggle off) | khác emoji → đổi
exports.toggleReaction = async (req, res) => {
    try {
        const { messageId, emoji } = req.body;
        const currentUserId = req.user.userId;

        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId))
            return res.status(400).json({ success: false, message: "messageId không hợp lệ." });

        const VALID = ['👍','❤️','😂','😮','😢','😡'];
        if (!VALID.includes(emoji))
            return res.status(400).json({ success: false, message: "Emoji không hợp lệ." });

        const msg = await Message.findById(messageId);
        if (!msg)
            return res.status(404).json({ success: false, message: "Tin nhắn không tồn tại." });

        const isSender    = msg.sender.toString()    === currentUserId;
        const isRecipient = msg.recipient.toString() === currentUserId;
        if (!isSender && !isRecipient)
            return res.status(403).json({ success: false, message: "Không có quyền react." });

        const existing = msg.reactions.find(r => r.userId.toString() === currentUserId);

        if (existing) {
            if (existing.emoji === emoji) {
                // Toggle off
                msg.reactions = msg.reactions.filter(r => r.userId.toString() !== currentUserId);
            } else {
                existing.emoji = emoji; // Đổi emoji
            }
        } else {
            msg.reactions.push({ emoji, userId: currentUserId });
        }

        await msg.save();

        const partnerId = isSender ? msg.recipient.toString() : msg.sender.toString();
        res.json({ success: true, reactions: msg.reactions, messageId, partnerId });
    } catch (err) {
        console.error("Lỗi toggle reaction:", err);
        res.status(500).json({ success: false, message: "Lỗi server." });
    }
};