// src/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

// API: GET /api/chat/history/:user1/:user2
router.get('/history/:user1/:user2', chatController.getChatHistory);
router.get('/contacts/:userId', chatController.getContacts);
router.get('/requests/:userId', chatController.getFriendRequests); 
router.get('/notifications/:userId', chatController.getNotifications);

module.exports = router;