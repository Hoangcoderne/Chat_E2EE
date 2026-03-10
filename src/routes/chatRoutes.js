// src/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

// API đã được bảo vệ tuyệt đối: Không truyền ID của bản thân lên URL nữa
router.get('/history/:partnerId', authMiddleware, chatController.getChatHistory);
router.get('/contacts', authMiddleware, chatController.getContacts);
router.get('/requests', authMiddleware, chatController.getFriendRequests); 
router.get('/notifications', authMiddleware, chatController.getNotifications);

router.post('/unfriend', authMiddleware, chatController.unfriend);
router.post('/block', authMiddleware, chatController.blockUser);
router.post('/unblock', authMiddleware, chatController.unblockUser);

module.exports = router;