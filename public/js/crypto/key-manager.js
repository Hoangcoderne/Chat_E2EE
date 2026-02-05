// public/js/crypto/key-manager.js

const ALG_KEY_GEN = { name: "ECDH", namedCurve: "P-256" }; // Thuật toán khóa công khai
const ALG_DERIVE = { name: "PBKDF2" }; // Thuật toán tách password

// Helper: Chuyển đổi Buffer sang Base64 để lưu DB/gửi đi
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Helper: Chuyển Base64 về Buffer để tính toán
export function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * 1. Tách Password thành AuthKey và EncryptionKey
 * @param {string} password - Mật khẩu người dùng nhập
 * @param {Uint8Array} salt - Salt (sinh mới khi đk, lấy từ DB khi đăng nhập)
 */
export async function deriveKeysFromPassword(password, salt) {
    const enc = new TextEncoder();
    
    // Bước 1: Import password vào Web Crypto
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", 
        enc.encode(password), 
        { name: "PBKDF2" }, 
        false, 
        ["deriveBits", "deriveKey"]
    );

    // Bước 2: Derive ra Encryption Key (AES-GCM) dùng để bọc Private Key
    const encryptionKey = await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false, // Không cho phép export khóa này ra ngoài
        ["encrypt", "decrypt"] // Khóa này chỉ dùng để encrypt/decrypt PrivateKey
    );

    // Bước 3: Derive ra Authentication Key (Dùng để gửi lên server verify)
    // Lưu ý: Ta derive ra bits rồi convert sang string hex/base64
    const authKeyBits = await window.crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        256
    );

    return { encryptionKey, authKey: arrayBufferToBase64(authKeyBits) };
}

/**
 * 2. Sinh cặp khóa ECDH (Public/Private) cho người dùng
 */
export async function generateKeyPair() {
    return await window.crypto.subtle.generateKey(
        ALG_KEY_GEN,
        true, // Cho phép export (để lưu trữ)
        ["deriveKey", "deriveBits"] // Dùng để sinh Shared Secret sau này
    );
}

/**
 * 3. Mã hóa Private Key để lưu lên Server (Key Wrapping)
 */
export async function exportAndEncryptPrivateKey(privateKey, encryptionKey) {
    // Xuất Private Key ra dạng raw data (pkcs8)
    const exportedKey = await window.crypto.subtle.exportKey("pkcs8", privateKey);
    
    // Tạo IV (Initialization Vector) ngẫu nhiên
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    // Mã hóa bằng Encryption Key (đã derive từ password)
    const encryptedContent = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        encryptionKey,
        exportedKey
    );

    return {
        iv: arrayBufferToBase64(iv),
        data: arrayBufferToBase64(encryptedContent)
    };
}

/**
 * 4. Giải mã Private Key khi đăng nhập (Key Unwrapping)
 */
export async function decryptAndImportPrivateKey(encryptedBlob, ivBase64, encryptionKey) {
    const iv = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(encryptedBlob);

    // Giải mã blob
    const decryptedKeyData = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        encryptionKey,
        data
    );

    // Import lại vào trình duyệt dưới dạng đối tượng CryptoKey
    return await window.crypto.subtle.importKey(
        "pkcs8",
        decryptedKeyData,
        ALG_KEY_GEN,
        false, // Không cho export nữa (bảo mật trong RAM)
        ["deriveKey", "deriveBits"]
    );
}

/**
 * 5. Xuất Public Key để gửi cho người khác
 */
export async function exportPublicKey(publicKey) {
    const exported = await window.crypto.subtle.exportKey("spki", publicKey);
    return arrayBufferToBase64(exported);
}

/**
* 6. Import Public Key của người khác (từ chuỗi Base64 server gửi về)
 */
export async function importPublicKey(base64Key) {
    const binary = base64ToArrayBuffer(base64Key); // Hàm này bạn đã export ở bước trước
    return await window.crypto.subtle.importKey(
        "spki",
        binary,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        [] // Public key chỉ dùng để tham chiếu, không cần quyền đặc biệt
    );
}

/**
 * 7. TẠO KHÓA CHUNG (Shared Secret) - Trái tim của E2EE
 * Kết hợp Private Key của mình và Public Key của bạn để ra khóa AES dùng chung
 */
export async function deriveSharedSecret(privateKey, publicKey) {
    // 1. ECDH: Trộn 2 khóa để ra một chuỗi bit chung
    const sharedBits = await window.crypto.subtle.deriveBits(
        { name: "ECDH", public: publicKey },
        privateKey,
        256
    );

    // 2. Chuyển chuỗi bit đó thành khóa AES-GCM để mã hóa tin nhắn
    return await window.crypto.subtle.importKey(
        "raw",
        sharedBits,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * 8. Mã hóa tin nhắn văn bản (Dùng Shared Secret vừa tạo)
 */
export async function encryptMessage(text, sharedKey) {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); // IV mới cho mỗi tin nhắn
    
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        sharedKey,
        enc.encode(text)
    );

    return {
        iv: arrayBufferToBase64(iv),
        ciphertext: arrayBufferToBase64(ciphertext)
    };
}

/**
 * 9. Giải mã tin nhắn văn bản
 */
export async function decryptMessage(encryptedObj, sharedKey) {
    const iv = base64ToArrayBuffer(encryptedObj.iv);
    const data = base64ToArrayBuffer(encryptedObj.ciphertext);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        sharedKey,
        data
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
}