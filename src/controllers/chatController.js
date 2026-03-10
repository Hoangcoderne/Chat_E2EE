// src/controllers/chatController.js
const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const Friendship = require('../models/Friendship');

exports.getChatHistory = async (req, res) => {
    try {
        const currentUserId = req.user.userId; // Lấy từ Token
        const { partnerId } = req.params;      // Lấy từ URL

        const messages = await Message.find({
            $or: [
                { sender: currentUserId, recipient: partnerId },
                { sender: partnerId, recipient: currentUserId }
            ]
        }).sort({ timestamp: 1 });

        res.json(messages);
    } catch (err) {
        console.error("Lỗi lấy lịch sử chat:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// API LẤY DANH SÁCH BẠN BÈ 
exports.getContacts = async (req, res) => {
    try {
        const currentUserId = req.user.userId;

        // Lấy CẢ bạn bè (accepted) và người bị chặn (blocked)
        const friendships = await Friendship.find({
            $or: [{ requester: currentUserId }, { recipient: currentUserId }],
            status: { $in: ['accepted', 'blocked'] } 
        }).populate('requester recipient', 'username _id');

        const contacts = friendships.map(f => {
            const isRequester = f.requester._id.toString() === currentUserId;
            const friend = isRequester ? f.recipient : f.requester;
            
            return {
                _id: friend._id,
                username: friend.username,
                online: global.onlineUsers ? global.onlineUsers.has(friend._id.toString()) : false,
                status: f.status,
                // Do logic blockUser cũ: Ai chủ động chặn sẽ được set làm requester
                isBlocker: (f.status === 'blocked' && isRequester) 
            };
        });

        res.json(contacts);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

// 2. THÊM HÀM MỚI Ở CUỐI FILE: Mở chặn
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

// API LẤY LỜI MỜI KẾT BẠN
exports.getFriendRequests = async (req, res) => {
    try {
        const currentUserId = req.user.userId; // Lấy từ Token

        const requests = await Friendship.find({
            recipient: currentUserId,
            status: 'pending'
        }).populate('requester', 'username _id');

        const formattedRequests = requests.map(req => ({
            fromId: req.requester._id,
            fromUser: req.requester.username
        }));
        res.json(formattedRequests);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const currentUserId = req.user.userId; // Lấy từ Token
        const user = await User.findById(currentUserId).select('notifications');
        
        const sortedNotifs = user.notifications.sort((a, b) => b.createdAt - a.createdAt);
        res.json(sortedNotifs);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

// Hủy kết bạn (Xóa record)
exports.unfriend = async (req, res) => {
    try {
        const { targetId } = req.body;
        const currentUserId = req.user.userId; // Lấy từ authMiddleware

        // 1. Validate định dạng ObjectId
        if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
            return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ." });
        }

        // 2. Thực hiện xóa
        const result = await Friendship.findOneAndDelete({
            $or: [
                { requester: currentUserId, recipient: targetId },
                { requester: targetId, recipient: currentUserId }
            ]
        });

        // 3. Kiểm tra xem có thật sự xóa được record nào không
        if (!result) {
            return res.status(404).json({ success: false, message: "Không tìm thấy quan hệ bạn bè để xóa." });
        }

        res.json({ success: true, message: "Đã hủy kết bạn." });
    } catch (err) {
        console.error("Lỗi Unfriend:", err);
        res.status(500).json({ success: false, message: "Lỗi server." });
    }
};

// Chặn người dùng
exports.blockUser = async (req, res) => {
    try {
        const { targetId } = req.body;
        const currentUserId = req.user.userId;

        // 1. Validate định dạng ObjectId
        if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
            return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ." });
        }

        // [FIX] Xóa record cũ trước, rồi tạo mới với đúng chiều requester=blocker
        // Tránh vi phạm unique index khi đảo chiều (A,B) -> (B,A)
        await Friendship.findOneAndDelete({
            $or: [
                { requester: currentUserId, recipient: targetId },
                { requester: targetId, recipient: currentUserId }
            ]
        });

        await Friendship.create({
            requester: currentUserId, // Người chặn luôn là requester
            recipient: targetId,
            status: 'blocked'
        });

        res.json({ success: true, message: "Đã chặn người dùng." });
    } catch (err) {
        console.error("Lỗi Block:", err);
        res.status(500).json({ success: false, message: "Lỗi server." });
    }
};