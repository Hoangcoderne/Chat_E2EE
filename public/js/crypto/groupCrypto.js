// public/js/crypto/groupCrypto.js
// Các thao tác mật mã đặc thù cho group chat:
//   mã hoá / giải mã group key qua ECDH, cache group keys.

import { state }     from '../state.js';
import { authFetch } from '../utils.js';
import {
    importPublicKey, deriveSharedSecret,
    arrayBufferToBase64, base64ToArrayBuffer,
} from './key-manager.js';

/**
 * Mã hoá group key (AES-GCM) cho một member bằng ECDH shared secret.
 * Admin gọi hàm này khi tạo nhóm hoặc thêm member mới.
 *
 * @param {CryptoKey}  groupKey              - AES-GCM group key (extractable: true)
 * @param {string}     memberPublicKeyBase64 - ECDH public key của member (SPKI Base64)
 * @returns {{ encryptedGroupKey: string, keyIv: string }}
 */
export async function encryptGroupKeyForMember(groupKey, memberPublicKeyBase64) {
    const memberPubKey = await importPublicKey(memberPublicKeyBase64);
    const sharedSecret = await deriveSharedSecret(state.myIdentity.privateKey, memberPubKey);
    const rawKey       = await window.crypto.subtle.exportKey('raw', groupKey);
    const iv           = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted    = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedSecret, rawKey);

    return {
        encryptedGroupKey: arrayBufferToBase64(encrypted),
        keyIv:             arrayBufferToBase64(iv),
    };
}

/**
 * Giải mã group key nhận từ server.
 * Dùng ECDH(myPrivateKey, keyHolderPublicKey) để lấy shared secret rồi AES-GCM decrypt.
 *
 * extractable: true — cần thiết để admin có thể re-export khi thêm member mới.
 *
 * @param {string} encryptedGroupKeyB64
 * @param {string} keyIvB64
 * @param {string} keyHolderPublicKeyB64
 * @returns {CryptoKey} AES-GCM group key
 */
export async function decryptGroupKey(encryptedGroupKeyB64, keyIvB64, keyHolderPublicKeyB64) {
    const keyHolderPub = await importPublicKey(keyHolderPublicKeyB64);
    const sharedSecret = await deriveSharedSecret(state.myIdentity.privateKey, keyHolderPub);
    const iv           = base64ToArrayBuffer(keyIvB64);
    const data         = base64ToArrayBuffer(encryptedGroupKeyB64);
    const rawKey       = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedSecret, data);

    return window.crypto.subtle.importKey(
        'raw', rawKey, { name: 'AES-GCM' },
        true,               // extractable — cần để re-encrypt cho member mới
        ['encrypt', 'decrypt']
    );
}

/**
 * Lấy group key từ cache hoặc fetch + decrypt từ server.
 * Kết quả được cache vào state.groupKeys để tránh decrypt lại.
 *
 * @param {string} groupId
 * @returns {CryptoKey|null}
 */
export async function getGroupKey(groupId) {
    if (state.groupKeys.has(groupId)) return state.groupKeys.get(groupId);

    const res  = await authFetch(`/api/groups/${groupId}/my-key`);
    if (!res) return null;
    const data = await res.json();
    if (!data.encryptedGroupKey) return null;

    const key = await decryptGroupKey(data.encryptedGroupKey, data.keyIv, data.keyHolderPublicKey);
    state.groupKeys.set(groupId, key);
    return key;
}
