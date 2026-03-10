// public/js/login.js
import { 
    deriveKeysFromPassword, 
    decryptAndImportPrivateKey,
    base64ToArrayBuffer 
} from './crypto/key-manager.js';

const form = document.getElementById('login-form');
const btnSubmit = document.getElementById('btn-submit');
const errorMsg = document.getElementById('error-msg');

// Hàm lưu khóa vào IndexedDB
async function saveKeyToDB(privateKey) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("SecureChatDB", 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys", { keyPath: "id" });
        };
        request.onsuccess = (e) => {
            const tx = e.target.result.transaction("keys", "readwrite");
            tx.objectStore("keys").put({ id: "my-private-key", key: privateKey });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject("Lỗi lưu DB");
        };
        request.onerror = () => reject("Lỗi mở DB");
    });
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

        // BƯỚC 4: Lưu Token JWT
        console.log("Login OK! Saving Token...");
        localStorage.setItem('token', data.token);
        sessionStorage.setItem('userId', data.user.userId);
        sessionStorage.setItem('username', data.user.username);

        // BƯỚC 5: Giải mã Private Key (Dùng EncryptionKey ở Bước 2)
        console.log("Decrypting Private Key...");
        
        try {
            // data.user chứa encryptedPrivateKey và iv
            const privateKey = await decryptAndImportPrivateKey(
                data.user.encryptedPrivateKey, 
                data.user.iv, 
                keys.encryptionKey
            );
            
            // Lưu Private Key vào DB trình duyệt
            await saveKeyToDB(privateKey);
            
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
    const successMsg = document.getElementById('success-msg');
    successMsg.innerText = msg;
    successMsg.style.display = 'block';
    successMsg.className = 'alert alert-success';
    errorMsg.style.display = 'none'; // Ẩn lỗi nếu có
}
function setLoading(isLoading, text) {
    btnSubmit.disabled = isLoading;
    btnSubmit.innerText = text;
}