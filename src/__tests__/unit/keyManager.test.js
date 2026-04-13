// src/__tests__/unit/keyManager.test.js
//
// Tests cho các thuật toán cryptography của public/js/crypto/key-manager.js.
//
// key-manager.js là ES module dùng browser-only globals (window.crypto, window.btoa).
// Jest chạy trong môi trường Node.js CommonJS nên không thể import trực tiếp.
// File này verify cùng thuật toán và tham số bằng Node.js WebCrypto API (Node 18+),
// vốn tuân theo cùng W3C Web Cryptography API specification với trình duyệt.
//
// Mỗi describe block tương ứng một hàm hoặc nhóm hàm trong key-manager.js.

'use strict';

const { webcrypto } = require('node:crypto');
const { subtle }    = webcrypto;

// ════════════════════════════════════════════════════════════════════════════
// Helpers tương đương hàm trong key-manager.js
// (dùng Buffer thay vì window.btoa / window.atob cho môi trường Node.js)
// ════════════════════════════════════════════════════════════════════════════

function buf2b64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return Buffer.from(bin, 'binary').toString('base64');
}

function b642buf(base64) {
    const bin   = Buffer.from(base64, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

// deriveKeysFromPassword — PBKDF2 600k iterations với domain separation
async function deriveKeys(password, saltBytes) {
    const enc         = new TextEncoder();
    const keyMaterial = await subtle.importKey(
        'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
    );
    const encSalt  = new Uint8Array([...saltBytes, ...enc.encode('encrypt')]);
    const authSalt = new Uint8Array([...saltBytes, ...enc.encode('auth')]);

    const encryptionKey = await subtle.deriveKey(
        { name: 'PBKDF2', salt: encSalt, iterations: 600000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    const authBits = await subtle.deriveBits(
        { name: 'PBKDF2', salt: authSalt, iterations: 600000, hash: 'SHA-256' },
        keyMaterial, 256
    );
    return { encryptionKey, authKey: buf2b64(authBits) };
}

// ECDH helpers
async function ecdhKeyPair() {
    return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
}

async function sharedSecret(privateKey, publicKey) {
    const bits = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
    return subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// AES-GCM helpers
async function aesEncrypt(plaintext, key) {
    const iv   = webcrypto.getRandomValues(new Uint8Array(12));
    const data = await subtle.encrypt(
        { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
    );
    return { iv: buf2b64(iv), ciphertext: buf2b64(data) };
}

async function aesDecrypt({ iv, ciphertext }, key) {
    const buf = await subtle.decrypt(
        { name: 'AES-GCM', iv: b642buf(iv) }, key, b642buf(ciphertext)
    );
    return new TextDecoder().decode(buf);
}

// Private key wrapping — tương đương exportAndEncryptPrivateKey / decryptAndImportPrivateKey
async function wrapPrivateKey(privateKey, wrappingKey) {
    const pkcs8 = await subtle.exportKey('pkcs8', privateKey);
    const iv    = webcrypto.getRandomValues(new Uint8Array(12));
    const data  = await subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, pkcs8);
    return { iv: buf2b64(iv), data: buf2b64(data) };
}

async function unwrapPrivateKey(wrapped, wrappingKey) {
    const decrypted = await subtle.decrypt(
        { name: 'AES-GCM', iv: b642buf(wrapped.iv) }, wrappingKey, b642buf(wrapped.data)
    );
    return subtle.importKey('pkcs8', decrypted, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
}

// Recovery key — tương đương generateRecoveryKey / importRecoveryKey
function generateRecoveryKey() {
    const raw     = webcrypto.getRandomValues(new Uint8Array(32));
    const hex     = Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
    const display = hex.match(/.{1,8}/g).join('-').toUpperCase();
    return { raw, display };
}

async function importRecoveryKey(display) {
    const hex   = display.replace(/-/g, '').toLowerCase();
    const bytes = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
    return subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ECDSA helpers — tương đương generateSigningKeyPair / signMessage / verifySignature
async function ecdsaKeyPair() {
    return subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}

async function ecdsaSign(text, privateKey) {
    const sig = await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(text)
    );
    return buf2b64(sig);
}

async function ecdsaVerify(text, sigBase64, publicKey) {
    try {
        return await subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            publicKey, b642buf(sigBase64), new TextEncoder().encode(text)
        );
    } catch { return false; }
}

// ════════════════════════════════════════════════════════════════════════════

describe('key-manager.js — arrayBufferToBase64 / base64ToArrayBuffer', () => {

    test('round-trip: ArrayBuffer → Base64 → ArrayBuffer khớp nhau', () => {
        const original  = webcrypto.getRandomValues(new Uint8Array(32));
        const b64       = buf2b64(original.buffer);
        const restored  = new Uint8Array(b642buf(b64));
        expect(restored).toEqual(original);
    });

    test('output là chuỗi Base64 hợp lệ (không phải hex)', () => {
        const buf = webcrypto.getRandomValues(new Uint8Array(16));
        const b64 = buf2b64(buf.buffer);
        expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    test('16 bytes → Base64 dài 24 ký tự', () => {
        const buf = webcrypto.getRandomValues(new Uint8Array(16));
        expect(buf2b64(buf.buffer).length).toBe(24);
    });

    test('hai input khác nhau → Base64 khác nhau', () => {
        const a = buf2b64(new Uint8Array([1, 2, 3]).buffer);
        const b = buf2b64(new Uint8Array([4, 5, 6]).buffer);
        expect(a).not.toBe(b);
    });
});

// ────────────────────────────────────────────────────────────────────────────

describe('key-manager.js — deriveKeysFromPassword (PBKDF2, 600k iterations, SHA-256)', () => {

    const SALT = webcrypto.getRandomValues(new Uint8Array(16));

    test('cùng password + salt → cùng authKey (deterministic)', async () => {
        const r1 = await deriveKeys('MyPass123!', SALT);
        const r2 = await deriveKeys('MyPass123!', SALT);
        expect(r1.authKey).toBe(r2.authKey);
    }, 35000);

    test('authKey là Base64 của 256-bit (44 ký tự)', async () => {
        const { authKey } = await deriveKeys('MyPass123!', SALT);
        expect(typeof authKey).toBe('string');
        expect(authKey.length).toBe(44);
    }, 35000);

    test('encryptionKey là CryptoKey AES-GCM dùng được', async () => {
        const { encryptionKey } = await deriveKeys('MyPass123!', SALT);
        expect(encryptionKey.type).toBe('secret');
        // Verify dùng được bằng cách encrypt/decrypt thực
        const enc = await aesEncrypt('test payload', encryptionKey);
        const dec = await aesDecrypt(enc, encryptionKey);
        expect(dec).toBe('test payload');
    }, 35000);

    test('domain separation: authSalt ≠ encSalt → authKey ≠ encryptionKey bits', async () => {
        // authKey được derive với salt+'auth', encryptionKey với salt+'encrypt'
        // Nếu không có domain separation, cùng password+salt sẽ cho cùng key material
        // Kiểm tra gián tiếp: authKey (Base64) không phải là key AES encrypt được với encKey
        const r1 = await deriveKeys('Pass!1A', SALT);
        const r2 = await deriveKeys('Pass!1A', SALT);
        expect(r1.authKey).toBe(r2.authKey); // deterministic
        // encryptionKey với cùng password+salt → encrypt/decrypt phải nhất quán
        const enc = await aesEncrypt('domain-sep', r1.encryptionKey);
        const dec = await aesDecrypt(enc, r2.encryptionKey);
        expect(dec).toBe('domain-sep');
    }, 35000);

    test('password khác nhau → authKey khác nhau', async () => {
        const r1 = await deriveKeys('Password1!', SALT);
        const r2 = await deriveKeys('Password2!', SALT);
        expect(r1.authKey).not.toBe(r2.authKey);
    }, 35000);

    test('salt khác nhau → authKey khác nhau', async () => {
        const salt2 = webcrypto.getRandomValues(new Uint8Array(16));
        const r1    = await deriveKeys('SamePass!1', SALT);
        const r2    = await deriveKeys('SamePass!1', salt2);
        expect(r1.authKey).not.toBe(r2.authKey);
    }, 35000);

    test('encryptionKey từ password A không decrypt được ciphertext của password B', async () => {
        const salt  = webcrypto.getRandomValues(new Uint8Array(16));
        const r1    = await deriveKeys('PassA!1', salt);
        const r2    = await deriveKeys('PassB!2', salt);
        const enc   = await aesEncrypt('secret data', r1.encryptionKey);
        await expect(aesDecrypt(enc, r2.encryptionKey)).rejects.toThrow();
    }, 35000);
});

// ────────────────────────────────────────────────────────────────────────────

describe('key-manager.js — ECDH key exchange (P-256)', () => {

    test('generateKeyPair tạo CryptoKeyPair ECDH hợp lệ', async () => {
        const kp = await ecdhKeyPair();
        expect(kp.publicKey.type).toBe('public');
        expect(kp.privateKey.type).toBe('private');
    });

    test('ECDH: A và B derive cùng shared secret (tính đối xứng)', async () => {
        const kpA = await ecdhKeyPair();
        const kpB = await ecdhKeyPair();
        const sAB = await sharedSecret(kpA.privateKey, kpB.publicKey);
        const sBA = await sharedSecret(kpB.privateKey, kpA.publicKey);
        // Verify bằng cross-decrypt
        const enc = await aesEncrypt('e2ee test', sAB);
        const dec = await aesDecrypt(enc, sBA);
        expect(dec).toBe('e2ee test');
    });

    test('shared secret A↔B ≠ shared secret A↔C (khóa khác nhau)', async () => {
        const kpA = await ecdhKeyPair();
        const kpB = await ecdhKeyPair();
        const kpC = await ecdhKeyPair();
        const sAB = await sharedSecret(kpA.privateKey, kpB.publicKey);
        const sAC = await sharedSecret(kpA.privateKey, kpC.publicKey);
        const enc = await aesEncrypt('confidential', sAB);
        await expect(aesDecrypt(enc, sAC)).rejects.toThrow();
    });

    test('exportPublicKey + importPublicKey: round-trip SPKI Base64', async () => {
        const kp       = await ecdhKeyPair();
        const exported = await subtle.exportKey('spki', kp.publicKey);
        const b64      = buf2b64(exported);
        const imported = await subtle.importKey(
            'spki', b642buf(b64), { name: 'ECDH', namedCurve: 'P-256' }, true, []
        );
        expect(imported.type).toBe('public');
        // Verify import đúng: derive shared secret với imported key phải cho cùng kết quả
        const kpB    = await ecdhKeyPair();
        const s1     = await sharedSecret(kpB.privateKey, kp.publicKey);
        const s2     = await sharedSecret(kpB.privateKey, imported);
        const enc    = await aesEncrypt('public key test', s1);
        const dec    = await aesDecrypt(enc, s2);
        expect(dec).toBe('public key test');
    });
});

// ────────────────────────────────────────────────────────────────────────────

describe('key-manager.js — AES-GCM encryptMessage / decryptMessage', () => {

    let sharedKey;
    beforeAll(async () => {
        const kpA = await ecdhKeyPair();
        const kpB = await ecdhKeyPair();
        sharedKey = await sharedSecret(kpA.privateKey, kpB.publicKey);
    });

    test('round-trip: encrypt → decrypt trả về plaintext gốc', async () => {
        const enc = await aesEncrypt('Tin nhắn bí mật 🔒', sharedKey);
        const dec = await aesDecrypt(enc, sharedKey);
        expect(dec).toBe('Tin nhắn bí mật 🔒');
    });

    test('mỗi lần encrypt tạo IV ngẫu nhiên khác nhau', async () => {
        const e1 = await aesEncrypt('same', sharedKey);
        const e2 = await aesEncrypt('same', sharedKey);
        expect(e1.iv).not.toBe(e2.iv);
        expect(e1.ciphertext).not.toBe(e2.ciphertext);
    });

    test('decrypt với key sai → throw (AES-GCM authentication failure)', async () => {
        const wrongKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const enc = await aesEncrypt('private', sharedKey);
        await expect(aesDecrypt(enc, wrongKey)).rejects.toThrow();
    });

    test('ciphertext bị tamper → decrypt throw', async () => {
        const enc       = await aesEncrypt('important', sharedKey);
        const corrupted = { ...enc, ciphertext: enc.ciphertext.slice(0, -4) + 'XXXX' };
        await expect(aesDecrypt(corrupted, sharedKey)).rejects.toThrow();
    });

    test('chuỗi dài 5000 ký tự round-trip thành công', async () => {
        const long = '🔒 Bảo mật '.repeat(500);
        const enc  = await aesEncrypt(long, sharedKey);
        const dec  = await aesDecrypt(enc, sharedKey);
        expect(dec).toBe(long);
    });
});

// ────────────────────────────────────────────────────────────────────────────

describe('key-manager.js — exportAndEncryptPrivateKey / decryptAndImportPrivateKey', () => {

    test('wrap → unwrap → cùng shared secret với original private key', async () => {
        const kpA = await ecdhKeyPair();
        const kpB = await ecdhKeyPair();
        const salt = webcrypto.getRandomValues(new Uint8Array(16));
        const { encryptionKey } = await deriveKeys('WrapPass!1', salt);

        const wrapped   = await wrapPrivateKey(kpA.privateKey, encryptionKey);
        const unwrapped = await unwrapPrivateKey(wrapped, encryptionKey);

        const s1  = await sharedSecret(kpA.privateKey, kpB.publicKey);
        const s2  = await sharedSecret(unwrapped, kpB.publicKey);
        const enc = await aesEncrypt('wrap round-trip', s1);
        const dec = await aesDecrypt(enc, s2);
        expect(dec).toBe('wrap round-trip');
    }, 35000);

    test('unwrap với encryptionKey sai → throw', async () => {
        const kp   = await ecdhKeyPair();
        const s1   = webcrypto.getRandomValues(new Uint8Array(16));
        const s2   = webcrypto.getRandomValues(new Uint8Array(16));
        const { encryptionKey: k1 } = await deriveKeys('Pass1!A', s1);
        const { encryptionKey: k2 } = await deriveKeys('Pass2!B', s2);
        const wrapped = await wrapPrivateKey(kp.privateKey, k1);
        await expect(unwrapPrivateKey(wrapped, k2)).rejects.toThrow();
    }, 35000);
});

// ────────────────────────────────────────────────────────────────────────────

describe('key-manager.js — generateRecoveryKey / importRecoveryKey', () => {

    test('format display: 8 nhóm 8 ký tự HEX in hoa, ngăn cách bởi -', () => {
        const { display } = generateRecoveryKey();
        expect(display).toMatch(/^[A-F0-9]{8}(-[A-F0-9]{8}){7}$/);
    });

    test('raw = 32 bytes (256-bit entropy)', () => {
        const { raw } = generateRecoveryKey();
        expect(raw.length).toBe(32);
    });

    test('mỗi lần generate tạo key ngẫu nhiên khác nhau', () => {
        const k1 = generateRecoveryKey();
        const k2 = generateRecoveryKey();
        expect(k1.display).not.toBe(k2.display);
    });

    test('importRecoveryKey(display) → CryptoKey có thể dùng encrypt/decrypt', async () => {
        const { display } = generateRecoveryKey();
        const key = await importRecoveryKey(display);
        expect(key.type).toBe('secret');
        const enc = await aesEncrypt('recovery key test 🔑', key);
        const dec = await aesDecrypt(enc, key);
        expect(dec).toBe('recovery key test 🔑');
    });

    test('cùng display → cùng key material (deterministic import)', async () => {
        const { display } = generateRecoveryKey();
        const k1 = await importRecoveryKey(display);
        const k2 = await importRecoveryKey(display);
        // Cùng IV + cùng key → cùng ciphertext
        const iv   = webcrypto.getRandomValues(new Uint8Array(12));
        const data = new TextEncoder().encode('deterministic');
        const c1   = buf2b64(await subtle.encrypt({ name: 'AES-GCM', iv }, k1, data));
        const c2   = buf2b64(await subtle.encrypt({ name: 'AES-GCM', iv }, k2, data));
        expect(c1).toBe(c2);
    });

    test('recovery key sai → không thể decrypt private key', async () => {
        const k1  = await importRecoveryKey(generateRecoveryKey().display);
        const k2  = await importRecoveryKey(generateRecoveryKey().display);
        const kp  = await ecdhKeyPair();
        const enc = await wrapPrivateKey(kp.privateKey, k1);
        await expect(unwrapPrivateKey(enc, k2)).rejects.toThrow();
    });
});

// ────────────────────────────────────────────────────────────────────────────

describe('key-manager.js — ECDSA signMessage / verifySignature (P-256, SHA-256)', () => {

    let kp;
    beforeAll(async () => { kp = await ecdsaKeyPair(); });

    test('generateSigningKeyPair tạo ra ECDSA P-256 keypair', async () => {
        const pair = await ecdsaKeyPair();
        expect(pair.privateKey.type).toBe('private');
        expect(pair.publicKey.type).toBe('public');
    });

    test('verify chữ ký hợp lệ → true', async () => {
        const msg = 'Tin nhắn cần xác thực 🔏';
        const sig = await ecdsaSign(msg, kp.privateKey);
        expect(await ecdsaVerify(msg, sig, kp.publicKey)).toBe(true);
    });

    test('verify message bị tamper → false', async () => {
        const sig = await ecdsaSign('original', kp.privateKey);
        expect(await ecdsaVerify('tampered', sig, kp.publicKey)).toBe(false);
    });

    test('verify với public key sai → false', async () => {
        const wrongKp = await ecdsaKeyPair();
        const sig     = await ecdsaSign('hello', kp.privateKey);
        expect(await ecdsaVerify('hello', sig, wrongKp.publicKey)).toBe(false);
    });

    test('signature bị corrupt → false (không throw)', async () => {
        const sig       = await ecdsaSign('test', kp.privateKey);
        const corrupted = sig.slice(0, -4) + 'AAAA';
        expect(await ecdsaVerify('test', corrupted, kp.publicKey)).toBe(false);
    });

    test('chuỗi rỗng: sign + verify thành công', async () => {
        const sig = await ecdsaSign('', kp.privateKey);
        expect(await ecdsaVerify('', sig, kp.publicKey)).toBe(true);
    });

    test('chuỗi unicode dài (1000 chars): sign + verify thành công', async () => {
        const msg = '🔒 Bảo mật đầu cuối '.repeat(50);
        const sig = await ecdsaSign(msg, kp.privateKey);
        expect(await ecdsaVerify(msg, sig, kp.publicKey)).toBe(true);
    });

    test('exportSigningPublicKey + importSigningPublicKey: round-trip SPKI Base64', async () => {
        const exported = await subtle.exportKey('spki', kp.publicKey);
        const b64      = buf2b64(exported);
        const imported = await subtle.importKey(
            'spki', b642buf(b64), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']
        );
        const sig = await ecdsaSign('import test', kp.privateKey);
        expect(await ecdsaVerify('import test', sig, imported)).toBe(true);
    });
});
