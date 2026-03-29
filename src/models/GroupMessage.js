// src/models/GroupMessage.js
const mongoose = require('mongoose');

const ReactionSchema = new mongoose.Schema({
    emoji:  { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { _id: false });

const GroupMessageSchema = new mongoose.Schema({
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    sender:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },

    // Nội dung mã hoá bằng group key (AES-GCM)
    encryptedContent: { type: String, required: true },
    iv:               { type: String, required: true },

    // Chữ ký ECDSA của người gửi (ký trên plaintext)
    signature: { type: String, required: false },

    // Ai đã đọc tin này
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    reactions: { type: [ReactionSchema], default: [] },
    timestamp: { type: Date, default: Date.now }
});

GroupMessageSchema.index({ groupId: 1, timestamp: 1 });

module.exports = mongoose.model('GroupMessage', GroupMessageSchema);