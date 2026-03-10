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
export async function decryptAndImportPrivateKey(encryptedBase64, ivBase64, encryptionKey) {
    const iv = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(encryptedBase64);

    const decryptedKeyData = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        encryptionKey,
        data
    );

    return await window.crypto.subtle.importKey(
        "pkcs8", decryptedKeyData, ALG_KEY_GEN, false, ["deriveKey", "deriveBits"]
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

export async function decryptMessage(encryptedObj, sharedKey) {
    const iv = base64ToArrayBuffer(encryptedObj.iv);
    const data = base64ToArrayBuffer(encryptedObj.ciphertext);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv }, sharedKey, data
    );
    return new TextDecoder().decode(decryptedBuffer);
}