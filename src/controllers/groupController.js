// src/controllers/groupController.js
const mongoose   = require('mongoose');
const Group        = require('../models/Group');
const GroupMessage = require('../models/GroupMessage');
const User         = require('../models/User');

// ── Helper ────────────────────────────────────────────────────
function isAdmin(group, userId) {
    return group.admins.some(id => id.toString() === userId);
}
function isMember(group, userId) {
    return group.members.some(m => m.userId.toString() === userId);
}

// ── Lấy public key nhiều user cùng lúc (để client mã hoá group key) ──
// GET /api/groups/member-keys?userIds=id1,id2,...
exports.getMemberKeys = async (req, res) => {
    try {
        const { userIds } = req.query;
        if (!userIds) return res.status(400).json({ message: 'Thiếu userIds' });

        const ids = userIds.split(',').filter(id => mongoose.Types.ObjectId.isValid(id));
        const users = await User.find({ _id: { $in: ids } }).select('_id username publicKey signingPublicKey');
        res.json(users);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ── Tạo nhóm ──────────────────────────────────────────────────
// POST /api/groups/create
// Body: { name, members: [{ userId, encryptedGroupKey, keyIv }] }
// members phải bao gồm cả người tạo
exports.createGroup = async (req, res) => {
    try {
        const creatorId = req.user.userId;
        const { name, members } = req.body;

        if (!name || !name.trim())
            return res.status(400).json({ message: 'Tên nhóm không được trống' });
        if (!members || members.length < 2)
            return res.status(400).json({ message: 'Nhóm cần ít nhất 2 thành viên' });

        // Tất cả member entries phải có encryptedGroupKey + keyIv
        const validMembers = members.filter(m =>
            m.userId && m.encryptedGroupKey && m.keyIv &&
            mongoose.Types.ObjectId.isValid(m.userId)
        );
        if (validMembers.length !== members.length)
            return res.status(400).json({ message: 'Dữ liệu thành viên không hợp lệ' });

        const group = await Group.create({
            name: name.trim(),
            creator: creatorId,
            admins:  [creatorId],
            members: validMembers.map(m => ({
                userId:            m.userId,
                encryptedGroupKey: m.encryptedGroupKey,
                keyIv:             m.keyIv,
                keyHolderId:       creatorId   // creator mã hoá key cho mọi người lúc tạo
            }))
        });

        // Populate để trả về đủ thông tin
        await group.populate('members.userId', 'username _id publicKey');
        res.status(201).json(group);
    } catch (err) {
        console.error('Create group error:', err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ── Danh sách nhóm của user ────────────────────────────────────
// GET /api/groups
exports.getGroups = async (req, res) => {
    try {
        const userId = req.user.userId;

        const groups = await Group.find({ 'members.userId': userId })
            .select('name creator admins members createdAt')
            .populate('members.userId', 'username _id');

        // Kèm số tin chưa đọc mỗi nhóm
        const result = await Promise.all(groups.map(async g => {
            const unread = await GroupMessage.countDocuments({
                groupId: g._id,
                sender:  { $ne: userId },
                readBy:  { $ne: userId }
            });
            // Lấy encrypted group key của user này
            const myEntry = g.members.find(m => m.userId._id.toString() === userId);
            return {
                _id:               g._id,
                name:              g.name,
                creator:           g.creator,
                admins:            g.admins,
                members:           g.members,
                unreadCount:       unread,
                myEncryptedKey:    myEntry?.encryptedGroupKey,
                myKeyIv:           myEntry?.keyIv,
                myKeyHolderId:     myEntry?.keyHolderId,
                createdAt:         g.createdAt
            };
        }));

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
};

// ── Lịch sử tin nhắn nhóm ─────────────────────────────────────
// GET /api/groups/:groupId/history
exports.getGroupHistory = async (req, res) => {
    try {
        const userId  = req.user.userId;
        const { groupId } = req.params;

        const group = await Group.findById(groupId);
        if (!group || !isMember(group, userId))
            return res.status(403).json({ message: 'Bạn không trong nhóm này' });

        const messages = await GroupMessage.find({ groupId })
            .populate('sender', 'username _id')
            .sort({ timestamp: 1 });

        // Đánh dấu đã đọc
        await GroupMessage.updateMany(
            { groupId, readBy: { $ne: userId } },
            { $addToSet: { readBy: userId } }
        );

        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ── Thêm thành viên (admin only) ──────────────────────────────
// POST /api/groups/:groupId/add-member
// Body: { userId, encryptedGroupKey, keyIv }
exports.addMember = async (req, res) => {
    try {
        const adminId = req.user.userId;
        const { groupId } = req.params;
        const { userId, encryptedGroupKey, keyIv } = req.body;

        if (!userId || !encryptedGroupKey || !keyIv)
            return res.status(400).json({ message: 'Thiếu thông tin thành viên' });

        const group = await Group.findById(groupId);
        if (!group)           return res.status(404).json({ message: 'Nhóm không tồn tại' });
        if (!isAdmin(group, adminId)) return res.status(403).json({ message: 'Chỉ trưởng nhóm mới có quyền thêm thành viên' });
        if (isMember(group, userId))  return res.status(400).json({ message: 'Người này đã là thành viên' });

        const user = await User.findById(userId).select('username _id publicKey');
        if (!user) return res.status(404).json({ message: 'Người dùng không tồn tại' });

        group.members.push({
            userId,
            encryptedGroupKey,
            keyIv,
            keyHolderId: adminId   // admin mã hoá key cho member mới
        });
        await group.save();

        res.json({ success: true, newMember: { _id: user._id, username: user.username } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ── Xoá thành viên (admin only) ───────────────────────────────
// POST /api/groups/:groupId/remove-member
// Body: { userId }
exports.removeMember = async (req, res) => {
    try {
        const adminId = req.user.userId;
        const { groupId } = req.params;
        const { userId } = req.body;

        const group = await Group.findById(groupId);
        if (!group)                   return res.status(404).json({ message: 'Nhóm không tồn tại' });
        if (!isAdmin(group, adminId)) return res.status(403).json({ message: 'Chỉ trưởng nhóm mới có quyền xoá thành viên' });
        if (userId === adminId)       return res.status(400).json({ message: 'Không thể tự xoá chính mình. Hãy dùng "Rời nhóm".' });
        if (userId === group.creator.toString()) return res.status(400).json({ message: 'Không thể xoá người tạo nhóm' });

        group.members = group.members.filter(m => m.userId.toString() !== userId);
        group.admins  = group.admins.filter(id => id.toString() !== userId);
        await group.save();

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ── Rời nhóm ─────────────────────────────────────────────────
// POST /api/groups/:groupId/leave
exports.leaveGroup = async (req, res) => {
    try {
        const userId  = req.user.userId;
        const { groupId } = req.params;

        const group = await Group.findById(groupId);
        if (!group || !isMember(group, userId))
            return res.status(404).json({ message: 'Nhóm không tồn tại' });

        // Creator muốn rời → phải chuyển quyền trước
        if (group.creator.toString() === userId && group.members.length > 1)
            return res.status(400).json({ message: 'Trưởng nhóm phải chuyển quyền trước khi rời nhóm' });

        group.members = group.members.filter(m => m.userId.toString() !== userId);
        group.admins  = group.admins.filter(id => id.toString() !== userId);

        // Nhóm trống → xoá hẳn
        if (group.members.length === 0) {
            await Group.findByIdAndDelete(groupId);
            await GroupMessage.deleteMany({ groupId });
        } else {
            await group.save();
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ── Lấy group key của user hiện tại ──────────────────────────
// GET /api/groups/:groupId/my-key
exports.getMyGroupKey = async (req, res) => {
    try {
        const userId  = req.user.userId;
        const { groupId } = req.params;

        const group = await Group.findById(groupId);
        if (!group || !isMember(group, userId))
            return res.status(403).json({ message: 'Không có quyền truy cập' });

        const myEntry = group.members.find(m => m.userId.toString() === userId);
        if (!myEntry)
            return res.status(404).json({ message: 'Không tìm thấy key' });

        // Lấy public key của người đã mã hoá key cho mình
        const keyHolder = await User.findById(myEntry.keyHolderId).select('publicKey _id');

        res.json({
            encryptedGroupKey: myEntry.encryptedGroupKey,
            keyIv:             myEntry.keyIv,
            keyHolderId:       myEntry.keyHolderId,
            keyHolderPublicKey: keyHolder?.publicKey
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ── Lấy thông tin nhóm (danh sách thành viên) ────────────────
// GET /api/groups/:groupId/info
exports.getGroupInfo = async (req, res) => {
    try {
        const userId  = req.user.userId;
        const { groupId } = req.params;

        const group = await Group.findById(groupId)
            .populate('members.userId', 'username _id publicKey')
            .populate('admins', 'username _id');

        if (!group || !isMember(group, userId))
            return res.status(403).json({ message: 'Không có quyền truy cập' });

        res.json(group);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};