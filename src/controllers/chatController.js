// src/controllers/chatController.js
const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const Friendship = require('../models/Friendship');

// ── Lịch sử chat ──────────────────────────────────────────────
exports.getChatHistory = async (req, res) => {
    try {
        const currentUserId = req.user.userId;
        const { partnerId } = req.params;

        const messages = await Message.find({
            $or: [
                { sender: currentUserId, recipient: partnerId },
                { sender: partnerId, recipient: currentUserId }
            ]
        }).sort({ timestamp: 1 });

        // [MỚI] Đánh dấu đã đọc tất cả tin nhắn từ partner → mình
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

// ── Danh sách bạn bè + unread count ───────────────────────────
exports.getContacts = async (req, res) => {
    try {
        const currentUserId = req.user.userId;

        const friendships = await Friendship.find({
            $or: [{ requester: currentUserId }, { recipient: currentUserId }],
            status: { $in: ['accepted', 'blocked'] }
        }).populate('requester recipient', 'username _id');

        // [MỚI] Aggregate số tin chưa đọc từng người gửi
        const unreadAgg = await Message.aggregate([
            {
                $match: {
                    recipient: new mongoose.Types.ObjectId(currentUserId),
                    read: false
                }
            },
            { $group: { _id: '$sender', count: { $sum: 1 } } }
        ]);

        // Map: senderId → unreadCount
        const unreadMap = {};
        unreadAgg.forEach(({ _id, count }) => {
            unreadMap[_id.toString()] = count;
        });

        const contacts = friendships.map(f => {
            const isRequester = f.requester._id.toString() === currentUserId;
            const friend = isRequester ? f.recipient : f.requester;

            return {
                _id: friend._id,
                username: friend.username,
                online: global.onlineUsers ? global.onlineUsers.has(friend._id.toString()) : false,
                status: f.status,
                isBlocker: (f.status === 'blocked' && isRequester),
                // [MỚI] Số tin nhắn chưa đọc từ người này
                unreadCount: unreadMap[friend._id.toString()] || 0
            };
        });

        res.json(contacts);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

// ── Bỏ chặn ───────────────────────────────────────────────────
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

// ── Lời mời kết bạn ───────────────────────────────────────────
exports.getFriendRequests = async (req, res) => {
    try {
        const currentUserId = req.user.userId;

        const requests = await Friendship.find({
            recipient: currentUserId,
            status: 'pending'
        }).populate('requester', 'username _id');

        res.json(requests.map(r => ({
            fromId: r.requester._id,
            fromUser: r.requester.username
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

// ── Thông báo ─────────────────────────────────────────────────
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

// ── Hủy kết bạn ───────────────────────────────────────────────
exports.unfriend = async (req, res) => {
    try {
        const { targetId } = req.body;
        const currentUserId = req.user.userId;

        if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
            return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ." });
        }

        const result = await Friendship.findOneAndDelete({
            $or: [
                { requester: currentUserId, recipient: targetId },
                { requester: targetId, recipient: currentUserId }
            ]
        });

        if (!result) {
            return res.status(404).json({ success: false, message: "Không tìm thấy quan hệ bạn bè." });
        }

        res.json({ success: true, message: "Đã hủy kết bạn." });
    } catch (err) {
        console.error("Lỗi Unfriend:", err);
        res.status(500).json({ success: false, message: "Lỗi server." });
    }
};

// ── Chặn người dùng ───────────────────────────────────────────
exports.blockUser = async (req, res) => {
    try {
        const { targetId } = req.body;
        const currentUserId = req.user.userId;

        if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
            return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ." });
        }

        await Friendship.findOneAndDelete({
            $or: [
                { requester: currentUserId, recipient: targetId },
                { requester: targetId, recipient: currentUserId }
            ]
        });

        await Friendship.create({
            requester: currentUserId,
            recipient: targetId,
            status: 'blocked'
        });

        res.json({ success: true, message: "Đã chặn người dùng." });
    } catch (err) {
        console.error("Lỗi Block:", err);
        res.status(500).json({ success: false, message: "Lỗi server." });
    }
};