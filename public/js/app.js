// public/js/app.js
import {
    importPublicKey, deriveSharedSecret, encryptMessage, decryptMessage,
    signMessage, verifySignature, importSigningPublicKey,
    arrayBufferToBase64, base64ToArrayBuffer
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

// [MỚI] Theo dõi số tin chưa đọc theo từng contactId
let unreadCounts = {};

// [MỚI] Tin nhắn đang chờ forward sau khi handshake xong
let pendingForward = null;

// ── Group chat state ──
let currentGroupId = null;   // groupId đang mở
// groupKeys: Map<groupId, CryptoKey>  — cache group keys đã giải mã
const groupKeys = new Map();

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
    blockOverlay:        document.getElementById('block-overlay'),
    blockTitle:          document.getElementById('block-title'),
    btnUnblock:          document.getElementById('btn-unblock'),
    // Group elements
    tabFriends:          document.getElementById('tab-friends'),
    tabGroups:           document.getElementById('tab-groups'),
    panelFriends:        document.getElementById('panel-friends'),
    panelGroups:         document.getElementById('panel-groups'),
    groupsList:          document.getElementById('groups-list'),
    btnCreateGroup:      document.getElementById('btn-create-group'),
    btnManageGroup:      document.getElementById('btn-manage-group'),
    modalCreateGroup:    document.getElementById('modal-create-group'),
    modalManageGroup:    document.getElementById('modal-manage-group')
};

socket.on('connect', () => {
    const userId = sessionStorage.getItem('userId');
    if (userId) {
        socket.emit('join_user', userId);
        // Rejoin group rooms sau reconnect
        const cachedGroupIds = JSON.parse(sessionStorage.getItem('myGroupIds') || '[]');
        if (cachedGroupIds.length > 0) socket.emit('join_groups', cachedGroupIds);
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

// [FIX #5] Refresh token nằm trong HttpOnly Cookie — browser tự gửi kèm
// Không cần đọc/gửi refreshToken từ localStorage nữa
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

// [MỚI] Format timestamp hiển thị trên tin nhắn
function formatTime(date) {
    const d = new Date(date);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    if (isToday) return timeStr;
    if (isYesterday) return `Hôm qua ${timeStr}`;
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + timeStr;
}

// [MỚI] Cập nhật badge số tin chưa đọc trên sidebar
function setUnreadBadge(userId, count) {
    unreadCounts[userId] = count;
    const badge = document.getElementById(`unread-${userId}`);
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function incrementUnreadBadge(userId) {
    setUnreadBadge(userId, (unreadCounts[userId] || 0) + 1);
}

function resetUnreadBadge(userId) {
    setUnreadBadge(userId, 0);
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
        // [FIX #5] Không cần gửi refreshToken trong body
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

        console.log("✅ App Initialized. Ready to E2EE.");

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
        console.log("🔑 Handshake: Received key from", username);

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

        // [FIX BUG 2] Ẩn nút manage group và clear groupId khi chuyển sang DM
        currentGroupId = null;
        dom.btnManageGroup?.classList.add('hidden');
        dom.msgInput.placeholder = 'Nhập tin nhắn';

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

        // [MỚI] Reset badge ngay khi mở chat
        resetUnreadBadge(userId);

        // Nếu có tin đang chờ forward → gửi ngay sau khi handshake
        if (pendingForward && pendingForward.targetId === userId) {
            const { text } = pendingForward;
            pendingForward = null;
            const sig  = await signMessage(text, myIdentity.signingPrivateKey);
            const enc  = await encryptMessage(text, currentChat.sharedSecret);
            socket.emit('send_message', {
                recipientId: userId, encryptedContent: enc.ciphertext, iv: enc.iv, signature: sig
            });
            appendMessage(text, 'sent', null, new Date(), null, true);
        }

    } catch (err) {
        console.error("Lỗi Handshake:", err);
        alert("Lỗi thiết lập mã hóa.");
    }
});

// B. Nhận tin nhắn
socket.on('receive_message', async (payload) => {
    // [MỚI] Cập nhật preview sidebar dù chat có đang mở hay không
    updateContactPreview(payload.senderId);

    // Nếu đang chat với người này → hiện tin + mark read ngay
    if (payload.senderId === currentChat.partnerId) {
        try {
            const decryptedText = await decryptMessage(
                { ciphertext: payload.encryptedContent, iv: payload.iv },
                currentChat.sharedSecret
            );
            let signatureValid = null;
            if (payload.signature && currentChat.partnerSigningPublicKey) {
                signatureValid = await verifySignature(
                    decryptedText, payload.signature, currentChat.partnerSigningPublicKey
                );
            }
            appendMessage(decryptedText, 'received', signatureValid, payload.timestamp, payload.messageId);
            // Đang xem chat → đánh dấu đã đọc ngay
            socket.emit('mark_read', { partnerId: payload.senderId });
        } catch (err) {
            console.error("Decryption failed:", err);
            appendMessage("⚠️ [Lỗi giải mã]", 'received', false);
        }
    } else {
        // [MỚI] Chat khác đang mở → tăng badge
        incrementUnreadBadge(payload.senderId);
    }
});

// [MỚI] B2. Đồng bộ tin nhắn đã gửi sang thiết bị khác (cùng tài khoản)
socket.on('message_sent_sync', async (payload) => {
    const { senderSocketId, messageId, recipientId, encryptedContent, iv, signature, timestamp } = payload;

    // Nếu đây chính là socket đã gửi → chỉ cập nhật msgId cho temp message
    if (senderSocketId === socket.id) {
        const tempEl = dom.messagesList.querySelector('[data-temp="true"]');
        if (tempEl) {
            tempEl.removeAttribute('data-temp');
            tempEl.dataset.msgId = messageId;
        }
        return;
    }

    // Thiết bị khác của cùng tài khoản → giải mã và hiển thị nếu đang mở chat đó
    updateContactPreview(recipientId);

    if (currentChat.partnerId === recipientId && currentChat.sharedSecret) {
        try {
            const text = await decryptMessage({ ciphertext: encryptedContent, iv }, currentChat.sharedSecret);
            appendMessage(text, 'sent', null, timestamp, messageId);
        } catch (e) {
            appendMessage('[Tin nhắn từ thiết bị khác]', 'system');
        }
    }
});

// B3. Nhận thông báo tin đã được đọc (DM only)
socket.on('messages_read', ({ by }) => {
    // [FIX BUG 5] Chỉ xử lý khi đang ở DM chat, không phải group
    if (!currentChat.partnerId || currentChat.partnerId !== by) return;
    if (currentGroupId) return; // đang xem group → bỏ qua
    document.querySelectorAll('.msg-wrapper .msg-status').forEach(el => {
        el.textContent = '✓✓';
        el.classList.add('read');
    });
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

// [FIX #1] Handler system_message
socket.on('system_message', ({ text }) => {
    appendMessage(text, 'system');
});

// [MỚI] Tin nhắn bị xoá
socket.on('message_deleted', ({ messageId }) => {
    const el = document.querySelector(`.msg-wrapper[data-msg-id="${messageId}"]`);
    if (el) el.remove();
});

// [MỚI] Reaction được cập nhật
socket.on('reaction_updated', ({ messageId, reactions }) => {
    const wrapper = document.querySelector(`.msg-wrapper[data-msg-id="${messageId}"]`);
    if (!wrapper) return;
    const bar = wrapper.querySelector('.reaction-bar');
    if (bar) renderReactions(bar, reactions);
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

                appendMessage(decryptedText, type, signatureValid, msg.timestamp, msg._id, false, msg.reactions || []);

                // Nếu là tin mình gửi và đã được đọc → hiện ✓✓ ngay
                if (type === 'sent' && msg.read) {
                    const lastWrapper = dom.messagesList.lastElementChild;
                    const statusEl = lastWrapper?.querySelector('.msg-status');
                    if (statusEl) {
                        statusEl.textContent = '✓✓';
                        statusEl.classList.add('read');
                    }
                }
            } catch (err) {
                appendMessage("[Tin nhắn lỗi]", 'received', false, msg.timestamp);
            }
        }
        dom.messagesList.scrollTop = dom.messagesList.scrollHeight;

        // [MỚI] Đánh dấu đã đọc + reset badge sau khi load history
        socket.emit('mark_read', { partnerId });
        resetUnreadBadge(partnerId);
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

// [FIX #3] Vẽ contact item dùng đúng class CSS đã định nghĩa trong main.css
function renderContactItem(user) {
    if (document.querySelector(`.contact-item[data-id="${user._id}"]`)) return;

    const li = document.createElement('li');
    li.className = 'contact-item';
    li.dataset.id = user._id;
    li.dataset.username = user.username;
    li.dataset.status = user.status || 'accepted';
    li.dataset.isBlocker = user.isBlocker || false;

    const onlineClass = user.online ? 'online' : '';

    // ── Menu: tạo ngoài li, append vào body để tránh overflow clipping ──
    const menu = document.createElement('div');
    menu.id = `menu-${user._id}`;
    menu.className = 'options-menu hidden';

    // [FIX CSP] Không dùng onclick="..." inline — vi phạm Content Security Policy
    // Dùng createElement + addEventListener thay thế
    const btnBlock   = document.createElement('button');
    btnBlock.className = 'danger';
    btnBlock.textContent = '🚫 Chặn';
    btnBlock.addEventListener('click', (e) => handleBlock(e, user._id));

    const btnUnfriend = document.createElement('button');
    btnUnfriend.className = 'danger';
    btnUnfriend.textContent = '❌ Hủy kết bạn';
    btnUnfriend.addEventListener('click', (e) => handleUnfriend(e, user._id));

    menu.appendChild(btnBlock);
    menu.appendChild(btnUnfriend);
    document.body.appendChild(menu);

    // ── Nội dung li: không có inline event handler nào ──
    const avatar = document.createElement('div');
    avatar.className = 'avatar-container';
    avatar.innerHTML = `
        <div class="avatar">${user.username[0].toUpperCase()}</div>
        <div class="status-dot ${onlineClass}" id="status-${user._id}"></div>
    `;

    const info = document.createElement('div');
    info.className = 'contact-info';
    info.innerHTML = `
        <div class="contact-name">${user.username}</div>
        <div class="last-message" id="preview-${user._id}">Nhấn để chat</div>
    `;

    // [MỚI] Badge số tin chưa đọc
    const badge = document.createElement('span');
    badge.className = 'unread-badge hidden';
    badge.id = `unread-${user._id}`;
    if (user.unreadCount > 0) {
        badge.textContent = user.unreadCount > 99 ? '99+' : user.unreadCount;
        badge.classList.remove('hidden');
        unreadCounts[user._id] = user.unreadCount;
    }

    // [FIX CSP] Nút ⋮ dùng addEventListener thay vì onclick="..."
    const optionsBtn = document.createElement('button');
    optionsBtn.className = 'contact-options-btn';
    optionsBtn.textContent = '⋮';
    optionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleMenu(e, optionsBtn, user._id);
    });

    li.appendChild(avatar);
    li.appendChild(info);
    li.appendChild(badge);
    li.appendChild(optionsBtn);

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

// appendMessage với timestamp, read status, action buttons, reactions
// isTemp=true: tin vừa gửi, chờ sync từ server để gán msgId thật
function appendMessage(text, type, signatureValid = null, timestamp = null, msgId = null, isTemp = false, reactions = []) {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper ' + (type === 'sent' ? 'wrapper-sent' : type === 'system' ? 'wrapper-system' : 'wrapper-received');

    if (msgId)   wrapper.dataset.msgId = msgId;
    if (isTemp)  wrapper.dataset.temp  = 'true';
    // Lưu plaintext để forward
    if (text && type !== 'system') wrapper.dataset.plaintext = text;

    // ── Bubble ──
    const div = document.createElement('div');
    if (signatureValid === false) {
        div.classList.add('message', 'msg-received');
        div.style.cssText = 'background:#fff0f0;border:1.5px solid #ffb3b3;color:#cc0000;padding:10px 14px;';
        div.innerHTML = `
            <div style="font-weight:600;font-size:0.95em">⚠️ Cảnh báo: Chữ ký không hợp lệ</div>
            <div style="font-size:0.82em;margin-top:5px;color:#aa0000;line-height:1.4">
                Tin nhắn này có thể đã bị chỉnh sửa hoặc giả mạo.<br>Nội dung bị ẩn để bảo vệ bạn.
            </div>`;
    } else {
        div.classList.add('message', type === 'sent' ? 'msg-sent' : type === 'system' ? 'system-msg' : 'msg-received');
        div.innerText = text;
    }

    // ── Action buttons (hover) — chỉ cho tin thường, không phải system ──
    if (type !== 'system' && signatureValid !== false) {
        const actions = document.createElement('div');
        actions.className = 'msg-actions ' + (type === 'sent' ? 'actions-sent' : 'actions-received');

        // Nút cảm xúc
        const emojiBtn = document.createElement('button');
        emojiBtn.className = 'msg-action-btn';
        emojiBtn.title = 'Cảm xúc';
        emojiBtn.textContent = '😊';
        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showEmojiPicker(e, wrapper);
        });

        // Nút 3 chấm
        const moreBtn = document.createElement('button');
        moreBtn.className = 'msg-action-btn';
        moreBtn.title = 'Tùy chọn';
        moreBtn.textContent = '⋯';
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showMsgMenu(e, wrapper, type);
        });

        // Thứ tự: sent → [⋯ 😊] bên trái bubble | received → [😊 ⋯] bên phải
        if (type === 'sent') {
            actions.appendChild(moreBtn);
            actions.appendChild(emojiBtn);
        } else {
            actions.appendChild(emojiBtn);
            actions.appendChild(moreBtn);
        }

        // Wrap bubble + actions trong msg-row
        const row = document.createElement('div');
        row.className = 'msg-row ' + (type === 'sent' ? 'row-sent' : 'row-received');
        row.appendChild(actions);
        row.appendChild(div);
        wrapper.appendChild(row);
    } else {
        wrapper.appendChild(div);
    }

    // ── Reactions bar ──
    const reactionBar = document.createElement('div');
    reactionBar.className = 'reaction-bar ' + (type === 'sent' ? 'rbar-sent' : 'rbar-received');
    renderReactions(reactionBar, reactions);
    wrapper.appendChild(reactionBar);

    // ── Timestamp + read status ──
    if (type !== 'system') {
        const meta = document.createElement('div');
        meta.className = 'msg-meta ' + (type === 'sent' ? 'meta-sent' : 'meta-received');
        const timeEl = document.createElement('span');
        timeEl.className = 'msg-time';
        timeEl.textContent = formatTime(timestamp || new Date());
        meta.appendChild(timeEl);
        if (type === 'sent') {
            const statusEl = document.createElement('span');
            statusEl.className = 'msg-status';
            statusEl.textContent = '✓';
            meta.appendChild(statusEl);
        }
        wrapper.appendChild(meta);
    }

    dom.messagesList.appendChild(wrapper);
    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
    return wrapper;
}

// ── Render reactions vào một bar ──
function renderReactions(bar, reactions) {
    bar.innerHTML = '';
    if (!reactions || reactions.length === 0) return;

    // Group by emoji
    const groups = {};
    reactions.forEach(r => {
        if (!groups[r.emoji]) groups[r.emoji] = [];
        groups[r.emoji].push(r.userId);
    });

    Object.entries(groups).forEach(([emoji, users]) => {
        const pill = document.createElement('span');
        pill.className = 'reaction-pill';
        // Highlight nếu mình đã react emoji này
        if (users.some(uid => uid === myIdentity.userId || uid.toString() === myIdentity.userId)) {
            pill.classList.add('my-reaction');
        }
        pill.textContent = emoji + (users.length > 1 ? ' ' + users.length : '');
        pill.title = users.length + ' người';
        bar.appendChild(pill);
    });
}

// ── Emoji picker ──
const EMOJIS = ['👍','❤️','😂','😮','😢','😡'];
let activeEmojiPicker = null;

function showEmojiPicker(e, wrapper) {
    closeAllPopups();
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker.id = '_emoji_picker';

    EMOJIS.forEach(em => {
        const btn = document.createElement('button');
        btn.className = 'emoji-option';
        btn.textContent = em;
        btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            picker.remove();
            activeEmojiPicker = null;
            const msgId = wrapper.dataset.msgId;
            if (!msgId) return;
            await doToggleReaction(msgId, em, wrapper);
        });
        picker.appendChild(btn);
    });

    // Vị trí: dựa vào nút cảm xúc
    const btnRect = e.currentTarget.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top  = (btnRect.top - 52) + 'px';
    picker.style.left = (btnRect.left - 60) + 'px';
    document.body.appendChild(picker);
    activeEmojiPicker = picker;
}

// ── Message options menu (⋯) ──
let activeMsgMenu = null;

function showMsgMenu(e, wrapper, type) {
    closeAllPopups();
    const msgId    = wrapper.dataset.msgId;
    const isSender = (type === 'sent');

    const menu = document.createElement('div');
    menu.className = 'msg-options-menu';
    menu.id = '_msg_options_menu';

    // Chuyển tiếp (cả 2 phía)
    const fwdBtn = document.createElement('button');
    fwdBtn.textContent = '↪ Chuyển tiếp';
    fwdBtn.addEventListener('click', () => {
        menu.remove(); activeMsgMenu = null;
        showForwardModal(wrapper);
    });
    menu.appendChild(fwdBtn);

    // Gỡ tin nhắn (chỉ sender)
    if (isSender && msgId) {
        const delBtn = document.createElement('button');
        delBtn.className = 'danger';
        delBtn.textContent = '🗑 Gỡ tin nhắn';
        delBtn.addEventListener('click', async () => {
            menu.remove(); activeMsgMenu = null;
            if (!confirm('Xoá tin nhắn này? Hành động không thể hoàn tác.')) return;
            await doDeleteMessage(msgId, wrapper);
        });
        menu.appendChild(delBtn);
    }

    const btnRect = e.currentTarget.getBoundingClientRect();
    menu.style.position = 'fixed';
    const menuW = 160;
    let left = btnRect.right - menuW;
    if (left < 8) left = 8;
    let top = btnRect.bottom + 4;
    menu.style.top  = top  + 'px';
    menu.style.left = left + 'px';
    document.body.appendChild(menu);
    activeMsgMenu = menu;
}

function closeAllPopups() {
    document.getElementById('_emoji_picker')?.remove();
    document.getElementById('_msg_options_menu')?.remove();
    document.getElementById('_forward_modal')?.remove();
    activeEmojiPicker = null;
    activeMsgMenu     = null;
}

// ── Xoá tin nhắn ──
async function doDeleteMessage(msgId, wrapper) {
    try {
        const res = await authFetch('/api/chat/message/delete', {
            method: 'POST',
            body: JSON.stringify({ messageId: msgId })
        });
        if (!res) return;
        const data = await res.json();
        if (!data.success) return alert(data.message || 'Xoá thất bại');

        // Broadcast real-time cho recipient
        socket.emit('broadcast_delete_message', {
            messageId: msgId,
            recipientId: data.recipientId
        });
        // Xoá khỏi UI của chính mình
        wrapper.remove();
    } catch (err) {
        console.error('Delete error:', err);
    }
}

// ── Toggle reaction (DM + Group) ──
async function doToggleReaction(msgId, emoji, wrapper) {
    try {
        // [FIX BUG 5] Phân biệt group message và DM message
        const isGroupMsg = !!currentGroupId;
        const endpoint   = isGroupMsg
            ? `/api/groups/message/reaction`
            : `/api/chat/message/reaction`;

        const res = await authFetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({ messageId: msgId, emoji })
        });
        if (!res) return;
        const data = await res.json();
        if (!data.success) return;

        // Cập nhật UI local
        const bar = wrapper.querySelector('.reaction-bar');
        if (bar) renderReactions(bar, data.reactions);

        // Broadcast real-time
        if (isGroupMsg) {
            socket.emit('broadcast_group_reaction', {
                groupId:   currentGroupId,
                messageId: msgId,
                reactions: data.reactions
            });
        } else {
            socket.emit('broadcast_reaction', {
                messageId: msgId,
                reactions: data.reactions,
                partnerId: data.partnerId
            });
        }
    } catch (err) {
        console.error('Reaction error:', err);
    }
}

// ── Forward modal ──
function showForwardModal(wrapper) {
    closeAllPopups();
    const text = wrapper.dataset.plaintext;
    if (!text) return alert('Không thể chuyển tiếp tin nhắn này.');

    const modal = document.createElement('div');
    modal.id = '_forward_modal';
    modal.className = 'forward-modal-overlay';

    const box = document.createElement('div');
    box.className = 'forward-modal-box';

    const title = document.createElement('h4');
    title.textContent = 'Chuyển tiếp tin nhắn';
    box.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'forward-subtitle';
    subtitle.textContent = 'Chọn người để gửi:';
    box.appendChild(subtitle);

    // Danh sách bạn bè từ sidebar
    const list = document.createElement('ul');
    list.className = 'forward-contact-list';

    const contacts = document.querySelectorAll('.contact-item[data-status="accepted"]');
    if (contacts.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Không có bạn bè nào để chuyển tiếp.';
        li.style.color = '#999';
        li.style.fontSize = '13px';
        list.appendChild(li);
    }

    contacts.forEach(item => {
        const username = item.dataset.username;
        const userId   = item.dataset.id;
        const li = document.createElement('li');
        li.className = 'forward-contact-item';

        const avatar = document.createElement('span');
        avatar.className = 'forward-avatar';
        avatar.textContent = username[0].toUpperCase();

        const name = document.createElement('span');
        name.textContent = username;

        li.appendChild(avatar);
        li.appendChild(name);
        li.addEventListener('click', async () => {
            modal.remove();
            await doForwardMessage(text, userId, username);
        });
        list.appendChild(li);
    });

    box.appendChild(list);

    // Nút đóng
    const closeBtn = document.createElement('button');
    closeBtn.className = 'forward-close-btn';
    closeBtn.textContent = 'Huỷ';
    closeBtn.addEventListener('click', () => modal.remove());
    box.appendChild(closeBtn);

    modal.appendChild(box);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
}

// ── Thực hiện forward ──
async function doForwardMessage(text, targetId, targetUsername) {
    // Nếu đang chat với người đó thì gửi luôn
    if (currentChat.partnerId === targetId && currentChat.sharedSecret) {
        const signature   = await signMessage(text, myIdentity.signingPrivateKey);
        const encrypted   = await encryptMessage(text, currentChat.sharedSecret);
        socket.emit('send_message', {
            recipientId:      targetId,
            encryptedContent: encrypted.ciphertext,
            iv:               encrypted.iv,
            signature
        });
        appendMessage(text, 'sent', null, new Date(), null, true);
        return;
    }

    // Nếu chưa thiết lập sharedSecret với người đó → cần handshake trước
    // Lưu pending forward để thực hiện sau khi handshake xong
    pendingForward = { text, targetId };
    startHandshake(targetUsername);
}

// [MỚI] Cập nhật dòng preview "Tin nhắn mới" ở sidebar
function updateContactPreview(userId) {
    const el = document.getElementById(`preview-${userId}`);
    if (el) el.textContent = 'Có tin nhắn mới';
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

        // [MỚI] isTemp=true: hiện ngay, chờ message_sent_sync gán msgId thật
        appendMessage(text, 'sent', null, new Date(), null, true);
        dom.msgInput.value = '';
    } catch (err) {
        console.error("Lỗi gửi tin:", err);
        alert("Không thể mã hóa tin nhắn.");
    }
}

// --- GLOBAL HANDLERS ---

window.toggleMenu = function(e, btn, id) {
    e.stopPropagation();
    e.preventDefault();

    const menu = document.getElementById(`menu-${id}`);
    if (!menu) {
        console.error('[toggleMenu] menu element not found: menu-' + id);
        return;
    }

    // Lưu trạng thái TRƯỚC khi đóng tất cả
    const isOpen = !menu.classList.contains('hidden');

    // Đóng tất cả menu đang mở
    document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));

    // Nếu menu này đang mở → chỉ đóng, không mở lại
    if (isOpen) return;

    // === Định vị menu ===
    // [FIX] Dùng `btn` được truyền vào thay vì e.currentTarget
    // e.currentTarget trong inline onclick không đáng tin cậy (có thể null)
    const btnRect = btn.getBoundingClientRect();

    // Hiển thị trước để đo kích thước chính xác
    menu.classList.remove('hidden');

    const menuW = menu.offsetWidth  || 140;
    const menuH = menu.offsetHeight || 80;

    // position:fixed → tọa độ viewport, KHÔNG cộng scrollX/scrollY
    let top  = btnRect.bottom + 4;
    let left = btnRect.right - menuW;

    if (top + menuH > window.innerHeight) top = btnRect.top - menuH - 4;
    if (left < 8) left = 8;

    menu.style.top  = `${top}px`;
    menu.style.left = `${left}px`;

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
            // [FIX] Xóa menu element khỏi document.body khi unfriend
            const orphanMenu = document.getElementById(`menu-${targetId}`);
            if (orphanMenu) orphanMenu.remove();
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
    if (!e.target.closest('.contact-options-btn') && !e.target.closest('.options-menu')) {
        document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));
    }
    // Đóng emoji picker và msg options menu khi click ra ngoài
    if (!e.target.closest('.msg-action-btn') && !e.target.closest('.emoji-picker') && !e.target.closest('.msg-options-menu')) {
        document.getElementById('_emoji_picker')?.remove();
        document.getElementById('_msg_options_menu')?.remove();
        activeEmojiPicker = null;
        activeMsgMenu     = null;
    }
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

// ============================================================
// ══ GROUP CHAT MODULE ══
// ============================================================

// ── Crypto helpers cho group key ──

// Mã hoá group key bằng ECDH shared secret với một member
async function encryptGroupKeyForMember(groupKey, memberPublicKeyBase64) {
    const memberPubKey  = await importPublicKey(memberPublicKeyBase64);
    const sharedSecret  = await deriveSharedSecret(myIdentity.privateKey, memberPubKey);
    const rawKey        = await window.crypto.subtle.exportKey('raw', groupKey);
    const iv            = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted     = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedSecret, rawKey);
    return { encryptedGroupKey: arrayBufferToBase64(encrypted), keyIv: arrayBufferToBase64(iv) };
}

// Giải mã group key nhận từ server
async function decryptGroupKey(encryptedGroupKeyB64, keyIvB64, keyHolderPublicKeyB64) {
    const keyHolderPub = await importPublicKey(keyHolderPublicKeyB64);
    const sharedSecret = await deriveSharedSecret(myIdentity.privateKey, keyHolderPub);
    const iv           = base64ToArrayBuffer(keyIvB64);
    const data         = base64ToArrayBuffer(encryptedGroupKeyB64);
    const rawKey       = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedSecret, data);
    return await window.crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Lấy group key (từ cache hoặc fetch + decrypt)
async function getGroupKey(groupId) {
    if (groupKeys.has(groupId)) return groupKeys.get(groupId);

    const res  = await authFetch(`/api/groups/${groupId}/my-key`);
    if (!res) return null;
    const data = await res.json();
    if (!data.encryptedGroupKey) return null;

    const key = await decryptGroupKey(data.encryptedGroupKey, data.keyIv, data.keyHolderPublicKey);
    groupKeys.set(groupId, key);
    return key;
}

// ── Load & render groups ──
async function loadGroups() {
    try {
        const res = await authFetch('/api/groups');
        if (!res) return;
        const groups = await res.json();

        // Cache group IDs để rejoin sau reconnect
        sessionStorage.setItem('myGroupIds', JSON.stringify(groups.map(g => g._id)));
        socket.emit('join_groups', groups.map(g => g._id));

        dom.groupsList.innerHTML = '';
        groups.forEach(g => renderGroupItem(g));
    } catch (err) {
        console.error('loadGroups error:', err);
    }
}

function renderGroupItem(group) {
    if (document.querySelector(`.group-item[data-group-id="${group._id}"]`)) return;

    const li = document.createElement('li');
    li.className = 'contact-item group-item';
    li.dataset.groupId = group._id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar-container';
    avatar.innerHTML = `<div class="avatar group-avatar">${group.name[0].toUpperCase()}</div>`;

    const info = document.createElement('div');
    info.className = 'contact-info';
    info.innerHTML = `
        <div class="contact-name">${group.name}</div>
        <div class="last-message" id="group-preview-${group._id}">${group.members?.length || 0} thành viên</div>
    `;

    const badge = document.createElement('span');
    badge.className = 'unread-badge hidden';
    badge.id = `unread-group-${group._id}`;
    if (group.unreadCount > 0) {
        badge.textContent = group.unreadCount > 99 ? '99+' : group.unreadCount;
        badge.classList.remove('hidden');
    }

    li.appendChild(avatar);
    li.appendChild(info);
    li.appendChild(badge);
    li.addEventListener('click', () => openGroupChat(group));
    dom.groupsList.appendChild(li);
}

// ── Mở group chat ──
async function openGroupChat(group) {
    currentGroupId = group._id;
    currentChat = { partnerId: null, partnerPublicKey: null, partnerSigningPublicKey: null, sharedSecret: null };

    // Highlight
    document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.group-item[data-group-id="${group._id}"]`)?.classList.add('active');

    // Header
    dom.chatHeader.classList.remove('hidden');
    dom.partnerName.innerText  = `👥 ${group.name}`;
    dom.partnerStatus.innerText = `${group.members?.length || '?'} thành viên`;
    dom.partnerStatus.classList.remove('online');

    // Hiện nút quản lý nhóm
    dom.btnManageGroup.classList.remove('hidden');
    dom.btnManageGroup.dataset.groupId = group._id;

    // Enable input
    dom.chatInputArea.classList.remove('hidden');
    dom.blockOverlay.classList.add('hidden');
    dom.msgInput.disabled  = false;
    dom.btnSend.disabled   = false;
    dom.msgInput.placeholder = 'Nhắn tin vào nhóm...';

    // Clear messages
    dom.messagesList.innerHTML = '<div class="system-msg">🔒 Đang tải lịch sử nhóm...</div>';

    // Load group key
    try {
        await getGroupKey(group._id);
    } catch (e) {
        dom.messagesList.innerHTML = '<div class="system-msg">⚠️ Không thể tải khoá nhóm. Vui lòng thử lại.</div>';
        return;
    }

    // Load history
    await loadGroupHistory(group._id);

    // Reset badge
    const badge = document.getElementById(`unread-group-${group._id}`);
    if (badge) { badge.textContent = ''; badge.classList.add('hidden'); }
}

// ── Load group message history ──
async function loadGroupHistory(groupId) {
    try {
        const res = await authFetch(`/api/groups/${groupId}/history`);
        if (!res) return;
        const messages = await res.json();

        dom.messagesList.innerHTML = '';
        if (messages.length === 0) {
            dom.messagesList.innerHTML = '<div class="system-msg">Chưa có tin nhắn nào trong nhóm.</div>';
            return;
        }

        const groupKey = await getGroupKey(groupId);
        if (!groupKey) return;

        for (const msg of messages) {
            try {
                const text = await decryptMessage({ ciphertext: msg.encryptedContent, iv: msg.iv }, groupKey);
                const isMine = msg.sender._id === myIdentity.userId || msg.sender._id?.toString() === myIdentity.userId;
                const type   = isMine ? 'sent' : 'received';
                const wrapper = appendMessage(text, type, null, msg.timestamp, msg._id, false, msg.reactions || []);
                // Hiện tên người gửi cho tin nhận
                if (!isMine && wrapper) {
                    const senderLabel = document.createElement('div');
                    senderLabel.className = 'group-sender-label';
                    senderLabel.textContent = msg.sender.username || '';
                    wrapper.insertBefore(senderLabel, wrapper.firstChild);
                }
            } catch (e) {
                appendMessage('[Lỗi giải mã]', 'system');
            }
        }
        dom.messagesList.scrollTop = dom.messagesList.scrollHeight;

        // [FIX BUG 1] Emit mark_group_read sau khi load và hiển thị xong
        socket.emit('mark_group_read', { groupId });

    } catch (err) {
        console.error('loadGroupHistory error:', err);
    }
}

// ── Gửi tin nhắn nhóm ──
async function sendGroupMessage() {
    const text = dom.msgInput.value.trim();
    if (!text || !currentGroupId) return;

    const groupKey = groupKeys.get(currentGroupId);
    if (!groupKey) { alert('Chưa có khoá nhóm. Vui lòng thử lại.'); return; }

    try {
        const signature   = await signMessage(text, myIdentity.signingPrivateKey);
        const encrypted   = await encryptMessage(text, groupKey);

        socket.emit('send_group_message', {
            groupId:          currentGroupId,
            encryptedContent: encrypted.ciphertext,
            iv:               encrypted.iv,
            signature
        });

        appendMessage(text, 'sent', null, new Date(), null, true);
        dom.msgInput.value = '';
    } catch (err) {
        console.error('sendGroupMessage error:', err);
        alert('Không thể gửi tin nhắn nhóm.');
    }
}

// ── Socket events cho group ──
socket.on('receive_group_message', async (payload) => {
    const { groupId, senderId, senderName, encryptedContent, iv, reactions, timestamp, messageId } = payload;

    // Cập nhật preview sidebar
    const previewEl = document.getElementById(`group-preview-${groupId}`);
    if (previewEl) previewEl.textContent = `${senderName}: tin nhắn mới`;

    if (currentGroupId !== groupId) {
        // Tăng badge
        const badge = document.getElementById(`unread-group-${groupId}`);
        if (badge) {
            const cur = parseInt(badge.textContent) || 0;
            badge.textContent = cur + 1 > 99 ? '99+' : cur + 1;
            badge.classList.remove('hidden');
        }
        return;
    }

    // Đang xem nhóm này → giải mã và hiện
    try {
        const groupKey = await getGroupKey(groupId);
        const text     = await decryptMessage({ ciphertext: encryptedContent, iv }, groupKey);
        const wrapper  = appendMessage(text, 'received', null, timestamp, messageId, false, reactions || []);
        if (wrapper) {
            const senderLabel = document.createElement('div');
            senderLabel.className = 'group-sender-label';
            senderLabel.textContent = senderName;
            wrapper.insertBefore(senderLabel, wrapper.firstChild);
        }
        // [FIX BUG 1] Đang xem nhóm → đánh dấu đã đọc real-time
        socket.emit('mark_group_read', { groupId });
    } catch (e) {
        appendMessage('[Lỗi giải mã]', 'system');
    }
});

socket.on('group_message_sent_sync', async (payload) => {
    if (payload.senderSocketId === socket.id) {
        // Cùng socket → gán msgId cho temp message
        const tempEl = dom.messagesList.querySelector('[data-temp="true"]');
        if (tempEl) { tempEl.removeAttribute('data-temp'); tempEl.dataset.msgId = payload.messageId; }
        return;
    }
    // Thiết bị khác → hiện tin
    if (currentGroupId === payload.groupId) {
        const groupKey = await getGroupKey(payload.groupId);
        const text = await decryptMessage({ ciphertext: payload.encryptedContent, iv: payload.iv }, groupKey);
        appendMessage(text, 'sent', null, payload.timestamp, payload.messageId);
    }
});

socket.on('group_invited', async ({ groupId, groupName, memberCount }) => {
    // [FIX BUG 2] Join socket room ngay
    socket.emit('join_groups', [groupId]);

    // Fetch đầy đủ thông tin từ /api/groups (getGroups) để có myEncryptedKey + unreadCount
    const res = await authFetch('/api/groups');
    if (res) {
        const groups = await res.json();
        const newGroup = groups.find(g => g._id?.toString() === groupId?.toString());
        if (newGroup) {
            // Cập nhật cached group IDs
            const cached = JSON.parse(sessionStorage.getItem('myGroupIds') || '[]');
            if (!cached.includes(groupId)) {
                cached.push(groupId);
                sessionStorage.setItem('myGroupIds', JSON.stringify(cached));
            }

            // Render item vào sidebar (nếu chưa có)
            const existing = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
            if (!existing) {
                renderGroupItem(newGroup);
            }

            // [FIX BUG 2] Switch sang tab nhóm để user thấy ngay
            dom.tabGroups?.click();

            // Hiện thông báo nhỏ ở chat area
            if (currentGroupId !== groupId) {
                // Nếu đang mở group khác hoặc DM → hiện toast-like system msg
                const toast = document.createElement('div');
                toast.className   = 'group-invite-toast';
                toast.textContent = `🎉 Bạn đã được thêm vào nhóm "${groupName}"`;
                toast.addEventListener('click', () => {
                    toast.remove();
                    openGroupChat(newGroup);
                });
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 5000);
            }
        }
    }
});

// [FIX BUG 1] Nhận thông báo ai đó đã đọc tin nhắn nhóm
socket.on('group_read_update', ({ groupId, userId, username }) => {
    if (currentGroupId !== groupId) return;
    // Cập nhật seen indicator ở cuối danh sách tin nhắn
    renderGroupSeenIndicator(username);
});

// ── Hiện dòng "Đã xem: username" dưới tin nhắn cuối trong group ──
function renderGroupSeenIndicator(username) {
    // Xóa indicator cũ của user này nếu có
    document.querySelectorAll(`.group-seen-item[data-user="${username}"]`)
        .forEach(el => el.remove());

    // Lấy wrapper của tin nhắn cuối cùng trong danh sách
    const wrappers = dom.messagesList.querySelectorAll('.msg-wrapper');
    if (wrappers.length === 0) return;
    const lastWrapper = wrappers[wrappers.length - 1];

    // Tìm hoặc tạo seen-bar bên dưới wrapper cuối
    let seenBar = dom.messagesList.querySelector('.group-seen-bar');
    if (!seenBar) {
        seenBar = document.createElement('div');
        seenBar.className = 'group-seen-bar';
        dom.messagesList.appendChild(seenBar);
    }
    // Di chuyển seenBar xuống sau wrapper cuối
    dom.messagesList.insertBefore(seenBar, lastWrapper.nextSibling);

    const item = document.createElement('span');
    item.className   = 'group-seen-item';
    item.dataset.user = username;
    item.textContent  = username;
    seenBar.appendChild(item);

    // Giới hạn hiện tối đa 3 người, còn lại hiện "+N"
    const items = seenBar.querySelectorAll('.group-seen-item:not(.group-seen-more)');
    if (items.length > 3) {
        const more = seenBar.querySelector('.group-seen-more') || document.createElement('span');
        more.className   = 'group-seen-item group-seen-more';
        more.textContent  = `+${items.length - 3}`;
        seenBar.appendChild(more);
        items.forEach((el, i) => { el.style.display = i < 3 ? '' : 'none'; });
    }

    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
}

socket.on('group_kicked', ({ groupId }) => {
    socket.leave?.('group:' + groupId);
    document.querySelector(`.group-item[data-group-id="${groupId}"]`)?.remove();
    if (currentGroupId === groupId) {
        currentGroupId = null;
        dom.messagesList.innerHTML = '<div class="system-msg">Bạn đã bị xoá khỏi nhóm này.</div>';
        dom.msgInput.disabled = true; dom.btnSend.disabled = true;
        dom.btnManageGroup.classList.add('hidden');
    }
});

socket.on('group_member_added', ({ groupId, memberCount }) => {
    // [FIX BUG 2] Cập nhật preview sidebar member count
    const previewEl = document.getElementById(`group-preview-${groupId}`);
    if (previewEl && memberCount) previewEl.textContent = `${memberCount} thành viên`;

    if (currentGroupId === groupId) {
        appendMessage('Có thành viên mới tham gia nhóm', 'system');
        // Cập nhật header status
        if (memberCount) dom.partnerStatus.innerText = `${memberCount} thành viên`;
        // Reload manage modal nếu đang mở
        if (!dom.modalManageGroup.classList.contains('hidden')) loadManageModal(groupId);
    }
});

socket.on('group_member_removed', ({ groupId, removedUserId }) => {
    // [FIX BUG 4] Cập nhật sidebar member count
    authFetch(`/api/groups/${groupId}/info`).then(async res => {
        if (!res) return;
        const g = await res.json();
        const previewEl = document.getElementById(`group-preview-${groupId}`);
        if (previewEl) previewEl.textContent = `${g.members?.length || 0} thành viên`;
    });

    if (currentGroupId === groupId && removedUserId !== myIdentity.userId) {
        appendMessage('Một thành viên đã rời nhóm', 'system');
        // Cập nhật header status
        authFetch(`/api/groups/${groupId}/info`).then(async res => {
            if (!res) return;
            const g = await res.json();
            dom.partnerStatus.innerText = `${g.members?.length || 0} thành viên`;
        });
        // Reload manage modal nếu đang mở
        if (!dom.modalManageGroup.classList.contains('hidden')) loadManageModal(groupId);
    }
});

// ── Override sendMessage để phân biệt group / DM ──
const _originalSendMessage = sendMessage;
// Patch: btn-send và Enter key check currentGroupId
dom.btnSend.removeEventListener('click', sendMessage);
dom.btnSend.addEventListener('click', () => {
    if (currentGroupId) sendGroupMessage();
    else sendMessage();
});
dom.msgInput.removeEventListener('keypress', null);
dom.msgInput.addEventListener('keypress', (e) => {
    if (e.key !== 'Enter') return;
    if (currentGroupId) sendGroupMessage();
    else sendMessage();
});

// ── Tab switching ──
dom.tabFriends?.addEventListener('click', () => {
    dom.tabFriends.classList.add('active');
    dom.tabGroups.classList.remove('active');
    dom.panelFriends.classList.remove('hidden');
    dom.panelGroups.classList.add('hidden');
});
dom.tabGroups?.addEventListener('click', () => {
    dom.tabGroups.classList.add('active');
    dom.tabFriends.classList.remove('active');
    dom.panelGroups.classList.remove('hidden');
    dom.panelFriends.classList.add('hidden');
});

// ── CREATE GROUP MODAL ──
dom.btnCreateGroup?.addEventListener('click', openCreateGroupModal);
document.getElementById('btn-close-create-group')?.addEventListener('click', () => dom.modalCreateGroup.classList.add('hidden'));
document.getElementById('btn-cancel-create-group')?.addEventListener('click', () => dom.modalCreateGroup.classList.add('hidden'));
document.getElementById('btn-submit-create-group')?.addEventListener('click', submitCreateGroup);
dom.modalCreateGroup?.addEventListener('click', (e) => { if (e.target === dom.modalCreateGroup) dom.modalCreateGroup.classList.add('hidden'); });

async function openCreateGroupModal() {
    dom.modalCreateGroup.classList.remove('hidden');
    document.getElementById('group-name-input').value = '';
    document.getElementById('create-group-error').classList.add('hidden');
    document.getElementById('selected-members-preview').classList.add('hidden');
    document.getElementById('selected-chips').innerHTML = '';

    // Load danh sách bạn bè đã kết bạn
    const checkboxList = document.getElementById('friend-checkboxes');
    checkboxList.innerHTML = '<div style="color:#999;font-size:13px">Đang tải...</div>';

    const contacts = [...document.querySelectorAll('.contact-item[data-status="accepted"]')];
    if (contacts.length === 0) {
        checkboxList.innerHTML = '<div style="color:#999;font-size:13px">Bạn chưa có bạn bè nào.</div>';
        return;
    }

    checkboxList.innerHTML = '';
    contacts.forEach(item => {
        const userId   = item.dataset.id;
        const username = item.dataset.username;
        const label    = document.createElement('label');
        label.className = 'friend-checkbox-item';
        label.innerHTML = `
            <input type="checkbox" class="member-checkbox" data-id="${userId}" data-name="${username}">
            <span class="friend-checkbox-avatar">${username[0].toUpperCase()}</span>
            <span>${username}</span>
        `;
        checkboxList.appendChild(label);

        label.querySelector('input').addEventListener('change', updateSelectedPreview);
    });
}

function updateSelectedPreview() {
    const checked = [...document.querySelectorAll('.member-checkbox:checked')];
    const preview = document.getElementById('selected-members-preview');
    const chips   = document.getElementById('selected-chips');
    chips.innerHTML = '';
    if (checked.length === 0) { preview.classList.add('hidden'); return; }
    preview.classList.remove('hidden');
    checked.forEach(cb => {
        const chip = document.createElement('span');
        chip.className = 'member-chip';
        chip.textContent = cb.dataset.name;
        chips.appendChild(chip);
    });
}

async function submitCreateGroup() {
    const name    = document.getElementById('group-name-input').value.trim();
    const checked = [...document.querySelectorAll('.member-checkbox:checked')];
    const errEl   = document.getElementById('create-group-error');
    errEl.classList.add('hidden');

    if (!name) { errEl.textContent = 'Vui lòng nhập tên nhóm'; errEl.classList.remove('hidden'); return; }
    if (checked.length === 0) { errEl.textContent = 'Chọn ít nhất 1 thành viên'; errEl.classList.remove('hidden'); return; }

    const btn = document.getElementById('btn-submit-create-group');
    btn.disabled = true; btn.textContent = 'Đang tạo...';

    try {
        // Lấy public keys của tất cả members (kể cả mình)
        const memberIds = checked.map(cb => cb.dataset.id);
        const allIds    = [...memberIds, myIdentity.userId];

        const keysRes  = await authFetch(`/api/groups/member-keys?userIds=${allIds.join(',')}`);
        if (!keysRes) throw new Error('Không lấy được public keys');
        const members  = await keysRes.json(); // [{ _id, username, publicKey }]

        // Generate group key (AES-GCM 256-bit)
        const groupKey = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

        // Mã hoá group key cho từng member
        const memberPayloads = await Promise.all(members.map(async m => {
            const { encryptedGroupKey, keyIv } = await encryptGroupKeyForMember(groupKey, m.publicKey);
            return { userId: m._id, encryptedGroupKey, keyIv };
        }));

        // Gọi API tạo nhóm
        const res  = await authFetch('/api/groups/create', {
            method: 'POST',
            body: JSON.stringify({ name, members: memberPayloads })
        });
        if (!res) throw new Error('Lỗi mạng');
        const group = await res.json();
        if (!group._id) throw new Error(group.message || 'Tạo nhóm thất bại');

        // Cache group key
        groupKeys.set(group._id, groupKey);
        // Update cached group IDs
        const cached = JSON.parse(sessionStorage.getItem('myGroupIds') || '[]');
        cached.push(group._id);
        sessionStorage.setItem('myGroupIds', JSON.stringify(cached));

        // Join socket room
        socket.emit('join_groups', [group._id]);

        // Render group item trong sidebar
        renderGroupItem({ ...group, members: group.members, unreadCount: 0 });

        // Notify các thành viên
        socket.emit('broadcast_group_member_added', {
            groupId: group._id,
            newMember: { _id: 'all', username: 'all' },
            groupName: name
        });

        // Đóng modal và chuyển sang tab nhóm
        dom.modalCreateGroup.classList.add('hidden');
        dom.tabGroups?.click();
        openGroupChat(group);

    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false; btn.textContent = 'Tạo nhóm';
    }
}

// ── MANAGE GROUP MODAL ──
dom.btnManageGroup?.addEventListener('click', () => {
    const groupId = dom.btnManageGroup.dataset.groupId;
    if (groupId) { dom.modalManageGroup.classList.remove('hidden'); loadManageModal(groupId); }
});
document.getElementById('btn-close-manage-group')?.addEventListener('click',   () => dom.modalManageGroup.classList.add('hidden'));
document.getElementById('btn-close-manage-group-2')?.addEventListener('click', () => dom.modalManageGroup.classList.add('hidden'));
dom.modalManageGroup?.addEventListener('click', (e) => { if (e.target === dom.modalManageGroup) dom.modalManageGroup.classList.add('hidden'); });

document.getElementById('btn-leave-group')?.addEventListener('click', async () => {
    if (!currentGroupId) return;
    if (!confirm('Bạn có chắc muốn rời nhóm này?')) return;

    const res = await authFetch(`/api/groups/${currentGroupId}/leave`, { method: 'POST' });
    if (!res) return;
    const data = await res.json();
    if (data.success) {
        socket.emit('broadcast_group_left', { groupId: currentGroupId });
        document.querySelector(`.group-item[data-group-id="${currentGroupId}"]`)?.remove();
        groupKeys.delete(currentGroupId);
        currentGroupId = null;
        dom.modalManageGroup.classList.add('hidden');
        dom.btnManageGroup.classList.add('hidden');
        dom.messagesList.innerHTML = '<div class="system-msg">Bạn đã rời nhóm.</div>';
        dom.msgInput.disabled = true; dom.btnSend.disabled = true;
    }
});

document.getElementById('btn-add-member')?.addEventListener('click', addSelectedMembers);

async function loadManageModal(groupId) {
    document.getElementById('manage-group-error').classList.add('hidden');

    const res = await authFetch(`/api/groups/${groupId}/info`);
    if (!res) return;
    const group = await res.json();

    if (!group || !group._id) {
        document.getElementById('manage-group-error').textContent = 'Không thể tải thông tin nhóm.';
        document.getElementById('manage-group-error').classList.remove('hidden');
        return;
    }

    document.getElementById('manage-group-title').textContent = `⚙️ ${group.name}`;

    const members = group.members || [];
    document.getElementById('member-count').textContent = members.length;

    // creatorId là ObjectId string (chưa populate)
    const creatorId = group.creator?._id?.toString() || group.creator?.toString();
    const myId      = myIdentity.userId?.toString();

    // admins có thể là array ObjectId hoặc array object {_id, username}
    const adminIds  = (group.admins || []).map(a => (a._id || a).toString());
    const isAdmin   = adminIds.includes(myId);

    const memberList = document.getElementById('member-list');
    memberList.innerHTML = '';

    if (members.length === 0) {
        memberList.innerHTML = '<li style="color:#999;font-size:13px;padding:8px">Không có thành viên nào.</li>';
    } else {
        members.forEach(m => {
            // Sau khi populate: m.userId = { _id, username, publicKey }
            // Trước khi populate: m.userId = ObjectId string
            const uid      = (m.userId?._id || m.userId)?.toString();
            const username = m.userId?.username || '(unknown)';
            const isCreator    = uid === creatorId;
            const isThisAdmin  = adminIds.includes(uid);

            const li   = document.createElement('li');
            li.className = 'member-list-item';

            const left = document.createElement('div');
            left.className = 'member-list-left';
            left.innerHTML = `
                <div class="member-avatar">${username[0].toUpperCase()}</div>
                <div>
                    <div class="member-name">${username}</div>
                    ${isCreator    ? '<div class="member-role creator">Trưởng nhóm</div>'
                    : isThisAdmin  ? '<div class="member-role admin">Quản trị</div>' : ''}
                </div>
            `;
            li.appendChild(left);

            // Nút xoá (admin only, không xoá creator hoặc chính mình)
            if (isAdmin && !isCreator && uid !== myId) {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'btn-remove-member';
                removeBtn.textContent = 'Xoá';
                removeBtn.addEventListener('click', () => removeMemberFromGroup(groupId, uid, username));
                li.appendChild(removeBtn);
            }
            memberList.appendChild(li);
        });
    }

    // Section thêm thành viên (admin only)
    const addSection = document.getElementById('add-member-section');
    if (isAdmin) {
        addSection.classList.remove('hidden');
        const currentMemberIds = new Set(group.members?.map(m => (m.userId?._id || m.userId)?.toString()));

        const checkboxes = document.getElementById('add-member-checkboxes');
        checkboxes.innerHTML = '';
        const availableFriends = [...document.querySelectorAll('.contact-item[data-status="accepted"]')]
            .filter(item => !currentMemberIds.has(item.dataset.id));

        if (availableFriends.length === 0) {
            checkboxes.innerHTML = '<div style="color:#999;font-size:12px">Tất cả bạn bè đã trong nhóm.</div>';
        } else {
            availableFriends.forEach(item => {
                const label = document.createElement('label');
                label.className = 'friend-checkbox-item';
                label.innerHTML = `
                    <input type="checkbox" class="add-member-checkbox" data-id="${item.dataset.id}" data-name="${item.dataset.username}">
                    <span class="friend-checkbox-avatar">${item.dataset.username[0].toUpperCase()}</span>
                    <span>${item.dataset.username}</span>
                `;
                checkboxes.appendChild(label);
            });
        }
    } else {
        addSection.classList.add('hidden');
    }
}

async function addSelectedMembers() {
    const checked = [...document.querySelectorAll('.add-member-checkbox:checked')];
    if (checked.length === 0) { alert('Chọn ít nhất 1 người'); return; }

    const groupId  = currentGroupId;
    const groupKey = await getGroupKey(groupId);
    if (!groupKey) { alert('Không có group key'); return; }

    const btn = document.getElementById('btn-add-member');
    btn.disabled = true; btn.textContent = 'Đang thêm...';

    const errEl = document.getElementById('manage-group-error');
    errEl.classList.add('hidden');

    try {
        const ids    = checked.map(cb => cb.dataset.id);
        const keysRes = await authFetch(`/api/groups/member-keys?userIds=${ids.join(',')}`);
        if (!keysRes) throw new Error('Không lấy được public keys');
        const members = await keysRes.json();

        const addedIds = [];
        const groupName = document.getElementById('manage-group-title').textContent.replace('⚙️ ', '');

        for (const m of members) {
            const { encryptedGroupKey, keyIv } = await encryptGroupKeyForMember(groupKey, m.publicKey);
            const res = await authFetch(`/api/groups/${groupId}/add-member`, {
                method: 'POST',
                body: JSON.stringify({ userId: m._id, encryptedGroupKey, keyIv })
            });
            if (!res) continue;
            const data = await res.json();
            if (data.success) addedIds.push(m._id.toString());
        }

        // [FIX BUG 2] Emit 1 lần với tất cả IDs thay vì nhiều lần riêng lẻ
        if (addedIds.length > 0) {
            socket.emit('broadcast_group_member_added', {
                groupId,
                newMemberIds: addedIds,
                groupName
            });
        }

        await loadManageModal(groupId);
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false; btn.textContent = '＋ Thêm thành viên đã chọn';
    }
}

async function removeMemberFromGroup(groupId, userId, username) {
    if (!confirm(`Xoá ${username} khỏi nhóm?`)) return;
    const errEl = document.getElementById('manage-group-error');
    errEl.classList.add('hidden');

    const res  = await authFetch(`/api/groups/${groupId}/remove-member`, {
        method: 'POST',
        body: JSON.stringify({ userId })
    });
    if (!res) return;
    const data = await res.json();
    if (data.success) {
        socket.emit('broadcast_group_member_removed', { groupId, removedUserId: userId });
        await loadManageModal(groupId);
        appendMessage(`${username} đã bị xoá khỏi nhóm`, 'system');
    } else {
        errEl.textContent = data.message;
        errEl.classList.remove('hidden');
    }
}

// Load groups khi init xong (gọi trong initApp)
// Được gọi tự động vì initApp() đã chạy ở trên
loadGroups();