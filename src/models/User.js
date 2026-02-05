// src/models/User.js
const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    content: String,
    type: { type: String, default: 'info' }, // 'info', 'alert', v.v.
    createdAt: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true 
  },
  
  // 1. Dùng cho việc "Secure Login" [cite: 55]
  // Salt dùng để Client tái tạo lại AuthKey và EncryptionKey
  salt: { 
    type: String, 
    required: true 
  },
  // Server chỉ lưu Hash của AuthKey. Nếu khớp thì cho login.
  authKeyHash: { 
    type: String, 
    required: true 
  },

  // 2. Public Key (Công khai cho mọi người để họ gửi tin cho mình) [cite: 59]
  publicKey: { 
    type: String, 
    required: true 
  },

  // 3. Encrypted Private Key (Key Blob) [cite: 56]
  // Đây là chìa khóa bí mật đã được mã hóa bởi Password của user.
  // Server lưu giúp, nhưng server không đọc được.
  encryptedPrivateKey: { 
    type: String, 
    required: true 
  },
  // Initialization Vector dùng để giải mã Private Key blob trên
  iv: { 
    type: String, 
    required: true 
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  },

  notifications: [NotificationSchema]
});



module.exports = mongoose.model('User', UserSchema);