// src/models/Friendship.js
const mongoose = require('mongoose');

const FriendshipSchema = new mongoose.Schema({
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Người gửi
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Người nhận
    status: { 
        type: String, 
        enum: ['pending', 'accepted', 'blocked'], 
        default: 'pending' 
    },
    createdAt: { type: Date, default: Date.now }
});

// Đảm bảo cặp (A, B) là duy nhất, không thể kết bạn 2 lần
FriendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });

module.exports = mongoose.model('Friendship', FriendshipSchema);