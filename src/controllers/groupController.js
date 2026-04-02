// src/controllers/groupController.js
const mongoose   = require('mongoose');
const Group        = require('../models/Group');
const GroupMessage = require('../models/GroupMessage');
const User         = require('../models/User');

// ── Helper ────────────────────────────────────────────────────
// Lưu ý: sau khi .populate('members.userId'), m.userId là object {_id,...}
// Trước populate: m.userId là ObjectId → .toString() trả về id string
// Cần xử lý cả 2 trường hợp
function isAdmin(group, userId) {
    return group.admins.some(a => (a._id || a).toString() === userId.toString());
}
function isMember(group, userId) {
    return group.members.some(m => {
        const mid = m.userId?._id || m.userId; // populated hoặc chưa
        return mid?.toString() === userId.toString();
    });
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
            .populate('readBy', 'username _id')   // populate để client có username hiển thị seen list
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

        // Lấy username của người bị xoá để lưu system message
        const removedUser = await User.findById(userId).select('username');
        const removedName = removedUser?.username || 'Thành viên';

        group.members = group.members.filter(m => m.userId.toString() !== userId);
        group.admins  = group.admins.filter(id => id.toString() !== userId);
        await group.save();

        // Lưu system message vào DB
        await GroupMessage.create({
            groupId,
            sender: adminId,
            type: 'system',
            systemText: `${removedName} đã bị xóa khỏi nhóm`,
            encryptedContent: 'system',
            iv: 'system'
        });

        res.json({ success: true, removedName });
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

        const leavingUser = await User.findById(userId).select('username');
        const leavingName = leavingUser?.username || 'Thành viên';

        group.members = group.members.filter(m => m.userId.toString() !== userId);
        group.admins  = group.admins.filter(id => id.toString() !== userId);

        // Nhóm trống → xoá hẳn
        if (group.members.length === 0) {
            await Group.findByIdAndDelete(groupId);
            await GroupMessage.deleteMany({ groupId });
        } else {
            await group.save();
            // Lưu system message
            await GroupMessage.create({
                groupId,
                sender: userId,
                type: 'system',
                systemText: `${leavingName} đã rời khỏi nhóm`,
                encryptedContent: 'system',
                iv: 'system'
            });
        }

        res.json({ success: true, leavingName });
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

        if (!mongoose.Types.ObjectId.isValid(groupId))
            return res.status(400).json({ message: 'groupId không hợp lệ' });

        // Bước 1: Kiểm tra membership TRƯỚC khi populate
        // (isMember dùng m.userId là ObjectId — chính xác)
        const groupRaw = await Group.findById(groupId);
        if (!groupRaw)
            return res.status(404).json({ message: 'Nhóm không tồn tại' });
        if (!isMember(groupRaw, userId))
            return res.status(403).json({ message: 'Bạn không phải thành viên nhóm này' });

        // Bước 2: Lấy lại với populate để trả về đầy đủ thông tin
        const group = await Group.findById(groupId)
            .populate('members.userId', 'username _id publicKey')
            .populate('admins', '_id username');

        res.json(group);
    } catch (err) {
        console.error('getGroupInfo error:', err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ── [FIX BUG 5] Toggle reaction cho group message ─────────────
// POST /api/groups/message/reaction
exports.toggleGroupReaction = async (req, res) => {
    try {
        const { messageId, emoji } = req.body;
        const currentUserId = req.user.userId;

        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId))
            return res.status(400).json({ success: false, message: 'messageId không hợp lệ.' });

        const VALID = ['👍','❤️','😂','😮','😢','😡'];
        if (!VALID.includes(emoji))
            return res.status(400).json({ success: false, message: 'Emoji không hợp lệ.' });

        const GroupMessage = require('../models/GroupMessage');
        const msg = await GroupMessage.findById(messageId);
        if (!msg) return res.status(404).json({ success: false, message: 'Tin nhắn không tồn tại.' });

        // Kiểm tra user có trong nhóm không
        const group = await Group.findById(msg.groupId);
        if (!group || !isMember(group, currentUserId))
            return res.status(403).json({ success: false, message: 'Không có quyền react.' });

        const existing = msg.reactions.find(r => r.userId.toString() === currentUserId);
        if (existing) {
            if (existing.emoji === emoji) {
                msg.reactions = msg.reactions.filter(r => r.userId.toString() !== currentUserId);
            } else {
                existing.emoji = emoji;
            }
        } else {
            msg.reactions.push({ emoji, userId: currentUserId });
        }
        await msg.save();

        res.json({ success: true, reactions: msg.reactions, messageId, groupId: msg.groupId.toString() });
    } catch (err) {
        console.error('Toggle group reaction error:', err);
        res.status(500).json({ success: false, message: 'Lỗi server.' });
    }
};

// ── Xoá tin nhắn nhóm hoàn toàn (chỉ người gửi) ──────────────
// POST /api/groups/message/delete
exports.deleteGroupMessage = async (req, res) => {
    try {
        const { messageId } = req.body;
        const currentUserId  = req.user.userId;

        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId))
            return res.status(400).json({ success: false, message: 'messageId không hợp lệ.' });

        const GroupMessage = require('../models/GroupMessage');
        const msg = await GroupMessage.findById(messageId);
        if (!msg)
            return res.status(404).json({ success: false, message: 'Tin nhắn không tồn tại.' });

        // Chỉ người gửi được xoá
        if (msg.sender.toString() !== currentUserId)
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xoá tin nhắn này.' });

        const groupId = msg.groupId.toString();
        await GroupMessage.findByIdAndDelete(messageId);

        res.json({ success: true, messageId, groupId });
    } catch (err) {
        console.error('Delete group message error:', err);
        res.status(500).json({ success: false, message: 'Lỗi server.' });
    }
};

// ── Xoá tin nhắn nhóm (chỉ người gửi) ───────────────────────