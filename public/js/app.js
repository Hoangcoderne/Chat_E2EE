// public/js/app.js
import {
    importPublicKey, deriveSharedSecret, encryptMessage, decryptMessage,
    signMessage, verifySignature, importSigningPublicKey
} from './crypto/key-manager.js';

// ============================================================
// 1. CONFIG & STATE MANAGEMENT
// ============================================================
const socket = io();

let friendRequests = [];
let notifications = [];
let myIdentity = {
    userId: null,
    username: null,
    privateKey: null,
    signingPrivateKey: null
};
let currentChat = {
    partnerId: null,
    partnerPublicKey: null,
    partnerSigningPublicKey: null,
    sharedSecret: null
};

// DOM Elements
const dom = {
    status: document.getElementById('status-bar'),
    myUsername: document.getElementById('my-username'),
    searchInput: document.getElementById('search-input'),
    btnConnect: document.getElementById('btn-connect'),
    chatHeader: document.getElementById('chat-header'),
    partnerName: document.getElementById('partner-name'),
    messagesList: document.getElementById('messages-list'),
    msgInput: document.getElementById('msg-input'),
    btnSend: document.getElementById('btn-send'),
    btnLogout: document.getElementById('btn-logout'),
    contactsList: document.getElementById('contacts-list'),
    partnerStatus: document.getElementById('partner-status'),
    btnRequests: document.getElementById('btn-requests'),
    reqPopup: document.getElementById('requests-popup'),
    reqList: document.getElementById('requests-list'),
    reqCount: document.getElementById('req-count'),
    chatInputArea: document.getElementById('chat-input-area'),
    blockOverlay: document.getElementById('block-overlay'),
    blockTitle: document.getElementById('block-title'),
    btnUnblock: document.getElementById('btn-unblock')
};

socket.on('connect', () => {
    const userId = sessionStorage.getItem('userId');
    if (userId) {
        socket.emit('join_user', userId);
        console.log("Đã phục hồi định danh Socket sau khi reconnect.");
    }
});

// ============================================================
// 2. HELPER FUNCTIONS (AUTH & DB)
// ============================================================

// authFetch tự động refresh access token khi hết hạn
async function authFetch(url, options = {}, _isRetry = false) {
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
                const retryOptions = { ...options };
                retryOptions.headers = { ...options.headers };
                retryOptions.headers['Authorization'] = `Bearer ${localStorage.getItem('accessToken')}`;
                return fetch(url, retryOptions);
            }
        }

        alert("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
        logout();
        return null;
    }
    return res;
}

async function tryRefreshToken() {
    try {
        const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
            // Cookie tự động được gửi kèm bởi browser
        });

        if (!res.ok) return false;

        const data = await res.json();
        localStorage.setItem('accessToken', data.accessToken);
        return true;

    } catch (err) {
        console.error("Refresh failed:", err);
        return false;
    }
}

function loadKeyFromDB(id = 'my-private-key') {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("SecureChatDB", 1);
        request.onsuccess = (event) => {
            const db = event.target.result;
            const tx = db.transaction("keys", "readonly");
            const store = tx.objectStore("keys");
            const query = store.get(id);
            query.onsuccess = () => resolve(query.result ? query.result.key : null);
            query.onerror = () => reject("Lỗi đọc DB");
        };
        request.onerror = () => reject("Không mở được DB");
    });
}

async function logout() {
    try {
        // Server đọc từ HttpOnly cookie và tự xóa cookie đó
        fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
    } finally {
        try {
            const req = indexedDB.open("SecureChatDB", 1);
            req.onsuccess = (e) => {
                const tx = e.target.result.transaction("keys", "readwrite");
                tx.objectStore("keys").delete("my-private-key");
                tx.objectStore("keys").delete("my-signing-key");
            };
        } catch (e) {}

        sessionStorage.clear();
        localStorage.removeItem('accessToken');
        // [FIX #5] Không còn refreshToken trong localStorage để xóa
        window.location.href = '/login.html';
    }
}

// ============================================================
// 3. INITIALIZATION
// ============================================================

async function initApp() {
    const token = localStorage.getItem('accessToken');
    const userId = sessionStorage.getItem('userId');
    const username = sessionStorage.getItem('username');

    if (!token || !userId || !username) {
        window.location.href = '/login.html';
        return;
    }

    try {
        const privateKey = await loadKeyFromDB('my-private-key');
        if (!privateKey) throw new Error("Không tìm thấy Private Key");

        const signingPrivateKey = await loadKeyFromDB('my-signing-key');
        if (!signingPrivateKey) throw new Error("Không tìm thấy Signing Key");

        myIdentity = { userId, username, privateKey, signingPrivateKey };
        dom.myUsername.innerText = username;

        socket.emit('join_user', userId);
        dom.status.innerText = "🟢 Online";
        dom.status.style.color = "green";

        await loadContacts();
        await loadFriendRequests();
        await loadNotifications();

        console.log("App Initialized. Ready to E2EE.");

    } catch (err) {
        console.error(err);
        alert("Lỗi khởi tạo: " + err.message);
        logout();
    }
}

// ============================================================
// 4. SOCKET EVENT LISTENERS (REAL-TIME)
// ============================================================

// A. Handshake: Nhận Public Key -> Tạo Shared Secret
socket.on('response_public_key', async (data) => {
    try {
        const { userId, publicKey, username, signingPublicKey } = data;
        console.log("Handshake: Received key from", username);

        const partnerKeyObj = await importPublicKey(publicKey);
        const sharedKey = await deriveSharedSecret(myIdentity.privateKey, partnerKeyObj);

        const partnerSigningKey = signingPublicKey
            ? await importSigningPublicKey(signingPublicKey)
            : null;

        currentChat = {
            partnerId: userId,
            partnerPublicKey: partnerKeyObj,
            partnerSigningPublicKey: partnerSigningKey,
            sharedSecret: sharedKey
        };

        updateHeaderStatus(userId);
        dom.chatHeader.classList.remove('hidden');
        dom.partnerName.innerText = username || dom.searchInput.value;
        dom.msgInput.disabled = false;
        dom.btnSend.disabled = false;
        dom.messagesList.innerHTML = `<div class="system-msg">🔒 Đã thiết lập kênh E2EE.</div>`;

        document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
        const item = document.querySelector(`.contact-item[data-id="${userId}"]`);
        if (item) item.classList.add('active');

        await loadChatHistory();

    } catch (err) {
        console.error("Lỗi Handshake:", err);
        alert("Lỗi thiết lập mã hóa.");
    }
});

// B. Nhận tin nhắn
socket.on('receive_message', async (payload) => {
    if (payload.senderId !== currentChat.partnerId) return;

    try {
        const decryptedText = await decryptMessage(
            { ciphertext: payload.encryptedContent, iv: payload.iv },
            currentChat.sharedSecret
        );

        let signatureValid = null;
        if (payload.signature && currentChat.partnerSigningPublicKey) {
            signatureValid = await verifySignature(
                decryptedText,
                payload.signature,
                currentChat.partnerSigningPublicKey
            );
        }

        appendMessage(decryptedText, 'received', signatureValid);
    } catch (err) {
        console.error("Decryption failed:", err);
        appendMessage("[Lỗi giải mã]", 'received', false);
    }
});

// C. Trạng thái Online/Offline
socket.on('user_status_change', (data) => {
    const dot = document.getElementById(`status-${data.userId}`);
    if (dot) {
        data.status === 'online' ? dot.classList.add('online') : dot.classList.remove('online');
    }
    updateHeaderStatus(data.userId);
});

// D. Nhận Lời mời kết bạn
socket.on('receive_friend_request', (data) => {
    friendRequests.push(data);
    updateRequestUI();
});

// E. Được chấp nhận kết bạn
socket.on('request_accepted', (data) => {
    console.log(`${data.accepterName} đã chấp nhận!`);
    if (data.notification) {
        data.notification._id = 'temp_' + Date.now();
        notifications.unshift(data.notification);
        updateRequestUI();
    }
    renderContactItem({
        _id: data.accepterId,
        username: data.accepterName,
        online: true
    });
    startHandshake(data.accepterName);
});

// F. Tín hiệu bắt đầu Handshake
socket.on('start_handshake_init', (data) => {
    console.log("Start Handshake Init...");
    renderContactItem({ _id: data.targetId, username: data.targetUsername, online: true });

    const item = document.querySelector(`.contact-item[data-id="${data.targetId}"]`);
    if (item) {
        item.click();
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
});

// G. Người khác chặn mình
socket.on('you_have_been_blocked', ({ blockerId }) => {
    const li = document.querySelector(`.contact-item[data-id="${blockerId}"]`);
    if (li) {
        li.dataset.status = 'blocked';
        li.dataset.isBlocker = 'false';
        if (currentChat.partnerId === blockerId) li.click();
    }
});

// H. Người khác bỏ chặn mình
socket.on('you_have_been_unblocked', ({ unblockerId }) => {
    const li = document.querySelector(`.contact-item[data-id="${unblockerId}"]`);
    if (li) {
        li.dataset.status = 'accepted';
        li.dataset.isBlocker = 'false';
        if (currentChat.partnerId === unblockerId) li.click();
    }
});

// [FIX #1] Thêm handler cho system_message — trước đây server emit nhưng client không bắt
socket.on('system_message', ({ text }) => {
    appendMessage(text, 'system');
});

// [FIX #1] Thêm handler cho request_sent_success
socket.on('request_sent_success', (msg) => {
    appendMessage(msg, 'system');
});

socket.on('error', (msg) => alert(msg));

// ============================================================
// 5. API CALLS (DATA LOADING)
// ============================================================

async function loadContacts() {
    try {
        const res = await authFetch(`/api/chat/contacts`);
        if (!res) return;

        const contacts = await res.json();
        dom.contactsList.innerHTML = '';
        contacts.forEach(user => renderContactItem(user));
    } catch (err) {
        console.error("Lỗi tải contacts:", err);
    }
}

async function loadChatHistory() {
    const { userId } = myIdentity;
    const { partnerId, sharedSecret } = currentChat;
    if (!userId || !partnerId) return;

    try {
        const res = await authFetch(`/api/chat/history/${partnerId}`);
        if (!res) return;

        const messages = await res.json();
        dom.messagesList.innerHTML = '';

        if (messages.length === 0) {
            dom.messagesList.innerHTML = '<div class="system-msg">Chưa có tin nhắn nào.</div>';
            return;
        }

        for (const msg of messages) {
            try {
                const decryptedText = await decryptMessage(
                    { ciphertext: msg.encryptedContent, iv: msg.iv },
                    sharedSecret
                );
                // [FIX] .toString() để tránh lỗi so sánh ObjectId với string
                const type = (msg.sender.toString() === userId) ? 'sent' : 'received';

                let signatureValid = null;
                if (msg.signature && type === 'received' && currentChat.partnerSigningPublicKey) {
                    signatureValid = await verifySignature(
                        decryptedText,
                        msg.signature,
                        currentChat.partnerSigningPublicKey
                    );
                }

                appendMessage(decryptedText, type, signatureValid);
            } catch (err) {
                appendMessage("[Tin nhắn lỗi]", 'received', false);
            }
        }
        dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
    } catch (err) {
        console.error("Lỗi tải history:", err);
    }
}

async function loadFriendRequests() {
    try {
        const res = await authFetch(`/api/chat/requests`);
        if (!res) return;

        const data = await res.json();
        if (Array.isArray(data)) {
            friendRequests = data;
            updateRequestUI();
        }
    } catch (err) { console.error(err); }
}

async function loadNotifications() {
    try {
        const res = await authFetch(`/api/chat/notifications`);
        if (!res) return;

        notifications = await res.json();
        updateRequestUI();
    } catch (err) { console.error(err); }
}

// ============================================================
// 6. UI RENDERING & INTERACTIONS
// ============================================================

function renderContactItem(user) {
    if (document.querySelector(`.contact-item[data-id="${user._id}"]`)) return;

    const li = document.createElement('li');
    li.className = 'contact-item';
    li.dataset.id = user._id;
    li.dataset.username = user.username;
    li.dataset.status = user.status || 'accepted';
    li.dataset.isBlocker = user.isBlocker || false;

    const onlineClass = user.online ? 'online' : '';

    li.innerHTML = `
        <div class="avatar-container">
            <div class="avatar">${user.username[0].toUpperCase()}</div>
            <div class="status-dot ${onlineClass}" id="status-${user._id}"></div>
        </div>
        <div class="contact-info">
            <div class="contact-name">${user.username}</div>
            <div class="last-message">Nhấn để chat</div>
        </div>
        <button class="contact-options-btn" onclick="toggleMenu(event, '${user._id}')">⋮</button>
        <div id="menu-${user._id}" class="options-menu hidden">
            <button class="danger" onclick="handleBlock(event, '${user._id}')">🚫 Chặn</button>
            <button class="danger" onclick="handleUnfriend(event, '${user._id}')">❌ Hủy kết bạn</button>
        </div>
    `;

    li.addEventListener('click', (e) => {
        if (e.target.closest('.contact-options-btn') || e.target.closest('.options-menu')) return;

        document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
        li.classList.add('active');

        dom.searchInput.value = user.username;

        const status = li.dataset.status;
        const isBlocker = li.dataset.isBlocker === 'true';

        if (status === 'blocked') {
            dom.chatInputArea.classList.add('hidden');
            dom.blockOverlay.classList.remove('hidden');
            dom.chatHeader.classList.remove('hidden');
            dom.partnerName.innerText = user.username;
            dom.messagesList.innerHTML = `<div class="system-msg">Không thể lấy khóa E2EE do cuộc trò chuyện đã bị chặn.</div>`;

            if (isBlocker) {
                dom.blockTitle.innerText = `Bạn đã chặn tin nhắn từ ${user.username}`;
                dom.btnUnblock.classList.remove('hidden');
                dom.btnUnblock.onclick = () => handleUnblock(user._id);
            } else {
                dom.blockTitle.innerText = `Bạn không thể trả lời cuộc trò chuyện này`;
                dom.btnUnblock.classList.add('hidden');
            }
        } else {
            dom.chatInputArea.classList.remove('hidden');
            dom.blockOverlay.classList.add('hidden');
            startHandshake(user.username);
        }
    });

    dom.contactsList.appendChild(li);
}

function updateRequestUI() {
    if (!friendRequests) friendRequests = [];
    if (!notifications) notifications = [];
    const totalCount = friendRequests.length + notifications.length;

    if (totalCount > 0) {
        dom.reqCount.innerText = totalCount;
        dom.reqCount.classList.remove('hidden');
    } else {
        dom.reqCount.classList.add('hidden');
        dom.reqList.innerHTML = '<li class="empty-msg">Không có thông báo mới</li>';
        return;
    }

    dom.reqList.innerHTML = '';

    friendRequests.forEach(req => {
        const li = document.createElement('li');
        li.className = 'req-item';
        li.innerHTML = `
            <div style="flex:1">👋 <b>${req.fromUser}</b> mời kết bạn</div>
            <button class="btn-accept small-btn" style="background:#28a745; margin-left:5px">✔</button>
        `;
        li.querySelector('.btn-accept').addEventListener('click', () => {
            socket.emit('accept_friend_request', { requesterId: req.fromId });
            friendRequests = friendRequests.filter(r => r.fromId !== req.fromId);
            updateRequestUI();
        });
        dom.reqList.appendChild(li);
    });

    notifications.forEach(notif => {
        const li = document.createElement('li');
        li.className = 'notif-item';
        li.style.borderLeft = "3px solid #0084ff";
        li.style.backgroundColor = "#f0f8ff";
        li.innerHTML = `
            <div style="flex:1; font-size:0.9em">${notif.content}</div>
            <button class="btn-clear small-btn" style="background:#999; margin-left:5px">✕</button>
        `;
        li.querySelector('.btn-clear').addEventListener('click', () => {
            if (notif._id) socket.emit('clear_notification', { notifId: notif._id });
            notifications = notifications.filter(n => n._id !== notif._id);
            updateRequestUI();
        });
        dom.reqList.appendChild(li);
    });
}

function appendMessage(text, type, signatureValid = null) {
    const div = document.createElement('div');

    if (signatureValid === false) {
        div.classList.add('message', 'msg-received');
        div.style.cssText = `
            background: #fff0f0;
            border: 1.5px solid #ffb3b3;
            color: #cc0000;
            padding: 10px 14px;
        `;
        div.innerHTML = `
            <div style="font-weight:600; font-size:0.95em">
                ⚠️ Cảnh báo: Chữ ký không hợp lệ
            </div>
            <div style="font-size:0.82em; margin-top:5px; color:#aa0000; line-height:1.4">
                Tin nhắn này có thể đã bị chỉnh sửa hoặc giả mạo.<br>
                Nội dung bị ẩn để bảo vệ bạn.
            </div>
        `;
    } else {
        div.classList.add('message', type === 'sent' ? 'msg-sent' :
                          type === 'system' ? 'system-msg' : 'msg-received');
        div.innerText = text;
    }

    dom.messagesList.appendChild(div);
    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
}

function updateHeaderStatus(userId) {
    if (currentChat.partnerId !== userId) return;
    const sidebarDot = document.getElementById(`status-${userId}`);
    if (sidebarDot && sidebarDot.classList.contains('online')) {
        dom.partnerStatus.innerText = "Online";
        dom.partnerStatus.classList.add('online');
    } else {
        dom.partnerStatus.innerText = "Offline";
        dom.partnerStatus.classList.remove('online');
    }
}

// ============================================================
// 7. USER ACTIONS & EVENT HANDLERS
// ============================================================

function startHandshake(targetUsername) {
    if (!targetUsername) return;
    if (targetUsername === myIdentity.username) return alert("Không thể chat với mình");
    socket.emit('request_public_key', { username: targetUsername });
}

async function sendMessage() {
    const text = dom.msgInput.value.trim();
    if (!text || !currentChat.sharedSecret) return;

    try {
        const signature = await signMessage(text, myIdentity.signingPrivateKey);
        const encryptedData = await encryptMessage(text, currentChat.sharedSecret);

        socket.emit('send_message', {
            recipientId: currentChat.partnerId,
            encryptedContent: encryptedData.ciphertext,
            iv: encryptedData.iv,
            signature
        });

        appendMessage(text, 'sent', null);
        dom.msgInput.value = '';
    } catch (err) {
        console.error("Lỗi gửi tin:", err);
        alert("Không thể mã hóa tin nhắn.");
    }
}

// --- GLOBAL HANDLERS ---

window.toggleMenu = function(e, id) {
    e.stopPropagation();
    document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));
    const menu = document.getElementById(`menu-${id}`);
    if (menu) menu.classList.toggle('hidden');
}

window.handleUnfriend = async function(e, targetId) {
    e.stopPropagation();
    if (!confirm("Bạn chắc chắn muốn hủy kết bạn?")) return;

    try {
        const res = await authFetch('/api/chat/unfriend', {
            method: 'POST',
            body: JSON.stringify({ targetId })
        });
        if (!res) return;

        const data = await res.json();
        if (data.success) {
            document.querySelector(`.contact-item[data-id="${targetId}"]`).remove();
            if (currentChat.partnerId === targetId) {
                dom.chatHeader.classList.add('hidden');
                dom.messagesList.innerHTML = '';
            }
        }
    } catch (err) { console.error(err); }
}

window.handleBlock = async function(e, targetId) {
    e.stopPropagation();
    if (!confirm("Bạn chắc chắn muốn chặn người này?")) return;

    try {
        const res = await authFetch('/api/chat/block', {
            method: 'POST',
            body: JSON.stringify({ targetId })
        });
        if (!res) return;

        const data = await res.json();
        if (data.success) {
            socket.emit('notify_block', { targetId });

            const li = document.querySelector(`.contact-item[data-id="${targetId}"]`);
            if (li) {
                li.dataset.status = 'blocked';
                li.dataset.isBlocker = 'true';
                document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));
                li.click();
            }
        }
    } catch (err) { console.error(err); }
}

window.handleUnblock = async function(targetId) {
    try {
        const res = await authFetch('/api/chat/unblock', {
            method: 'POST',
            body: JSON.stringify({ targetId })
        });
        if (!res) return;

        const data = await res.json();
        if (data.success) {
            socket.emit('notify_unblock', { targetId });

            const li = document.querySelector(`.contact-item[data-id="${targetId}"]`);
            if (li) {
                li.dataset.status = 'accepted';
                li.dataset.isBlocker = 'false';
                li.click();
            }
        }
    } catch (err) { console.error(err); }
};

// --- DOM EVENT LISTENERS ---

dom.btnLogout.addEventListener('click', logout);

dom.btnSend.addEventListener('click', sendMessage);
dom.msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

document.addEventListener('click', (e) => {
    if (e.target.closest('.contact-options-btn') || e.target.closest('.options-menu')) {
        return;
    }
    
    document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));
    if (!dom.reqPopup.contains(e.target) && e.target !== dom.btnRequests) {
        dom.reqPopup.classList.add('hidden');
    }
});

dom.btnRequests.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.reqPopup.classList.toggle('hidden');
});

dom.btnConnect.addEventListener('click', () => {
    const targetUsername = dom.searchInput.value.trim();
    if (!targetUsername) return;

    const existingContact = document.querySelector(`.contact-item[data-username="${targetUsername}"]`);
    if (existingContact) {
        startHandshake(targetUsername);
    } else {
        socket.emit('send_friend_request', { targetUsername });
    }
});

// CHẠY INIT
initApp();