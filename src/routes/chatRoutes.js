// src/routes/chatRoutes.js
const express        = require('express');
const router         = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

// ── Các route hiện có ──
router.get('/history/:partnerId', authMiddleware, chatController.getChatHistory);
router.get('/contacts',           authMiddleware, chatController.getContacts);
router.get('/requests',           authMiddleware, chatController.getFriendRequests);
router.get('/notifications',      authMiddleware, chatController.getNotifications);

router.post('/unfriend',  authMiddleware, chatController.unfriend);
router.post('/block',     authMiddleware, chatController.blockUser);
router.post('/unblock',   authMiddleware, chatController.unblockUser);

// ── [MỚI] Tin nhắn ──
// Xoá tin nhắn hoàn toàn khỏi DB (chỉ người gửi được xoá)
router.post('/message/delete',   authMiddleware, chatController.deleteMessage);

// Toggle cảm xúc (thêm / đổi / bỏ)
router.post('/message/reaction', authMiddleware, chatController.toggleReaction);

module.exports = router;