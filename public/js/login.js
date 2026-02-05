// public/js/login.js
import { 
    deriveKeysFromPassword, 
    decryptAndImportPrivateKey,
    base64ToArrayBuffer // Helper này cần export từ key-manager hoặc copy lại
} from './crypto/key-manager.js';

const form = document.getElementById('login-form');
const btnSubmit = document.getElementById('btn-submit');
const errorMsg = document.getElementById('error-msg');

// --- HÀM HỖ TRỢ LƯU KHÓA VÀO INDEXED DB ---
// Chúng ta cần lưu Private Key vào DB trình duyệt để trang chat (index.html) dùng được
async function saveKeyToSession(privateKey) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("SecureChatDB", 1);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("keys")) {
                db.createObjectStore("keys", { keyPath: "id" });
            }
        };

        request.onsuccess = (event) => {
            const db = event.target.result;
            const tx = db.transaction("keys", "readwrite");
            const store = tx.objectStore("keys");
            // Lưu khóa với ID cố định là 'my-private-key'
            store.put({ id: "my-private-key", key: privateKey });
            
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject("Lỗi lưu khóa vào DB");
        };
        request.onerror = () => reject("Không mở được IndexedDB");
    });
}
// -------------------------------------------

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading(true, "Đang xác thực...");

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    try {
        console.log("--- BẮT ĐẦU QUY TRÌNH LOGIN E2EE ---");

        // BƯỚC 1: Lấy thông tin Salt và Encrypted Key từ Server
        // (Server chưa kiểm tra pass vội, chỉ đưa dữ liệu để client tự xử)
        console.log("1. Fetching Login Params...");
        const paramRes = await fetch('/api/auth/login-params', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        if (!paramRes.ok) throw new Error("Tài khoản không tồn tại");
        const { salt, encryptedPrivateKey, iv } = await paramRes.json();
        
        // Convert salt từ base64 về Uint8Array để tính toán
        const saltBuffer = _base64ToArrayBuffer(salt); 

        // BƯỚC 2: Tái tạo Key từ Password nhập vào
        console.log("2. Deriving Keys...");
        const keys = await deriveKeysFromPassword(password, saltBuffer);
        // keys.authKey: Dùng để login server
        // keys.encryptionKey: Dùng để giải mã Private Key bên dưới

        // BƯỚC 3: Giải mã Private Key (Thử thách Password)
        // Nếu password sai -> encryptionKey sai -> giải mã thất bại -> văng lỗi
        console.log("3. Decrypting Private Key...");
        let privateKey;
        try {
            privateKey = await decryptAndImportPrivateKey(encryptedPrivateKey, iv, keys.encryptionKey);
        } catch (decryptErr) {
            throw new Error("Mật khẩu sai! Không thể giải mã Private Key.");
        }

        // BƯỚC 4: Xác thực với Server (Gửi AuthKey hash)
        // Đến đây ta đã chắc chắn pass đúng (vì giải mã được), nhưng server cần verify
        console.log("4. Authenticating with Server...");
        const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, authKeyHash: keys.authKey })
        });

        const loginData = await loginRes.json();
        if (!loginRes.ok) throw new Error(loginData.message || "Đăng nhập thất bại");

        // BƯỚC 5: Lưu session và chuyển hướng
        console.log("5. Saving Session...");
        
        // 5a. Lưu thông tin public vào SessionStorage (RAM tab)
        sessionStorage.setItem('userId', loginData.userId);
        sessionStorage.setItem('username', loginData.username);
        sessionStorage.setItem('publicKey', loginData.publicKey); // Lưu publicKey của mình

        // 5b. Lưu Private Key vào IndexedDB (Để trang index.html đọc được)
        await saveKeyToSession(privateKey);

        showSuccess("Đăng nhập thành công! Đang vào chat...");
        setTimeout(() => {
            window.location.href = "/"; // Về trang chủ (Chat)
        }, 1000);

    } catch (err) {
        console.error(err);
        showError(err.message);
        setLoading(false, "Đăng nhập");
    }
});

// Helper cục bộ (Nếu bạn chưa export từ key-manager thì dùng cái này)
function _base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes;
}

function showError(msg) {
    errorMsg.innerText = msg;
    errorMsg.style.display = 'block';
}
function showSuccess(msg) {
    // Có thể dùng thẻ success-msg nếu muốn
    errorMsg.style.display = 'none';
    alert(msg); 
}
function setLoading(isLoading, text) {
    btnSubmit.disabled = isLoading;
    btnSubmit.innerText = text;
}