// public/js/forgot-password.js
import {
    importRecoveryKey,
    decryptAndImportPrivateKey,
    deriveKeysFromPassword,
    exportAndEncryptPrivateKey,
    base64ToArrayBuffer
} from './crypto/key-manager.js';

// ── DOM ──
const errorMsg   = document.getElementById('error-msg');
const successMsg = document.getElementById('success-msg');

// Lưu dữ liệu giữa các bước
let state = {
    username: '',
    recoveryKey: '',        // Chuỗi display user nhập
    recoveryKeyObj: null,   // CryptoKey — dùng để decrypt
    // Bundle nhận từ server sau bước 1
    encryptedPrivateKeyByRecovery: null,
    recoveryIv: null,
    encryptedSigningPrivateKeyByRecovery: null,
    recoverySigningIv: null,
};

// ── HELPERS ──
function showError(msg) {
    errorMsg.innerText = msg;
    errorMsg.style.display = 'block';
    successMsg.style.display = 'none';
}
function clearMessages() {
    errorMsg.style.display = 'none';
    successMsg.style.display = 'none';
}
function goToStep(n) {
    document.querySelectorAll('.step').forEach((el, i) => {
        el.classList.toggle('active', i === n - 1);
    });
    // Cập nhật step indicator
    [1, 2, 3].forEach(i => {
        const dot = document.getElementById(`dot-${i}`);
        if (i < n)       dot.className = 'step-dot done';
        else if (i === n) dot.className = 'step-dot active';
        else              dot.className = 'step-dot';
    });
    clearMessages();
}

// ────────────────────────────────────────────
// BƯỚC 1 — Verify Recovery Key
// ────────────────────────────────────────────
document.getElementById('btn-verify').addEventListener('click', async () => {
    const username    = document.getElementById('username').value.trim();
    const recoveryKey = document.getElementById('recovery-key').value.trim().toUpperCase();

    if (!username || !recoveryKey) return showError("Vui lòng nhập đầy đủ thông tin");

    const btn = document.getElementById('btn-verify');
    btn.disabled = true;
    btn.innerText = 'Đang xác minh...';

    try {
        // Import recovery key → CryptoKey (kiểm tra format luôn)
        const recoveryKeyObj = await importRecoveryKey(recoveryKey);

        // Gửi lên server verify
        const res = await fetch('/api/auth/verify-recovery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, recoveryKey })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Xác minh thất bại");

        // Lưu state để dùng ở bước 2
        state = {
            username,
            recoveryKey,
            recoveryKeyObj,
            encryptedPrivateKeyByRecovery: data.encryptedPrivateKeyByRecovery,
            recoveryIv: data.recoveryIv,
            encryptedSigningPrivateKeyByRecovery: data.encryptedSigningPrivateKeyByRecovery,
            recoverySigningIv: data.recoverySigningIv,
        };

        goToStep(2);

    } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.innerText = 'Xác minh Recovery Key';
    }
});

// ────────────────────────────────────────────
// BƯỚC 2 — Đặt mật khẩu mới + Re-encrypt keys
// ────────────────────────────────────────────
document.getElementById('btn-reset').addEventListener('click', async () => {
    const newPassword     = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (!newPassword || newPassword.length < 6) {
        return showError("Mật khẩu tối thiểu 6 ký tự");
    }
    if (newPassword !== confirmPassword) {
        return showError("Mật khẩu xác nhận không khớp");
    }

    const btn = document.getElementById('btn-reset');
    btn.disabled = true;
    btn.innerText = 'Đang xử lý...';

    try {
        // ── PHẦN QUAN TRỌNG NHẤT: Toàn bộ chạy trên client ──

        // 1. Giải mã ECDH private key bằng recovery key
        //    extractable: true — cần export lại để re-encrypt bằng password mới
        const privateKey = await decryptAndImportPrivateKey(
            state.encryptedPrivateKeyByRecovery,
            state.recoveryIv,
            state.recoveryKeyObj,
            true  // [FIX] extractable: true để exportKey được
        );

        // 2. Giải mã Signing private key bằng recovery key
        const signingPrivateKey = await decryptAndImportSigningKey(
            state.encryptedSigningPrivateKeyByRecovery,
            state.recoverySigningIv,
            state.recoveryKeyObj
        );

        // 3. Tạo salt mới + derive keys mới từ password mới
        const newSalt      = window.crypto.getRandomValues(new Uint8Array(16));
        const newSaltB64   = bufferToBase64(newSalt);
        const newKeys      = await deriveKeysFromPassword(newPassword, newSalt);

        // 4. Re-encrypt private key bằng encryptionKey mới
        const newEncrypted        = await exportAndEncryptPrivateKey(privateKey, newKeys.encryptionKey);
        const newEncryptedSigning = await exportAndEncryptPrivateKey(signingPrivateKey, newKeys.encryptionKey);

        // 5. Gửi lên server cập nhật
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: state.username,
                recoveryKey: state.recoveryKey,   // Server verify lần 2
                newSalt: newSaltB64,
                newAuthKeyHash: newKeys.authKey,
                newEncryptedPrivateKey: newEncrypted.data,
                newIv: newEncrypted.iv,
                newEncryptedSigningPrivateKey: newEncryptedSigning.data,
                newSigningIv: newEncryptedSigning.iv,
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Đặt lại thất bại");

        // Thành công → bước 3
        goToStep(3);

    } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.innerText = 'Đặt lại mật khẩu';
    }
});

// ── HELPERS ──

function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Giải mã Signing Private Key (ECDSA) với extractable:true
// Cần extractable:true vì sau đó phải export lại để re-encrypt bằng password mới
async function decryptAndImportSigningKey(encryptedBase64, ivBase64, encryptionKey) {
    const iv   = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(encryptedBase64);

    const decryptedKeyData = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        encryptionKey,
        data
    );

    return await window.crypto.subtle.importKey(
        "pkcs8",
        decryptedKeyData,
        { name: "ECDSA", namedCurve: "P-256" },
        true,   // [FIX] extractable: true — cần export lại sau
        ["sign"]
    );
}