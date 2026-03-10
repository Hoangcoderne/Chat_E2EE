// src/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const connectDB = require('./config/db');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const Message = require('./models/Message');
const User = require('./models/User');
const Friendship = require('./models/Friendship');
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');

// Cấu hình Socket.io
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

global.onlineUsers = new Set();
connectDB();

// Middlewares
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// --- SOCKET.IO EVENTS (Relay Server) ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // 1. User online -> Join room
    socket.on('join_user', async (userId) => {
        socket.join(userId);
        socket.userId = userId; 
        global.onlineUsers.add(userId);
        
        const user = await User.findById(userId);
        if(user) socket.username = user.username; 
        
        socket.broadcast.emit('user_status_change', { userId, status: 'online' });
    });

    // 2. Lấy Public Key của đối tác
    socket.on('request_public_key', async ({ username }) => {
        try {
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

    // 3. Chuyển tiếp tin nhắn E2EE
    socket.on('send_message', async ({ recipientId, encryptedContent, iv }) => {
        try {
            if (!socket.userId) 
                return socket.emit('error', 'Phiên kết nối bị gián đoạn. Vui lòng nhấn F5 để tải lại trang.');

            // [BẢO MẬT] Luôn lấy senderId từ socket đã xác thực, không tin client
            const senderId = socket.userId;

            // [BẢO MẬT] Kiểm tra quan hệ bạn bè trước khi lưu/gửi
            const friendship = await Friendship.findOne({
                $or: [
                    { requester: senderId, recipient: recipientId },
                    { requester: recipientId, recipient: senderId }
                ]
            });

            // Chưa phải bạn bè -> Thông báo cho cả 2 phía
            if (!friendship || friendship.status === 'pending') {
                socket.emit('system_message', { 
                    text: '⚠️ Hai bạn chưa phải là bạn bè.'
                });
                io.to(recipientId).emit('system_message', {
                    text: `⚠️ ${socket.username || 'Ai đó'} cố gắng nhắn tin nhưng hai bạn chưa phải bạn bè.`
                });
                return;
            }

            // Đang bị chặn -> Chặn hoàn toàn, không lưu, không gửi
            if (friendship.status === 'blocked') {
                socket.emit('error', 'Không thể gửi tin nhắn. Cuộc trò chuyện đã bị chặn.');
                return;
            }

            const newMessage = new Message({
                sender: senderId,
                recipient: recipientId,
                encryptedContent,
                iv
            });
            await newMessage.save();

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

    // 4. User ngắt kết nối
    socket.on('disconnect', () => {
        if (socket.userId) {
            global.onlineUsers.delete(socket.userId);
            socket.broadcast.emit('user_status_change', { userId: socket.userId, status: 'offline' });
            console.log(`User ${socket.userId} is Offline.`);
        }
    });

    // 5. Gửi lời mời kết bạn
    socket.on('send_friend_request', async ({ targetUsername }) => {
        try {
            if (!socket.userId) 
                return socket.emit('error', 'Phiên kết nối bị gián đoạn. Vui lòng nhấn F5 để tải lại trang.');
    
            const targetUser = await User.findOne({ username: targetUsername });
            
            if (!targetUser) return socket.emit('error', 'Người dùng không tồn tại');
            if (targetUser._id.toString() === socket.userId) return socket.emit('error', 'Không thể kết bạn với chính mình');

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

            const newFriendship = new Friendship({
                requester: socket.userId,
                recipient: targetUser._id,
                status: 'pending'
            });
            await newFriendship.save();

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

    // 6. Chấp nhận kết bạn
    socket.on('accept_friend_request', async ({ requesterId }) => {
        try {
            if (!socket.userId) 
                return socket.emit('error', 'Phiên kết nối bị gián đoạn. Vui lòng nhấn F5 để tải lại trang.');
            const friendship = await Friendship.findOneAndUpdate(
                { requester: requesterId, recipient: socket.userId, status: 'pending' },
                { status: 'accepted' },
                { new: true }
            );

            if (!friendship) return;

            const notifContent = `${socket.username} đã chấp nhận lời mời kết bạn!`;
            await User.findByIdAndUpdate(requesterId, {
                $push: { notifications: { content: notifContent, type: 'friend_accept' } }
            });

            socket.to(requesterId).emit('request_accepted', {
                accepterId: socket.userId,
                accepterName: socket.username,
                notification: { content: notifContent }
            });
            
            const requester = await User.findById(requesterId);
            socket.emit('start_handshake_init', { 
                targetId: requesterId,
                targetUsername: requester.username
            });

        } catch (err) {
            console.error(err);
        }
    });
    
    // 7. Xóa thông báo hệ thống
    socket.on('clear_notification', async ({ notifId }) => {
        try {
            // [FIX] ID giả (temp_...) chỉ tồn tại trong RAM client, không có trong DB -> bỏ qua
            if (!notifId || notifId.toString().startsWith('temp_')) return;
            await User.findByIdAndUpdate(socket.userId, {
                $pull: { notifications: { _id: notifId } }
            });
        } catch (err) {
            console.error(err);
        }
    });

    // 8. Tín hiệu thông báo bị chặn (Real-time Block)
    socket.on('notify_block', ({ targetId }) => {
        if (!socket.userId) return;
        socket.to(targetId).emit('you_have_been_blocked', {
            blockerId: socket.userId
        });
    });

    // 9. Tín hiệu thông báo được bỏ chặn (Real-time Unblock)
    socket.on('notify_unblock', ({ targetId }) => {
        if (!socket.userId) return;
        socket.to(targetId).emit('you_have_been_unblocked', {
            unblockerId: socket.userId
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`>>> SecureChat Server running on http://localhost:${PORT}`);
});