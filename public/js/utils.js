// public/js/utils.js
// Tiện ích dùng chung: authFetch, IndexedDB, format time, logout.

import { state } from './state.js';
import { decryptMessage } from './crypto/key-manager.js';

// authFetch: tự động refresh token khi hết hạn
export async function authFetch(url, options = {}, _isRetry = false) {
    const token = localStorage.getItem('accessToken');

    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${token}`;
    if (!options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, options);

    if (res.status === 401) {
        const data = await res.json().catch(() => ({}));

        if (data.code === 'TOKEN_EXPIRED' && !_isRetry) {
            const refreshed = await tryRefreshToken();
            if (refreshed) {
                const retryOptions = { ...options, headers: { ...options.headers } };
                retryOptions.headers['Authorization'] = `Bearer ${localStorage.getItem('accessToken')}`;
                return fetch(url, retryOptions);
            }
        }

        alert('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
        await logout();
        return null;
    }
    return res;
}

// tryRefreshToken: gọi /api/auth/refresh (cookie tự động gửi kèm)
export async function tryRefreshToken() {
    try {
        const res = await fetch('/api/auth/refresh', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return false;
        const data = await res.json();
        localStorage.setItem('accessToken', data.accessToken);
        return true;
    } catch (err) {
        console.error('Refresh failed:', err);
        return false;
    }
}

// logout: xóa key + session → về login
export async function logout() {
    try {
        fetch('/api/auth/logout', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
    } finally {
        try {
            const req = indexedDB.open('SecureChatDB', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('keys'))
                    db.createObjectStore('keys', { keyPath: 'id' });
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('keys')) return;
                const tx = db.transaction('keys', 'readwrite');
                tx.objectStore('keys').delete('my-private-key');
                tx.objectStore('keys').delete('my-signing-key');
            };
        } catch (_) {}

        sessionStorage.clear();
        localStorage.removeItem('accessToken');
        window.location.href = '/login.html';
    }
}

// loadKeyFromDB: đọc CryptoKey từ IndexedDB
export function loadKeyFromDB(id = 'my-private-key') {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('SecureChatDB', 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('keys'))
                db.createObjectStore('keys', { keyPath: 'id' });
        };
        request.onsuccess = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('keys')) { resolve(null); return; }
            const query = db.transaction('keys', 'readonly').objectStore('keys').get(id);
            query.onsuccess = () => resolve(query.result ? query.result.key : null);
            query.onerror   = () => reject('Lỗi đọc DB');
        };
        request.onerror = () => reject('Không mở được DB');
    });
}

// formatTime: hiển thị thời gian theo ngữ cảnh
export function formatTime(date) {
    const d         = new Date(date);
    const now       = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    if (d.toDateString() === now.toDateString())       return timeStr;
    if (d.toDateString() === yesterday.toDateString()) return `Hôm qua ${timeStr}`;
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + timeStr;
}

// decryptReplyTo: giải mã replyTo object
export async function decryptReplyTo(replyTo, key) {
    if (!replyTo?.encryptedContent || !key) return null;
    try {
        const plaintext = await decryptMessage(
            { ciphertext: replyTo.encryptedContent, iv: replyTo.iv },
            key
        );
        return { messageId: replyTo.messageId, senderName: replyTo.senderName, plaintext };
    } catch (_) {
        return null;
    }
}
