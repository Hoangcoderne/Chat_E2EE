// src/models/Group.js
const mongoose = require('mongoose');

// Mỗi member lưu bản mã hoá của group key — chỉ họ giải mã được
const MemberSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Group key được mã hoá bằng ECDH(keyHolder_priv, member_pub)
    encryptedGroupKey: { type: String, required: true },
    keyIv:             { type: String, required: true },
    // Ai đã mã hoá key này cho member? (để member biết dùng public key của ai để giải mã)
    keyHolderId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { _id: false });

const GroupSchema = new mongoose.Schema({
    name:    { type: String, required: true, trim: true, maxlength: 50 },
    // Avatar tự động — chữ cái đầu của tên nhóm
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Danh sách admin (bao gồm creator)
    admins:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Danh sách thành viên kèm encrypted group key
    members: [MemberSchema],
    createdAt: { type: Date, default: Date.now }
});

// Index để load nhóm của user nhanh
GroupSchema.index({ 'members.userId': 1 });

module.exports = mongoose.model('Group', GroupSchema);