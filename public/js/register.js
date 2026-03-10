// public/js/register.js
import { 
    deriveKeysFromPassword, 
    generateKeyPair, 
    exportAndEncryptPrivateKey, 
    exportPublicKey 
} from './crypto/key-manager.js';

const form = document.getElementById('register-form');
const btnSubmit = document.getElementById('btn-submit');
const errorMsg = document.getElementById('error-msg');
const successMsg = document.getElementById('success-msg');

// Helper buffer to Base64 (để gửi Salt lên server dạng chuỗi)
function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (password !== confirmPassword) {
        showError("Mật khẩu xác nhận không khớp!");
        return;
    }

    setLoading(true, "Đang khởi tạo E2EE...");

    try {
        // 1. Tạo Salt
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const saltBase64 = bufferToBase64(salt); // Gửi lên server dạng Base64

        // 2. Tạo Keys
        const keys = await deriveKeysFromPassword(password, salt);

        // 3. Tạo KeyPair
        const keyPair = await generateKeyPair();

        // 4. Mã hóa Private Key
        const encryptedData = await exportAndEncryptPrivateKey(keyPair.privateKey, keys.encryptionKey);

        // 5. Xuất Public Key
        const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);

        // 6. Gửi Server
        const payload = {
            username,
            salt: saltBase64, // Lưu ý: Server phải lưu cái này y nguyên
            authKeyHash: keys.authKey,
            publicKey: publicKeyBase64,
            encryptedPrivateKey: encryptedData.data,
            iv: encryptedData.iv
        };

        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await res.json();
        if (!res.ok) throw new Error(result.message || "Đăng ký thất bại");

        showSuccess("Đăng ký thành công! Hãy đăng nhập.");
        setTimeout(() => window.location.href = "/login.html", 2000);

    } catch (err) {
        console.error(err);
        showError(err.message);
        setLoading(false, "Đăng Ký");
    }
});

function showError(msg) {
    errorMsg.innerText = msg;
    errorMsg.style.display = 'block';
    errorMsg.className = 'alert alert-danger';
}
function showSuccess(msg) {
    successMsg.innerText = msg;
    successMsg.style.display = 'block';
    successMsg.className = 'alert alert-success';
    errorMsg.style.display = 'none';
}
function setLoading(isLoading, text) {
    btnSubmit.disabled = isLoading;
    btnSubmit.innerText = text;
}