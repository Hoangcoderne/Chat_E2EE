// public/js/register.js
import { 
    deriveKeysFromPassword, 
    generateKeyPair, 
    exportAndEncryptPrivateKey, 
    exportPublicKey,
    generateSigningKeyPair,
    exportSigningPublicKey,
    generateRecoveryKey,          // [MỚI]
    importRecoveryKeyFromRaw      // [MỚI]
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

        // 3. Tạo KeyPair ECDH (để mã hóa tin nhắn)
        const keyPair = await generateKeyPair();

        // [MỚI] 3b. Tạo KeyPair ECDSA (để ký số tin nhắn)
        const signingKeyPair = await generateSigningKeyPair();

        // 4. Mã hóa Private Key ECDH
        const encryptedData = await exportAndEncryptPrivateKey(keyPair.privateKey, keys.encryptionKey);

        // [MỚI] 4b. Mã hóa Signing Private Key ECDSA (cùng hàm, khác keypair)
        const encryptedSigningData = await exportAndEncryptPrivateKey(signingKeyPair.privateKey, keys.encryptionKey);

        // 5. Xuất Public Key ECDH
        const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);

        // [MỚI] 5b. Xuất Signing Public Key ECDSA
        const signingPublicKeyBase64 = await exportSigningPublicKey(signingKeyPair.publicKey);

        // [MỚI] 4c. Tạo Recovery Key ngẫu nhiên
        const { raw: recoveryRaw, display: recoveryDisplay } = generateRecoveryKey();
        const recoveryKey = await importRecoveryKeyFromRaw(recoveryRaw);

        // [MỚI] 4d. Mã hóa Private Keys bằng recovery key (bản backup)
        const recoveryEncryptedData = await exportAndEncryptPrivateKey(keyPair.privateKey, recoveryKey);
        const recoveryEncryptedSigningData = await exportAndEncryptPrivateKey(signingKeyPair.privateKey, recoveryKey);

        // 6. Gửi Server
        const payload = {
            username,
            salt: saltBase64,
            authKeyHash: keys.authKey,
            publicKey: publicKeyBase64,
            encryptedPrivateKey: encryptedData.data,
            iv: encryptedData.iv,
            signingPublicKey: signingPublicKeyBase64,
            encryptedSigningPrivateKey: encryptedSigningData.data,
            signingIv: encryptedSigningData.iv,
            // [MỚI] Recovery key bundle
            recoveryKeyPlain: recoveryDisplay,  // Server sẽ bcrypt hash cái này
            encryptedPrivateKeyByRecovery: recoveryEncryptedData.data,
            recoveryIv: recoveryEncryptedData.iv,
            encryptedSigningPrivateKeyByRecovery: recoveryEncryptedSigningData.data,
            recoverySigningIv: recoveryEncryptedSigningData.iv
        };

        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await res.json();
        if (!res.ok) throw new Error(result.message || "Đăng ký thất bại");

        // [MỚI] Hiện recovery key cho user — chỉ 1 lần duy nhất
        showRecoveryKey(recoveryDisplay);

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

// [MỚI] Hiện recovery key sau khi đăng ký thành công
// Ẩn form, hiện panel recovery key — user PHẢI xác nhận đã lưu mới được tiếp tục
function showRecoveryKey(recoveryDisplay) {
    // Ẩn form đăng ký
    document.getElementById('register-form').style.display = 'none';
    btnSubmit.style.display = 'none';

    // Tạo panel hiện recovery key
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: #fffbe6;
        border: 2px solid #f0a500;
        border-radius: 8px;
        padding: 20px;
        margin: 10px 0;
        text-align: center;
    `;
    panel.innerHTML = `
        <div style="font-size:2em; margin-bottom:8px">🔑</div>
        <h3 style="color:#b37400; margin:0 0 10px 0; font-size:1em">
            Recovery Key của bạn
        </h3>
        <p style="font-size:0.82em; color:#666; margin-bottom:14px; line-height:1.5">
            Lưu key này ở nơi an toàn.<br>
            <strong>Đây là lần DUY NHẤT key được hiển thị.</strong><br>
            Nếu mất, bạn sẽ không thể khôi phục tài khoản khi quên mật khẩu.
        </p>
        <div id="recovery-key-display" style="
            font-family: monospace;
            font-size: 0.95em;
            font-weight: bold;
            background: white;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 12px;
            letter-spacing: 1px;
            word-break: break-all;
            color: #333;
            margin-bottom: 12px;
        ">${recoveryDisplay}</div>
        <button id="btn-copy-recovery" style="
            background: #f0a500; color: white; border: none;
            padding: 7px 18px; border-radius: 4px; cursor: pointer;
            font-size: 0.9em; margin-bottom: 16px;
        ">📋 Sao chép</button>
        <div>
            <label style="display:flex; align-items:center; gap:8px; justify-content:center; font-size:0.85em; cursor:pointer">
                <input type="checkbox" id="confirm-saved">
                Tôi đã lưu Recovery Key an toàn
            </label>
        </div>
        <button id="btn-goto-login" style="
            width:100%; padding:10px; background:#ccc; color:white;
            border:none; border-radius:4px; cursor:not-allowed;
            font-weight:bold; margin-top:12px; font-size:0.95em;
        " disabled>Đến trang đăng nhập →</button>
    `;

    // Chèn panel vào sau successMsg
    successMsg.parentNode.insertBefore(panel, successMsg.nextSibling);
    showSuccess("Đăng ký thành công! Hãy lưu Recovery Key trước khi tiếp tục.");

    // Nút copy
    document.getElementById('btn-copy-recovery').addEventListener('click', () => {
        navigator.clipboard.writeText(recoveryDisplay).then(() => {
            document.getElementById('btn-copy-recovery').innerText = '✅ Đã sao chép';
        });
    });

    // Checkbox xác nhận → mở khoá nút đăng nhập
    document.getElementById('confirm-saved').addEventListener('change', (e) => {
        const btn = document.getElementById('btn-goto-login');
        if (e.target.checked) {
            btn.disabled = false;
            btn.style.background = '#28a745';
            btn.style.cursor = 'pointer';
        } else {
            btn.disabled = true;
            btn.style.background = '#ccc';
            btn.style.cursor = 'not-allowed';
        }
    });

    // Nút đến login
    document.getElementById('btn-goto-login').addEventListener('click', () => {
        window.location.href = '/login.html';
    });
}