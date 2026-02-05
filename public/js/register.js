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

// Helper: Chuyển Uint8Array sang Base64 để gửi qua mạng
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
    
    // 1. Lấy dữ liệu form
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    // Validate cơ bản
    if (password !== confirmPassword) {
        showError("Mật khẩu xác nhận không khớp!");
        return;
    }

    // UI: Khóa nút để tránh bấm nhiều lần
    setLoading(true, "Đang sinh khóa bảo mật...");

    try {
        console.log("--- BẮT ĐẦU QUY TRÌNH E2EE REGISTRATION ---");

        // BƯỚC 1: Tạo Salt ngẫu nhiên (16 bytes)
        // Salt này đảm bảo dù 2 người cùng pass thì AuthKey vẫn khác nhau
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const saltBase64 = bufferToBase64(salt);
        console.log("1. Generated Salt:", saltBase64);

        // BƯỚC 2: Key Derivation (Tách Password -> AuthKey + EncryptionKey)
        // Đây là bước quan trọng nhất của Zero-Knowledge
        console.log("2. Deriving Keys (PBKDF2)...");
        const keys = await deriveKeysFromPassword(password, salt);
        // keys.authKey: Dùng để gửi lên server (Server sẽ hash lại lần nữa)
        // keys.encryptionKey: Giữ lại để mã hóa Private Key

        // BƯỚC 3: Sinh cặp khóa ECDH (Public/Private)
        console.log("3. Generating Key Pair...");
        const keyPair = await generateKeyPair();

        // BƯỚC 4: Mã hóa Private Key bằng Encryption Key (Key Wrapping)
        console.log("4. Encrypting Private Key...");
        const encryptedPrivKeyData = await exportAndEncryptPrivateKey(keyPair.privateKey, keys.encryptionKey);
        // encryptedPrivKeyData chứa { iv, data } (đều là base64)

        // BƯỚC 5: Xuất Public Key
        const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);

        // BƯỚC 6: Gửi tất cả lên Server
        // Lưu ý: Server KHÔNG HỀ nhận được password gốc hay private key gốc
        console.log("5. Sending to Server...");
        
        const payload = {
            username: username,
            salt: saltBase64,
            authKeyHash: keys.authKey, // Server gọi field này là authKeyHash để lưu
            publicKey: publicKeyBase64,
            encryptedPrivateKey: encryptedPrivKeyData.data, // Blob
            iv: encryptedPrivKeyData.iv // IV để giải mã blob
        };

        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Đăng ký thất bại");
        }

        // Thành công!
        showSuccess("Đăng ký thành công! Đang chuyển hướng...");
        setTimeout(() => {
            window.location.href = "/login.html"; // Chuyển sang trang login (sẽ làm sau)
        }, 2000);

    } catch (err) {
        console.error(err);
        showError(err.message);
        setLoading(false, "Đăng ký & Tạo Khóa");
    }
});

function showError(msg) {
    errorMsg.innerText = msg;
    errorMsg.style.display = 'block';
    successMsg.style.display = 'none';
}

function showSuccess(msg) {
    successMsg.innerText = msg;
    successMsg.style.display = 'block';
    errorMsg.style.display = 'none';
}

function setLoading(isLoading, text) {
    btnSubmit.disabled = isLoading;
    btnSubmit.innerText = text;
}