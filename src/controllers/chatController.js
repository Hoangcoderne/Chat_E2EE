// src/controllers/chatController.js
const Message = require('../models/Message');
const User = require('../models/User');
const Friendship = require('../models/Friendship');

exports.getChatHistory = async (req, res) => {
    try {
        const { user1, user2 } = req.params;

        // Tìm tin nhắn mà (sender=user1 AND recipient=user2) HOẶC (sender=user2 AND recipient=user1)
        const messages = await Message.find({
            $or: [
                { sender: user1, recipient: user2 },
                { sender: user2, recipient: user1 }
            ]
        })
        .sort({ timestamp: 1 }); // Sắp xếp cũ nhất -> mới nhất

        res.json(messages);

    } catch (err) {
        console.error("Lỗi lấy lịch sử chat:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// API LẤY DANH SÁCH BẠN BÈ 
exports.getContacts = async (req, res) => {
    try {
        const currentUserId = req.params.userId;

        // Tìm tất cả quan hệ mà status = 'accepted' VÀ có dính dáng đến mình
        const friendships = await Friendship.find({
            $or: [{ requester: currentUserId }, { recipient: currentUserId }],
            status: 'accepted'
        }).populate('requester recipient', 'username _id'); // Lấy thông tin cả 2 bên

        // Map dữ liệu để tìm ra "người kia" là ai
        const contacts = friendships.map(f => {
            // Nếu mình là requester -> bạn là recipient, và ngược lại
            const friend = (f.requester._id.toString() === currentUserId) 
                            ? f.recipient 
                            : f.requester;
            
            return {
                _id: friend._id,
                username: friend.username,
                // Check Online (vẫn dùng biến global cũ)
                online: global.onlineUsers ? global.onlineUsers.has(friend._id.toString()) : false
            };
        });

        res.json(contacts);

    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

// API LẤY LỜI MỜI KẾT BẠN
exports.getFriendRequests = async (req, res) => {
    try {
        const currentUserId = req.params.userId;

        // Tìm các record mà MÌNH LÀ NGƯỜI NHẬN (recipient) và status = 'pending'
        const requests = await Friendship.find({
            recipient: currentUserId,
            status: 'pending'
        }).populate('requester', 'username _id');

        // Format lại cho đúng ý Frontend cần ({ fromId, fromUser })
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
        const userId = req.params.userId;
        const user = await User.findById(userId).select('notifications');
        
        // Sắp xếp mới nhất lên đầu
        const sortedNotifs = user.notifications.sort((a, b) => b.createdAt - a.createdAt);
        
        res.json(sortedNotifs);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};