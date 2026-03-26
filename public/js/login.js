// public/js/login.js
import { 
    deriveKeysFromPassword, 
    decryptAndImportPrivateKey,
    base64ToArrayBuffer,
    importSigningPublicKey   // [MỚI] dùng để import signing private key
} from './crypto/key-manager.js';

const form = document.getElementById('login-form');
const btnSubmit = document.getElementById('btn-submit');
const errorMsg = document.getElementById('error-msg');

// Hàm lưu khóa vào IndexedDB — nhận thêm tham số id để lưu nhiều loại key
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

// [MỚI] Giải mã Signing Private Key ECDSA
// Khác decryptAndImportPrivateKey ở chỗ import với algorithm ECDSA thay vì ECDH
async function decryptAndImportSigningKey(encryptedBase64, ivBase64, encryptionKey) {
    const { base64ToArrayBuffer } = await import('./crypto/key-manager.js');
    const iv = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(encryptedBase64);

    const decryptedKeyData = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        encryptionKey,
        data
    );

    // Import với ECDSA — đây là điểm khác với ECDH private key
    return await window.crypto.subtle.importKey(
        "pkcs8",
        decryptedKeyData,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"] // Signing private key chỉ dùng để sign
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
        // Lưu ý: Route backend bạn cần đổi login-params thành GET /salt hoặc giữ nguyên logic lấy salt
        const saltRes = await fetch(`/api/auth/salt?username=${username}`);
        if (!saltRes.ok) throw new Error("Tài khoản không tồn tại");
        const { salt } = await saltRes.json();
        
        // Salt từ server trả về có thể là Hex hoặc Base64. 
        // Giả sử server trả Hex (từ controller cũ), ta cần convert.
        // Nếu server mới trả Base64 thì dùng base64ToArrayBuffer.
        // Ở đây giả định Salt là Base64 cho khớp với key-manager
        const saltBuffer = base64ToArrayBuffer(salt); // Nếu lỗi thì kiểm tra lại định dạng Salt backend trả về

        // BƯỚC 2: Derive Keys (Tạo AuthKey và EncryptionKey)
        const keys = await deriveKeysFromPassword(password, saltBuffer);

        // BƯỚC 3: Gửi Login (Kèm AuthKey)
        const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username, 
                authKeyHash: keys.authKey // Gửi hash lên server so sánh
            })
        });

        const data = await loginRes.json();
        if (!loginRes.ok) throw new Error(data.message || "Đăng nhập thất bại");

        // BƯỚC 4: Lưu cả 2 token
        console.log("Login OK! Saving Tokens...");
        localStorage.setItem('accessToken', data.accessToken);   // [SỬA] 15 phút
        localStorage.setItem('refreshToken', data.refreshToken); // [MỚI] 24 giờ
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

            // [MỚI] BƯỚC 5b: Giải mã Signing Private Key ECDSA
            // Dùng cùng hàm decryptAndImportPrivateKey nhưng key khác
            // Tuy nhiên cần import với ECDSA algorithm nên dùng hàm riêng
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

function showError(msg) {
    errorMsg.innerText = msg;
    errorMsg.style.display = 'block';
    errorMsg.className = 'alert alert-danger';
}
function showSuccess(msg) {
    errorMsg.innerText = msg;
    errorMsg.style.display = 'block';
    errorMsg.className = 'alert alert-success';
}
function setLoading(isLoading, text) {
    btnSubmit.disabled = isLoading;
    btnSubmit.innerText = text;
}