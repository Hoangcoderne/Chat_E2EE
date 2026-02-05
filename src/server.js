// src/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const connectDB = require('./config/db');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const Message = require('./models/Message'); // Import Model
const User = require('./models/User');
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const Friendship = require('./models/Friendship');
// Cấu hình Socket.io
const io = new Server(server, {
    cors: {
        origin: "*", // Trong production nên giới hạn domain cụ thể
        methods: ["GET", "POST"]
    }
});

global.onlineUsers = new Set();
connectDB();

// Middleware: Phục vụ file tĩnh từ thư mục 'public' (Frontend)
// Đây là nơi chứa HTML, CSS, JS của Client
app.use(express.static(path.join(__dirname, '../public')));

app.use(express.json()); // Middleware: Xử lý JSON payload

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// --- SOCKET.IO EVENTS (Relay Server) ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // 1. User online -> Join vào room riêng của mình
    socket.on('join_user', async (userId) => {
        socket.join(userId);
        // Lưu userId vào socket để dùng khi disconnect
        socket.userId = userId; 
        global.onlineUsers.add(userId);
        const User = require('./models/User');
        const user = await User.findById(userId);
        if(user) socket.username = user.username; // Lưu tên để dùng
        // Báo cho tất cả mọi người biết user này vừa Online
        socket.broadcast.emit('user_status_change', { userId, status: 'online' });
    });

    // 2. Lấy Public Key của người khác để bắt đầu chat
    socket.on('request_public_key', async ({ username }) => {
        try {
            const user = await User.findOne({ username });
            if (user) {
                // Trả về Public Key cho người yêu cầu
                socket.emit('response_public_key', {
                    userId: user._id,
                    publicKey: user.publicKey
                });
            } else {
                socket.emit('error', 'User not found');
            }
        } catch (err) {
            console.error(err);
        }
    });

    // 3. Gửi tin nhắn E2EE
    socket.on('send_message', async ({ senderId, recipientId, encryptedContent, iv }) => {
        try {
            // A. Lưu vào DB (Lịch sử chat) - Chỉ lưu dạng mã hóa
            const newMessage = new Message({
                sender: senderId,
                recipient: recipientId,
                encryptedContent,
                iv
            });
            await newMessage.save();

            // B. Gửi realtime tới người nhận (Nếu họ online)
            // Gửi tới Room có tên là recipientId
            io.to(recipientId).emit('receive_message', {
                senderId,
                encryptedContent,
                iv,
                timestamp: newMessage.timestamp
            });

        } catch (err) {
            console.error("Lỗi gửi tin nhắn:", err);
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            // Xóa khỏi danh sách Online toàn cục
            global.onlineUsers.delete(socket.userId);

            // Báo cho mọi người biết user này đã Offline
            socket.broadcast.emit('user_status_change', { userId: socket.userId, status: 'offline' });
            
            console.log(`User ${socket.userId} is Offline.`);
        }
    });

    socket.on('request_public_key', async ({ username }) => {
        try {
            const User = require('./models/User'); // Đảm bảo đã import User
            const user = await User.findOne({ username });
            if (user) {
                socket.emit('response_public_key', {
                    userId: user._id.toString(),
                    publicKey: user.publicKey,
                    username: user.username
                });
            } else {
                socket.emit('error', 'User không tồn tại');
            }
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            // Báo cho tất cả mọi người biết user này vừa Offline
            socket.broadcast.emit('user_status_change', { userId: socket.userId, status: 'offline' });
        }
    });

    socket.on('send_friend_request', async ({ targetUsername }) => {
        try {
            const User = require('./models/User');
            const targetUser = await User.findOne({ username: targetUsername });
            
            if (!targetUser) return socket.emit('error', 'Người dùng không tồn tại');
            if (targetUser._id.toString() === socket.userId) return socket.emit('error', 'Không thể kết bạn với chính mình');

            // Kiểm tra xem đã tồn tại mối quan hệ nào chưa (chiều A->B hoặc B->A)
            const existingFriendship = await Friendship.findOne({
                $or: [
                    { requester: socket.userId, recipient: targetUser._id },
                    { requester: targetUser._id, recipient: socket.userId }
                ]
            });

            if (existingFriendship) {
                if (existingFriendship.status === 'accepted') return socket.emit('error', 'Hai bạn đã là bạn bè');
                if (existingFriendship.status === 'pending') return socket.emit('error', 'Đang chờ chấp nhận');
            }

            // Tạo record mới trong bảng Friendship
            const newFriendship = new Friendship({
                requester: socket.userId,
                recipient: targetUser._id,
                status: 'pending'
            });
            await newFriendship.save();

            // Gửi thông báo Socket như cũ
            socket.to(targetUser._id.toString()).emit('receive_friend_request', {
                fromUser: socket.username,
                fromId: socket.userId
            });
            
            socket.emit('request_sent_success', `Đã gửi lời mời tới ${targetUsername}`);

        } catch (err) {
            console.error(err);
            socket.emit('error', 'Lỗi server');
        }
    });

    // 2. Chấp nhận lời mời (LOGIC MỚI)
    socket.on('accept_friend_request', async ({ requesterId }) => {
        try {
            const User = require('./models/User');

            // Tìm và Update trạng thái thành 'accepted'
            // Điều kiện: requester là người kia, recipient là MÌNH (socket.userId)
            const friendship = await Friendship.findOneAndUpdate(
                { requester: requesterId, recipient: socket.userId, status: 'pending' },
                { status: 'accepted' },
                { new: true }
            );

            if (!friendship) return; // Không tìm thấy lời mời hợp lệ

            // --- Tạo Notification (như bài trước) ---
            const notifContent = `${socket.username} đã chấp nhận lời mời kết bạn!`;
            await User.findByIdAndUpdate(requesterId, {
                $push: { notifications: { content: notifContent, type: 'friend_accept' } }
            });

            // Gửi Socket thông báo
            socket.to(requesterId).emit('request_accepted', {
                accepterId: socket.userId,
                accepterName: socket.username,
                notification: { content: notifContent }
            });
            
            // Gửi lại thông tin user để bên này bắt đầu Handshake
            const requester = await User.findById(requesterId);
            socket.emit('start_handshake_init', { 
                targetId: requesterId,
                targetUsername: requester.username
            });

        } catch (err) {
            console.error(err);
        }
    });
    
    // THÊM: Sự kiện xóa thông báo (để người dùng xóa sau khi xem)
    socket.on('clear_notification', async ({ notifId }) => {
        try {
            const User = require('./models/User');
            await User.findByIdAndUpdate(socket.userId, {
                $pull: { notifications: { _id: notifId } }
            });
        } catch (err) {
            console.error(err);
        }
    });
});

// Khởi chạy Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`>>> SecureChat Server running on http://localhost:${PORT}`);
});