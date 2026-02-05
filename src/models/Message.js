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

  // Nội dung tin nhắn ĐÃ MÃ HÓA (Ciphertext)
  encryptedContent: { 
    type: String, 
    required: true 
  },
  
  // Initialization Vector (IV) duy nhất cho mỗi tin nhắn (Bắt buộc với AES-GCM)
  iv: { 
    type: String, 
    required: true 
  },

  timestamp: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('Message', MessageSchema);