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

  // 2. Public Key ECDH (Công khai cho mọi người để họ gửi tin cho mình)
  publicKey: { 
    type: String, 
    required: true 
  },

  // [MỚI] Signing Public Key ECDSA (Công khai để người khác verify chữ ký)
  signingPublicKey: {
    type: String,
    required: true
  },

  // 3. Encrypted Private Key ECDH (Key Blob)
  encryptedPrivateKey: { 
    type: String, 
    required: true 
  },
  iv: { 
    type: String, 
    required: true 
  },

  // [MỚI] Encrypted Signing Private Key ECDSA
  encryptedSigningPrivateKey: {
    type: String,
    required: true
  },
  signingIv: {
    type: String,
    required: true
  },

  // ── RECOVERY KEY FIELDS ──
  // recoveryKeyHash: bcrypt hash của recovery key để server verify khi reset
  recoveryKeyHash: {
    type: String,
    required: true
  },
  // Private Key ECDH mã hóa bằng recovery key (backup)
  encryptedPrivateKeyByRecovery: {
    type: String,
    required: true
  },
  recoveryIv: {
    type: String,
    required: true
  },
  // Signing Private Key ECDSA mã hóa bằng recovery key (backup)
  encryptedSigningPrivateKeyByRecovery: {
    type: String,
    required: true
  },
  recoverySigningIv: {
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