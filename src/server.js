// src/server.js
require('dotenv').config();

// ══════════════════════════════════════════════════
// [MỚI] Kiểm tra biến môi trường bắt buộc ngay khi khởi động
// Nếu thiếu → dừng hẳn, không để server chạy với config sai
// ══════════════════════════════════════════════════
const REQUIRED_ENV = ['MONGO_URI', 'SESSION_SECRET', 'FRONTEND_URL'];
REQUIRED_ENV.forEach(key => {
    if (!process.env[key]) {
        console.error(`[FATAL] Thiếu biến môi trường bắt buộc: ${key}`);
        console.error('Hãy kiểm tra file .env của bạn.');
        process.exit(1);
    }
});

const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');           // [MỚI] Security headers
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const { Server } = require('socket.io');
const logger = require('./utils/logger');  // [MỚI] Structured logging
const requestLogger = require('./middleware/requestLogger'); // [MỚI]
const { apiLimiter, authLimiter, registerLimiter, resetLimiter } = require('./middleware/rateLimiter'); // [MỚI]

const Message = require('./models/Message');
const User = require('./models/User');
const Friendship = require('./models/Friendship');
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');

const app = express();
const server = http.createServer(app);

// ══════════════════════════════════════════════════
// [MỚI] Trust proxy — bắt buộc khi deploy sau Nginx/Heroku/Render
// Không có dòng này → rate limit dùng IP sai
// ══════════════════════════════════════════════════
app.set('trust proxy', 1);

// Cấu hình Socket.io
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL,
        methods: ["GET", "POST"],
        credentials: true
    }
});

global.onlineUsers = new Set();
connectDB();

// ══════════════════════════════════════════════════
// MIDDLEWARES
// ══════════════════════════════════════════════════

// [MỚI] Helmet: tự động thêm các HTTP security headers
// Bảo vệ khỏi Clickjacking, XSS, MIME sniffing, v.v.
// Cấu hình CSP cho phép:
//   - socket.io script từ cùng origin
//   - ES module scripts (type="module") trong public/js/
//   - KHÔNG cho phép inline onclick="..." (đã dùng addEventListener thay thế)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                // Cho phép socket.io client script
                // (được serve từ /socket.io/socket.io.js — cùng origin)
            ],
            scriptSrcAttr: ["'none'"],   // Chặn inline onclick="..." — đúng theo thiết kế mới
            styleSrc:  ["'self'", "'unsafe-inline'"], // Cho phép style inline (dùng trong HTML)
            imgSrc:    ["'self'", "data:"],
            connectSrc: ["'self'", "ws:", "wss:"],    // Cho phép WebSocket (socket.io)
            fontSrc:   ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
        // Tắt reportOnly để thực sự block (không chỉ báo cáo)
        reportOnly: false,
    },
    // Các headers khác giữ mặc định của helmet
    crossOriginEmbedderPolicy: false, // Tắt COEP nếu cần load tài nguyên cross-origin
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// [MỚI] Log tất cả HTTP requests
app.use(requestLogger);

// Static files (public/)
app.use(express.static(path.join(__dirname, '../public')));

// ══════════════════════════════════════════════════
// [MỚI] RATE LIMITING
// Thứ tự quan trọng: specific limiters phải đặt TRƯỚC apiLimiter
// ══════════════════════════════════════════════════
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/verify-recovery', resetLimiter);
app.use('/api/auth/reset-password', resetLimiter);
app.use('/api/', apiLimiter); // Giới hạn chung cho toàn bộ API

// ══════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// ══════════════════════════════════════════════════
// [MỚI] GLOBAL ERROR HANDLER
// Bắt tất cả lỗi không được xử lý trong các route/middleware
// ══════════════════════════════════════════════════
app.use((err, req, res, next) => {
    logger.error({
        event: 'unhandled_error',
        error: err.message,
        stack: err.stack,
        method: req.method,
        path: req.path,
        userId: req.user?.userId || 'anonymous',
    });
    res.status(500).json({ message: 'Lỗi server không xác định.' });
});

// ══════════════════════════════════════════════════
// [MỚI] Xử lý Promise bị reject không được catch
// Ngăn server crash thầm lặng
// ══════════════════════════════════════════════════
process.on('unhandledRejection', (reason) => {
    logger.error({ event: 'unhandled_rejection', error: String(reason) });
});

process.on('uncaughtException', (err) => {
    logger.error({ event: 'uncaught_exception', error: err.message, stack: err.stack });
    process.exit(1); // Crash có kiểm soát — để process manager (PM2) restart lại
});

// ══════════════════════════════════════════════════
// SOCKET.IO EVENTS (Relay Server)
// ══════════════════════════════════════════════════
io.on('connection', (socket) => {
    logger.info({ event: 'socket_connected', socketId: socket.id });

    // 1. User online -> Join room
    socket.on('join_user', async (userId) => {
        socket.join(userId);
        socket.userId = userId;
        global.onlineUsers.add(userId);

        const user = await User.findById(userId);
        if (user) socket.username = user.username;

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
                    signingPublicKey: user.signingPublicKey,
                    username: user.username
                });
            } else {
                socket.emit('error', 'User không tồn tại');
            }
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'request_public_key', error: err.message });
        }
    });

    // 3. Chuyển tiếp tin nhắn E2EE
    socket.on('send_message', async ({ recipientId, encryptedContent, iv, signature }) => {
        try {
            if (!socket.userId)
                return socket.emit('error', 'Phiên kết nối bị gián đoạn. Vui lòng nhấn F5.');

            const senderId = socket.userId;

            const friendship = await Friendship.findOne({
                $or: [
                    { requester: senderId, recipient: recipientId },
                    { requester: recipientId, recipient: senderId }
                ]
            });

            if (!friendship || friendship.status === 'pending') {
                socket.emit('system_message', {
                    text: '⚠️ Hai bạn chưa phải là bạn bè. Hãy gửi lời mời kết bạn trước.'
                });
                io.to(recipientId).emit('system_message', {
                    text: `⚠️ ${socket.username || 'Ai đó'} cố gắng nhắn tin nhưng hai bạn chưa phải bạn bè.`
                });
                return;
            }

            if (friendship.status === 'blocked') {
                socket.emit('error', 'Không thể gửi tin nhắn. Cuộc trò chuyện đã bị chặn.');
                return;
            }

            const newMessage = new Message({
                sender: senderId,
                recipient: recipientId,
                encryptedContent,
                iv,
                signature: signature || null
            });
            await newMessage.save();

            // Gửi tới recipient
            io.to(recipientId).emit('receive_message', {
                messageId: newMessage._id.toString(),
                senderId,
                encryptedContent,
                iv,
                signature: signature || null,
                timestamp: newMessage.timestamp
            });

            // [MỚI] Đồng bộ tới TẤT CẢ thiết bị của sender (multi-device)
            // Kèm senderSocketId để thiết bị gửi bỏ qua (đã hiển thị local)
            io.to(senderId).emit('message_sent_sync', {
                messageId: newMessage._id.toString(),
                senderSocketId: socket.id,
                recipientId,
                encryptedContent,
                iv,
                signature: signature || null,
                timestamp: newMessage.timestamp
            });
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'send_message', error: err.message });
        }
    });

    // [MỚI] 3b. Đánh dấu đã đọc — client gọi khi mở chat với một người
    socket.on('mark_read', async ({ partnerId }) => {
        try {
            if (!socket.userId) return;

            // Cập nhật DB: tất cả tin từ partner → mình thành read:true
            const result = await Message.updateMany(
                { sender: partnerId, recipient: socket.userId, read: false },
                { read: true }
            );

            // Thông báo cho partner biết tin nhắn đã được đọc
            // (để họ cập nhật dấu ✓✓ trên tin nhắn đã gửi)
            if (result.modifiedCount > 0) {
                io.to(partnerId).emit('messages_read', {
                    by: socket.userId
                });
            }
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'mark_read', error: err.message });
        }
    });

    // 4. User ngắt kết nối
    socket.on('disconnect', () => {
        if (socket.userId) {
            global.onlineUsers.delete(socket.userId);
            socket.broadcast.emit('user_status_change', { userId: socket.userId, status: 'offline' });
            logger.info({ event: 'user_offline', userId: socket.userId });
        }
    });

    // 5. Gửi lời mời kết bạn
    socket.on('send_friend_request', async ({ targetUsername }) => {
        try {
            if (!socket.userId)
                return socket.emit('error', 'Phiên kết nối bị gián đoạn. Vui lòng nhấn F5.');

            const targetUser = await User.findOne({ username: targetUsername });
            if (!targetUser) return socket.emit('error', 'Người dùng không tồn tại');
            if (targetUser._id.toString() === socket.userId) return socket.emit('error', 'Không thể kết bạn với chính mình');

            const existing = await Friendship.findOne({
                $or: [
                    { requester: socket.userId, recipient: targetUser._id },
                    { requester: targetUser._id, recipient: socket.userId }
                ]
            });

            if (existing) {
                if (existing.status === 'accepted') return socket.emit('error', 'Hai bạn đã là bạn bè');
                if (existing.status === 'pending') return socket.emit('error', 'Đang chờ chấp nhận');
            }

            await new Friendship({ requester: socket.userId, recipient: targetUser._id, status: 'pending' }).save();

            socket.to(targetUser._id.toString()).emit('receive_friend_request', {
                fromUser: socket.username,
                fromId: socket.userId
            });
            socket.emit('request_sent_success', `Đã gửi lời mời tới ${targetUsername}`);

        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'send_friend_request', error: err.message });
            socket.emit('error', 'Lỗi server');
        }
    });

    // 6. Chấp nhận kết bạn
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
            socket.emit('start_handshake_init', { targetId: requesterId, targetUsername: requester.username });

            logger.info({ event: 'friend_accepted', accepter: socket.userId, requester: requesterId });
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'accept_friend_request', error: err.message });
        }
    });

    // 7. Xóa thông báo
    socket.on('clear_notification', async ({ notifId }) => {
        try {
            if (!notifId || notifId.toString().startsWith('temp_')) return;
            await User.findByIdAndUpdate(socket.userId, {
                $pull: { notifications: { _id: notifId } }
            });
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'clear_notification', error: err.message });
        }
    });

    // 8. Notify block / unblock
    socket.on('notify_block', ({ targetId }) => {
        if (!socket.userId) return;
        socket.to(targetId).emit('you_have_been_blocked', { blockerId: socket.userId });
    });

    socket.on('notify_unblock', ({ targetId }) => {
        if (!socket.userId) return;
        socket.to(targetId).emit('you_have_been_unblocked', { unblockerId: socket.userId });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info({ event: 'server_start', port: PORT, env: process.env.NODE_ENV || 'development' });
    console.log(`>>> SecureChat Server running on http://localhost:${PORT}`);
});