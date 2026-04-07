// src/models/Message.js
const mongoose = require('mongoose');

// Mỗi reaction: emoji + userId (1 user chỉ được 1 reaction / tin nhắn)
const ReactionSchema = new mongoose.Schema({
    emoji:  { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { _id: false });

const MessageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Nội dung đã mã hoá (AES-GCM ciphertext)
    encryptedContent: { type: String, required: true },
    iv:               { type: String, required: true },

    // Chữ ký số ECDSA — ký trên plaintext trước khi mã hoá
    // required: false để không break tin nhắn cũ chưa có signature
    signature: { type: String, required: false },

    // Trạng thái đã đọc
    read: { type: Boolean, default: false },

    // Cảm xúc — mảng reaction, mỗi user chỉ 1 slot
    reactions: { type: [ReactionSchema], default: [] },

    replyTo: {
        messageId:        { type: mongoose.Schema.Types.ObjectId, default: null },
        senderName:       { type: String, default: null },
        encryptedContent: { type: String, default: null },
        iv:               { type: String, default: null }
    },

    timestamp: { type: Date, default: Date.now }
});

// Index tăng tốc query lịch sử chat
MessageSchema.index({ sender: 1, recipient: 1, timestamp: 1 });
// Index tăng tốc query đếm unread
MessageSchema.index({ recipient: 1, read: 1 });

module.exports = mongoose.model('Message', MessageSchema);