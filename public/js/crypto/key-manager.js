// public/js/crypto/key-manager.js

const ALG_KEY_GEN = { name: "ECDH", namedCurve: "P-256" };
const ALG_DERIVE = { name: "PBKDF2" };

// Helper: ArrayBuffer -> Base64
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Helper: Base64 -> ArrayBuffer (EXPORT ĐỂ LOGIN.JS DÙNG)
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
 * 1. Tách Password -> AuthKey (để login) + EncryptionKey (để giải mã PrivateKey)
 */
export async function deriveKeysFromPassword(password, saltBuffer) {
    const enc = new TextEncoder();
    
    // Import password
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]
    );

    // Derive Encryption Key (AES-GCM) - Dùng để giải mã Private Key
    const encryptionKey = await window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: saltBuffer, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false, 
        ["encrypt", "decrypt"]
    );

    // Derive Auth Key (HMAC/String) - Dùng để gửi lên Server xác thực
    const authKeyBits = await window.crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: saltBuffer, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        256
    );

    return { 
        encryptionKey, 
        authKey: arrayBufferToBase64(authKeyBits) // Trả về Base64
    };
}

/**
 * 2. Sinh cặp khóa ECDH
 */
export async function generateKeyPair() {
    return await window.crypto.subtle.generateKey(
        ALG_KEY_GEN, true, ["deriveKey", "deriveBits"]
    );
}

/**
 * 3. Mã hóa Private Key (Key Wrapping)
 */
export async function exportAndEncryptPrivateKey(privateKey, encryptionKey) {
    const exportedKey = await window.crypto.subtle.exportKey("pkcs8", privateKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
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
 * 4. Giải mã Private Key (Key Unwrapping)
 */
// extractable mặc định false (dùng cho login — chỉ cần dùng key, không cần export lại)
// Truyền true khi cần re-export key (dùng cho reset password flow)
export async function decryptAndImportPrivateKey(encryptedBase64, ivBase64, encryptionKey, extractable = false) {
    const iv = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(encryptedBase64);

    const decryptedKeyData = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        encryptionKey,
        data
    );

    return await window.crypto.subtle.importKey(
        "pkcs8", decryptedKeyData, ALG_KEY_GEN, extractable, ["deriveKey", "deriveBits"]
    );
}

/**
 * 5. Xuất/Nhập Public Key & Chat
 */
export async function exportPublicKey(publicKey) {
    const exported = await window.crypto.subtle.exportKey("spki", publicKey);
    return arrayBufferToBase64(exported);
}

export async function importPublicKey(base64Key) {
    const binary = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
        "spki", binary, { name: "ECDH", namedCurve: "P-256" }, true, []
    );
}

export async function deriveSharedSecret(privateKey, publicKey) {
    const sharedBits = await window.crypto.subtle.deriveBits(
        { name: "ECDH", public: publicKey }, privateKey, 256
    );
    return await window.crypto.subtle.importKey(
        "raw", sharedBits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]
    );
}

export async function encryptMessage(text, sharedKey) {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv }, sharedKey, enc.encode(text)
    );
    return { iv: arrayBufferToBase64(iv), ciphertext: arrayBufferToBase64(ciphertext) };
}

// ============================================================
// RECOVERY KEY
// Recovery key = 32 bytes ngẫu nhiên, entropy cao
// Import thẳng thành AES-GCM key (không cần PBKDF2 vì đã đủ entropy)
// Hiển thị cho user dạng: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
// ============================================================

/**
 * Tạo Recovery Key ngẫu nhiên 32 bytes
 * Trả về { raw: Uint8Array, display: string }
 * display = chuỗi dễ đọc để user lưu lại
 */
export function generateRecoveryKey() {
    const raw = window.crypto.getRandomValues(new Uint8Array(32));
    // Chuyển sang hex rồi chia thành 8 nhóm 4 ký tự ngăn cách bởi dấu -
    const hex = Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
    const display = hex.match(/.{1,8}/g).join('-').toUpperCase();
    // display ví dụ: "A3F2B1C9-04DE78FA-..."
    return { raw, display };
}

/**
 * Import Recovery Key từ chuỗi display → CryptoKey AES-GCM
 * Dùng khi reset password: user nhập chuỗi recovery key vào
 */
export async function importRecoveryKey(displayKey) {
    // Bỏ dấu - và chuyển hex về bytes
    const hex = displayKey.replace(/-/g, '').toLowerCase();
    if (hex.length !== 64) throw new Error("Recovery key không hợp lệ");
    const bytes = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));

    return await window.crypto.subtle.importKey(
        "raw", bytes,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * Import Recovery Key từ raw Uint8Array → CryptoKey AES-GCM
 * Dùng ngay sau khi generate lúc đăng ký
 */
export async function importRecoveryKeyFromRaw(rawBytes) {
    return await window.crypto.subtle.importKey(
        "raw", rawBytes,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
}

// ============================================================
// DIGITAL SIGNATURE (ECDSA P-256)
// Keypair riêng biệt với ECDH — Web Crypto không cho dùng chung
// ============================================================

/**
 * Tạo cặp khóa ECDSA để ký số
 * Khác với generateKeyPair() dùng ECDH — cái này dùng ECDSA
 */
export async function generateSigningKeyPair() {
    return await window.crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true, // extractable: true để có thể export lưu lên server
        ["sign", "verify"]
    );
}

/**
 * Ký tin nhắn bằng signing private key của người gửi
 * Ký trên PLAINTEXT trước khi mã hóa
 */
export async function signMessage(text, signingPrivateKey) {
    const enc = new TextEncoder();
    const signature = await window.crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        signingPrivateKey,
        enc.encode(text)
    );
    return arrayBufferToBase64(signature);
}

/**
 * Verify chữ ký của tin nhắn
 * Verify trên PLAINTEXT sau khi giải mã
 * Trả về true/false
 */
export async function verifySignature(text, signatureBase64, senderSigningPublicKey) {
    try {
        const enc = new TextEncoder();
        const signatureBuffer = base64ToArrayBuffer(signatureBase64);
        return await window.crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            senderSigningPublicKey,
            signatureBuffer,
            enc.encode(text)
        );
    } catch (err) {
        // Nếu signature bị corrupt hoặc format sai → coi như invalid
        console.error("Verify error:", err);
        return false;
    }
}

/**
 * Xuất Signing Public Key sang Base64 để lưu server
 * Dùng "spki" format — chuẩn cho public key
 */
export async function exportSigningPublicKey(publicKey) {
    const exported = await window.crypto.subtle.exportKey("spki", publicKey);
    return arrayBufferToBase64(exported);
}

/**
 * Import Signing Public Key từ Base64 (khi nhận từ server)
 * Chỉ cần "verify" usage — không cần "sign"
 */
export async function importSigningPublicKey(base64Key) {
    const binary = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
        "spki", binary,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"] // Chỉ verify — public key không sign được
    );
}

export async function decryptMessage(encryptedObj, sharedKey) {
    const iv = base64ToArrayBuffer(encryptedObj.iv);
    const data = base64ToArrayBuffer(encryptedObj.ciphertext);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv }, sharedKey, data
    );
    return new TextDecoder().decode(decryptedBuffer);
}