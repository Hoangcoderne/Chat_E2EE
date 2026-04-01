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
const authRoutes  = require('./routes/authRoutes');
const chatRoutes  = require('./routes/chatRoutes');
const groupRoutes = require('./routes/groupRoutes');  // [MỚI]
const GroupMessage = require('./models/GroupMessage'); // [MỚI]
const Group        = require('./models/Group');        // [MỚI]

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
app.use('/api/auth',   authRoutes);
app.use('/api/chat',   chatRoutes);
app.use('/api/groups', groupRoutes); // [MỚI]

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


    // [MỚI] 3c. Broadcast xoá tin nhắn real-time
    // HTTP handler (chatController.deleteMessage) đã xoá DB và trả về recipientId
    // Client gọi socket này SAU KHI HTTP delete thành công để broadcast UI update
    socket.on('broadcast_delete_message', ({ messageId, recipientId }) => {
        if (!socket.userId) return;
        // Thông báo cho recipient xoá tin khỏi UI
        io.to(recipientId).emit('message_deleted', { messageId });
        // Đồng bộ các thiết bị khác của sender
        io.to(socket.userId).emit('message_deleted', { messageId });
    });

    // [MỚI] 3d. Broadcast reaction real-time
    // HTTP handler (chatController.toggleReaction) đã cập nhật DB
    // Client gọi socket này SAU KHI HTTP thành công để broadcast
    socket.on('broadcast_reaction', ({ messageId, reactions, partnerId }) => {
        if (!socket.userId) return;
        // Gửi cho partner
        io.to(partnerId).emit('reaction_updated', { messageId, reactions });
        // Đồng bộ các thiết bị khác của chính mình
        io.to(socket.userId).emit('reaction_updated', { messageId, reactions });
    });

    // [MỚI] 3e. Join tất cả group rooms của user khi kết nối
    socket.on('join_groups', async (groupIds) => {
        if (!Array.isArray(groupIds)) return;
        groupIds.forEach(gid => socket.join('group:' + gid));
    });

    // [MỚI] 3f. Gửi tin nhắn nhóm E2EE
    socket.on('send_group_message', async ({ groupId, encryptedContent, iv, signature }) => {
        try {
            if (!socket.userId)
                return socket.emit('error', 'Phiên kết nối bị gián đoạn.');

            // Kiểm tra user có trong nhóm không
            const group = await Group.findById(groupId);
            if (!group || !group.members.some(m => m.userId.toString() === socket.userId))
                return socket.emit('error', 'Bạn không trong nhóm này.');

            const msg = await GroupMessage.create({
                groupId,
                sender: socket.userId,
                encryptedContent,
                iv,
                signature: signature || null,
                readBy: [socket.userId]  // sender đã đọc
            });

            const payload = {
                messageId:        msg._id.toString(),
                groupId,
                senderId:         socket.userId,
                senderName:       socket.username,
                encryptedContent,
                iv,
                signature:        signature || null,
                timestamp:        msg.timestamp
            };

            // Broadcast tới toàn bộ nhóm (trừ sender)
            socket.to('group:' + groupId).emit('receive_group_message', payload);
            // Sync tới thiết bị khác của sender
            io.to(socket.userId).emit('group_message_sent_sync', {
                ...payload,
                senderSocketId: socket.id
            });

        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'send_group_message', error: err.message });
        }
    });

    // [MỚI] 3g. Thông báo khi admin thêm/xoá thành viên (broadcast real-time)
    socket.on('broadcast_group_member_added', async ({ groupId, newMemberIds, groupName }) => {
        if (!socket.userId) return;
        try {
            // Lấy thông tin nhóm để gửi cho member mới (có đủ name, memberCount)
            const group = await Group.findById(groupId)
                .populate('members.userId', 'username _id');

            if (!group) return;

            const memberCount = group.members.length;

            // Notify toàn nhóm cũ
            socket.to('group:' + groupId).emit('group_member_added', {
                groupId,
                memberCount
            });

            // Với mỗi member mới: emit group_invited kèm đủ info để render sidebar
            if (Array.isArray(newMemberIds)) {
                newMemberIds.forEach(uid => {
                    io.to(uid).emit('group_invited', {
                        groupId,
                        groupName,
                        memberCount
                    });
                });
            }
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'broadcast_group_member_added', error: err.message });
        }
    });

    socket.on('broadcast_group_member_removed', ({ groupId, removedUserId }) => {
        if (!socket.userId) return;
        io.to('group:' + groupId).emit('group_member_removed', { groupId, removedUserId });
        // Kick user khỏi room
        io.to(removedUserId).emit('group_kicked', { groupId });
    });

    // Broadcast xoá tin nhắn nhóm real-time
    socket.on('broadcast_delete_group_message', ({ groupId, messageId }) => {
        if (!socket.userId) return;
        // socket.to() thay vì io.to() — sender đã tự remove rồi, không cần gửi lại
        socket.to('group:' + groupId).emit('message_deleted', { messageId });
    });

    // [FIX BUG 5] Broadcast group reaction
    socket.on('broadcast_group_reaction', ({ groupId, messageId, reactions }) => {
        if (!socket.userId) return;
        // Gửi tới tất cả member trong nhóm (trừ sender — đã update local)
        socket.to('group:' + groupId).emit('reaction_updated', { messageId, reactions });
    });

    // [FIX BUG 1] mark_group_read — cập nhật readBy + broadcast seen real-time
    socket.on('mark_group_read', async ({ groupId }) => {
        try {
            if (!socket.userId) return;
            // Đánh dấu tất cả tin chưa đọc trong nhóm này → read bởi user
            await GroupMessage.updateMany(
                { groupId, readBy: { $ne: socket.userId } },
                { $addToSet: { readBy: socket.userId } }
            );
            // Broadcast cho cả nhóm biết user này đã đọc
            socket.to('group:' + groupId).emit('group_read_update', {
                groupId,
                userId:   socket.userId,
                username: socket.username
            });
        } catch (err) {
            logger.error({ event: 'socket_error', handler: 'mark_group_read', error: err.message });
        }
    });

    socket.on('broadcast_group_left', ({ groupId }) => {
        if (!socket.userId) return;
        socket.to('group:' + groupId).emit('group_member_removed', {
            groupId, removedUserId: socket.userId
        });
        socket.leave('group:' + groupId);
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
            const notifContent = `Đã gửi lời mời tới ${targetUsername}`;
            await User.findByIdAndUpdate(socket.userId, {
                $push: { notifications: { content: notifContent, type: 'friend_request_sent' } }
            });
            socket.emit('request_sent_success', notifContent);

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