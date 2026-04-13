// src/routes/chatRoutes.js
const express        = require('express');
const router         = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');
const {
    targetIdValidation,
    messageIdValidation,
    reactionValidation,
    partnerIdValidation,
} = require('../middleware/validators');

// ── Các route ──
router.get('/history/:partnerId', authMiddleware, partnerIdValidation,  chatController.getChatHistory);
router.get('/contacts',           authMiddleware, chatController.getContacts);
router.get('/requests',           authMiddleware, chatController.getFriendRequests);
router.get('/notifications',      authMiddleware, chatController.getNotifications);

router.post('/unfriend',  authMiddleware, targetIdValidation, chatController.unfriend);
router.post('/block',     authMiddleware, targetIdValidation, chatController.blockUser);
router.post('/unblock',   authMiddleware, targetIdValidation, chatController.unblockUser);

// Xoá tin nhắn hoàn toàn khỏi DB (chỉ người gửi được xoá)
router.post('/message/delete',   authMiddleware, messageIdValidation,  chatController.deleteMessage);

// Toggle cảm xúc (thêm / đổi / bỏ)
router.post('/message/reaction', authMiddleware, reactionValidation,   chatController.toggleReaction);

module.exports = router;