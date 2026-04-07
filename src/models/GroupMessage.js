// src/models/GroupMessage.js
const mongoose = require('mongoose');

const ReactionSchema = new mongoose.Schema({
    emoji:  { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { _id: false });

const GroupMessageSchema = new mongoose.Schema({
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    sender:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },

    //  Loại tin nhắn: 'message' (thường) hoặc 'system' (sự kiện nhóm)
    type: { type: String, enum: ['message', 'system'], default: 'message' },

    //  Nội dung plain text cho system message (không mã hoá)
    systemText: { type: String, default: null },

    // Nội dung mã hoá bằng group key (AES-GCM) — chỉ dùng khi type='message'
    encryptedContent: { type: String, required: false },
    iv:               { type: String, required: false },

    // Chữ ký ECDSA của người gửi
    signature: { type: String, required: false },

    // Ai đã đọc tin này
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    reactions: { type: [ReactionSchema], default: [] },

    replyTo: {
        messageId:        { type: mongoose.Schema.Types.ObjectId, default: null },
        senderName:       { type: String, default: null },
        encryptedContent: { type: String, default: null },
        iv:               { type: String, default: null }
    },

    timestamp: { type: Date, default: Date.now }
});

GroupMessageSchema.index({ groupId: 1, timestamp: 1 });

module.exports = mongoose.model('GroupMessage', GroupMessageSchema);