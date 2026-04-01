// src/routes/groupRoutes.js
const express          = require('express');
const router           = express.Router();
const groupController  = require('../controllers/groupController');
const authMiddleware   = require('../middleware/authMiddleware');

// Lấy public key của nhiều thành viên (để mã hoá group key)
router.get('/member-keys',             authMiddleware, groupController.getMemberKeys);

// Tạo nhóm
router.post('/create',                 authMiddleware, groupController.createGroup);

// Danh sách nhóm của user
router.get('/',                        authMiddleware, groupController.getGroups);

// Lịch sử tin nhắn nhóm
router.get('/:groupId/history',        authMiddleware, groupController.getGroupHistory);

// Thông tin nhóm (danh sách thành viên)
router.get('/:groupId/info',           authMiddleware, groupController.getGroupInfo);

// Group key của user hiện tại
router.get('/:groupId/my-key',         authMiddleware, groupController.getMyGroupKey);

// Quản lý thành viên
router.post('/:groupId/add-member',    authMiddleware, groupController.addMember);
router.post('/:groupId/remove-member', authMiddleware, groupController.removeMember);
router.post('/:groupId/leave',         authMiddleware, groupController.leaveGroup);

// Xoá tin nhắn nhóm (chỉ người gửi)
router.post('/message/delete',   authMiddleware, groupController.deleteGroupMessage);

// Toggle reaction cho group message
router.post('/message/reaction', authMiddleware, groupController.toggleGroupReaction);

module.exports = router;