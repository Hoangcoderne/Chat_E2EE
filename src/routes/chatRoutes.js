// src/routes/chatRoutes.js
const express        = require('express');
const router         = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');
const {
    targetIdValidation,
    handleValidationErrors,
} = require('../middleware/validators');
const { body, param } = require('express-validator');

// Validation cho messageId
const messageIdValidation = [
    body('messageId').notEmpty().withMessage('Thiếu messageId').isMongoId().withMessage('messageId không hợp lệ'),
    handleValidationErrors,
];

// Validation cho reaction
const reactionValidation = [
    body('messageId').notEmpty().withMessage('Thiếu messageId').isMongoId().withMessage('messageId không hợp lệ'),
    body('emoji').notEmpty().withMessage('Thiếu emoji').isIn(['👍','❤️','😂','😮','😢','😡']).withMessage('Emoji không hợp lệ'),
    handleValidationErrors,
];

// Validation cho partnerId param
const partnerIdValidation = [
    param('partnerId').isMongoId().withMessage('partnerId không hợp lệ'),
    handleValidationErrors,
];

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