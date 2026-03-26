// public/js/login.js
import {
    deriveKeysFromPassword,
    decryptAndImportPrivateKey,
    base64ToArrayBuffer
} from './crypto/key-manager.js';

const form = document.getElementById('login-form');
const btnSubmit = document.getElementById('btn-submit');
const errorMsg = document.getElementById('error-msg');
const successMsg = document.getElementById('success-msg'); // cần khai báo để dùng trong showSuccess

async function saveKeyToDB(privateKey, id = 'my-private-key') {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("SecureChatDB", 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys", { keyPath: "id" });
        };
        request.onsuccess = (e) => {
            const tx = e.target.result.transaction("keys", "readwrite");
            tx.objectStore("keys").put({ id, key: privateKey });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject("Lỗi lưu DB");
        };
        request.onerror = () => reject("Lỗi mở DB");
    });
}

// Giải mã Signing Private Key ECDSA (algorithm khác với ECDH)
async function decryptAndImportSigningKey(encryptedBase64, ivBase64, encryptionKey) {
    const iv = base64ToArrayBuffer(ivBase64);
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
        false,
        ["sign"]
    );
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading(true, "Đang xác thực...");

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    try {
        console.log("--- BẮT ĐẦU LOGIN JWT ---");

        // BƯỚC 1: Lấy Salt
        const saltRes = await fetch(`/api/auth/salt?username=${username}`);
        if (!saltRes.ok) throw new Error("Tài khoản không tồn tại");
        const { salt } = await saltRes.json();

        const saltBuffer = base64ToArrayBuffer(salt);

        // BƯỚC 2: Derive Keys
        const keys = await deriveKeysFromPassword(password, saltBuffer);

        // BƯỚC 3: Gửi Login
        const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, authKeyHash: keys.authKey })
        });

        const data = await loginRes.json();
        if (!loginRes.ok) throw new Error(data.message || "Đăng nhập thất bại");

        // BƯỚC 4: Lưu Access Token
        // Chỉ lưu accessToken — refreshToken nằm trong HttpOnly Cookie do server set
        console.log("Login OK! Saving Access Token...");
        localStorage.setItem('accessToken', data.accessToken);
        sessionStorage.setItem('userId', data.user.userId);
        sessionStorage.setItem('username', data.user.username);

        // BƯỚC 5: Giải mã Private Key ECDH
        console.log("Decrypting Private Key...");
        try {
            const privateKey = await decryptAndImportPrivateKey(
                data.user.encryptedPrivateKey,
                data.user.iv,
                keys.encryptionKey
            );
            await saveKeyToDB(privateKey, 'my-private-key');

            // BƯỚC 5b: Giải mã Signing Private Key ECDSA
            const signingPrivateKey = await decryptAndImportSigningKey(
                data.user.encryptedSigningPrivateKey,
                data.user.signingIv,
                keys.encryptionKey
            );
            await saveKeyToDB(signingPrivateKey, 'my-signing-key');

        } catch (decryptErr) {
            console.error(decryptErr);
            throw new Error("Mật khẩu đúng nhưng không thể giải mã khóa bảo mật! (Dữ liệu lỗi)");
        }

        showSuccess("Đăng nhập thành công!");
        setTimeout(() => window.location.href = "/", 1000);

    } catch (err) {
        console.error(err);
        showError(err.message);
        setLoading(false, "Đăng nhập");
    }
});

function showSuccess(msg) {
    successMsg.innerText = msg;
    successMsg.style.display = 'block';
    errorMsg.style.display = 'none'; // Ẩn lỗi nếu có
}

function showError(msg) {
    errorMsg.innerText = msg;
    errorMsg.style.display = 'block';
    successMsg.style.display = 'none';
}

function setLoading(isLoading, text) {
    btnSubmit.disabled = isLoading;
    btnSubmit.innerText = text;
}