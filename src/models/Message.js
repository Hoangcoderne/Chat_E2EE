// src/models/Message.js
const mongoose = require('mongoose');

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

    // Nội dung tin nhắn đã mã hóa (AES-GCM ciphertext)
    encryptedContent: {
        type: String,
        required: true
    },

    // Initialization Vector — bắt buộc với AES-GCM, duy nhất mỗi tin
    iv: {
        type: String,
        required: true
    },

    // Chữ ký số ECDSA — ký trên plaintext trước khi mã hóa
    // required: false để không break tin nhắn cũ chưa có signature
    signature: {
        type: String,
        required: false
    },

    // [MỚI] Trạng thái đã đọc
    // true  = recipient đã mở chat và nhìn thấy tin này
    // false = chưa đọc (mặc định)
    read: {
        type: Boolean,
        default: false
    },

    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Index tăng tốc query lịch sử chat
MessageSchema.index({ sender: 1, recipient: 1, timestamp: 1 });

// Index tăng tốc query đếm unread và updateMany khi mark_read
MessageSchema.index({ recipient: 1, read: 1 });

module.exports = mongoose.model('Message', MessageSchema);