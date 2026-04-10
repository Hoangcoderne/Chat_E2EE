// public/js/crypto/key-manager.js

const ALG_KEY_GEN = { name: "ECDH", namedCurve: "P-256" };

export function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

// 1. Tách Password -> AuthKey (để login) + EncryptionKey (để giải mã PrivateKey)
// Domain Separation: dùng salt khác nhau cho AuthKey và EncryptionKey
// để compromise một key không ảnh hưởng key còn lại.
export async function deriveKeysFromPassword(password, saltBuffer) {
    const enc = new TextEncoder();

    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]
    );

    // Domain-separated salts: nối salt gốc với context string
    const saltBytes = new Uint8Array(saltBuffer);
    const encSalt  = new Uint8Array([...saltBytes, ...enc.encode("encrypt")]);
    const authSalt = new Uint8Array([...saltBytes, ...enc.encode("auth")]);

    const encryptionKey = await window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: encSalt, iterations: 600000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );

    const authKeyBits = await window.crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: authSalt, iterations: 600000, hash: "SHA-256" },
        keyMaterial,
        256
    );

    return {
        encryptionKey,
        authKey: arrayBufferToBase64(authKeyBits)
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
        { name: "AES-GCM", iv },
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
export async function decryptAndImportPrivateKey(encryptedBase64, ivBase64, encryptionKey, extractable = false) {
    const iv = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(encryptedBase64);

    const decryptedKeyData = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
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
        { name: "AES-GCM", iv }, sharedKey, enc.encode(text)
    );
    return { iv: arrayBufferToBase64(iv), ciphertext: arrayBufferToBase64(ciphertext) };
}

export async function decryptMessage(encryptedObj, sharedKey) {
    const iv = base64ToArrayBuffer(encryptedObj.iv);
    const data = base64ToArrayBuffer(encryptedObj.ciphertext);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv }, sharedKey, data
    );
    return new TextDecoder().decode(decryptedBuffer);
}

// ============================================================
// RECOVERY KEY
// ============================================================

export function generateRecoveryKey() {
    const raw = window.crypto.getRandomValues(new Uint8Array(32));
    const hex = Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
    const display = hex.match(/.{1,8}/g).join('-').toUpperCase();
    return { raw, display };
}

export async function importRecoveryKey(displayKey) {
    const hex = displayKey.replace(/-/g, '').toLowerCase();
    if (hex.length !== 64) throw new Error("Recovery key không hợp lệ");
    const bytes = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
    return await window.crypto.subtle.importKey(
        "raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]
    );
}

export async function importRecoveryKeyFromRaw(rawBytes) {
    return await window.crypto.subtle.importKey(
        "raw", rawBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]
    );
}

// ============================================================
// DIGITAL SIGNATURE (ECDSA P-256)
// ============================================================

export async function generateSigningKeyPair() {
    return await window.crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
    );
}

export async function signMessage(text, signingPrivateKey) {
    const enc = new TextEncoder();
    const signature = await window.crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        signingPrivateKey,
        enc.encode(text)
    );
    return arrayBufferToBase64(signature);
}

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
        console.error("Verify error:", err);
        return false;
    }
}

export async function exportSigningPublicKey(publicKey) {
    const exported = await window.crypto.subtle.exportKey("spki", publicKey);
    return arrayBufferToBase64(exported);
}

export async function importSigningPublicKey(base64Key) {
    const binary = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
        "spki", binary,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"]
    );
}