// public/js/app.js
import { 
    importPublicKey, deriveSharedSecret, encryptMessage, decryptMessage,
    signMessage, verifySignature, importSigningPublicKey  // [MỚI]
} from './crypto/key-manager.js';

// ============================================================
// 1. CONFIG & STATE MANAGEMENT
// ============================================================
const socket = io();

// State
let friendRequests = [];
let notifications = [];
let myIdentity = {
    userId: null,
    username: null,
    privateKey: null,
    signingPrivateKey: null  // [MỚI]
};
let currentChat = {
    partnerId: null,
    partnerPublicKey: null,
    partnerSigningPublicKey: null,  // [MỚI] Để verify tin nhắn đến
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

// [SỬA] authFetch tự động refresh access token khi hết hạn
// Nếu nhận 401 + code TOKEN_EXPIRED:
//   → Gọi /api/auth/refresh với refreshToken
//   → Lưu accessToken mới
//   → Retry request gốc 1 lần
// Nếu nhận 401 + code TOKEN_INVALID hoặc refresh thất bại → logout
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

        // Token hết hạn và chưa retry lần nào → thử refresh
        if (data.code === 'TOKEN_EXPIRED' && !_isRetry) {
            const refreshed = await tryRefreshToken();
            if (refreshed) {
                // Retry request gốc với access token mới
                // Tạo options mới để không dùng token cũ
                const retryOptions = { ...options };
                retryOptions.headers = { ...options.headers };
                retryOptions.headers['Authorization'] = `Bearer ${localStorage.getItem('accessToken')}`;
                return fetch(url, retryOptions);
            }
        }

        // Không refresh được hoặc token giả → logout
        alert("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
        logout();
        return null;
    }
    return res;
}

// [MỚI] Gọi /api/auth/refresh để lấy access token mới
async function tryRefreshToken() {
    try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) return false;

        const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });

        if (!res.ok) return false;

        const data = await res.json();
        // Lưu access token mới
        localStorage.setItem('accessToken', data.accessToken);
        return true;

    } catch (err) {
        console.error("Refresh failed:", err);
        return false;
    }
}

// Hàm đọc khóa từ IndexedDB theo id
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
        // [MỚI] Thu hồi refresh token trên server trước khi xóa local
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
            // fire-and-forget — không cần chờ response
            fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            }).catch(() => {}); // Bỏ qua lỗi network lúc logout
        }
    } finally {
        // Xóa key khỏi IndexedDB
        try {
            const req = indexedDB.open("SecureChatDB", 1);
            req.onsuccess = (e) => {
                const tx = e.target.result.transaction("keys", "readwrite");
                tx.objectStore("keys").delete("my-private-key");
                tx.objectStore("keys").delete("my-signing-key");
            };
        } catch (e) {}

        sessionStorage.clear();
        localStorage.removeItem('accessToken');  // [SỬA]
        localStorage.removeItem('refreshToken'); // [MỚI]
        window.location.href = '/login.html';
    }
}

// ============================================================
// 3. INITIALIZATION
// ============================================================

async function initApp() {
    // Kiểm tra Token và Session
    const token = localStorage.getItem('accessToken'); // [SỬA] đổi key
    const userId = sessionStorage.getItem('userId');
    const username = sessionStorage.getItem('username');
    
    if (!token || !userId || !username) {
        window.location.href = '/login.html';
        return;
    }

    try {
        // Load Private Key ECDH
        const privateKey = await loadKeyFromDB('my-private-key');
        if (!privateKey) throw new Error("Không tìm thấy Private Key");

        // [MỚI] Load Signing Private Key ECDSA
        const signingPrivateKey = await loadKeyFromDB('my-signing-key');
        if (!signingPrivateKey) throw new Error("Không tìm thấy Signing Key");
        
        // Lưu State
        myIdentity = { userId, username, privateKey, signingPrivateKey };
        dom.myUsername.innerText = username;
        
        // Kết nối Socket
        socket.emit('join_user', userId);
        dom.status.innerText = "🟢 Online";
        dom.status.style.color = "green";

        // Load dữ liệu ban đầu
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
        const { userId, publicKey, username, signingPublicKey } = data; // [MỚI] nhận thêm signingPublicKey
        console.log("🔑 Handshake: Received key from", username);

        const partnerKeyObj = await importPublicKey(publicKey);
        const sharedKey = await deriveSharedSecret(myIdentity.privateKey, partnerKeyObj);

        // [MỚI] Import signing public key để verify tin nhắn đến
        const partnerSigningKey = signingPublicKey 
            ? await importSigningPublicKey(signingPublicKey)
            : null;

        currentChat = {
            partnerId: userId,
            partnerPublicKey: partnerKeyObj,
            partnerSigningPublicKey: partnerSigningKey, // [MỚI]
            sharedSecret: sharedKey
        };

        // UI Updates
        updateHeaderStatus(userId);
        dom.chatHeader.classList.remove('hidden');
        dom.partnerName.innerText = username || dom.searchInput.value;
        dom.msgInput.disabled = false;
        dom.btnSend.disabled = false;
        dom.messagesList.innerHTML = `<div class="system-msg">🔒 Đã thiết lập kênh E2EE.</div>`;
        
        // Highlight Sidebar
        document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
        const item = document.querySelector(`.contact-item[data-id="${userId}"]`);
        if(item) item.classList.add('active');

        // Load History
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

        // [MỚI] Verify chữ ký sau khi giải mã
        let signatureValid = null; // null = không có signature (tin nhắn cũ)
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
        appendMessage("⚠️ [Lỗi giải mã]", 'received', false);
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
    // Có thể thêm âm thanh thông báo tại đây
});

// E. Được chấp nhận kết bạn
socket.on('request_accepted', (data) => {
    console.log(`${data.accepterName} đã chấp nhận!`);
    if (data.notification) {
        // Tạo ID giả để UI không lỗi khi chưa reload
        data.notification._id = 'temp_' + Date.now();
        notifications.unshift(data.notification);
        updateRequestUI();
    }
    renderContactItem({ 
        _id: data.accepterId, 
        username: data.accepterName, 
        online: true // Chắc chắn họ đang online vì họ vừa bấm "Chấp nhận" xong
    });
    startHandshake(data.accepterName);
});

// F. Tín hiệu bắt đầu Handshake (Khi mình chấp nhận người khác)
socket.on('start_handshake_init', (data) => {
    console.log("Start Handshake Init...");
    // Vẽ ngay contact lên sidebar
    renderContactItem({ _id: data.targetId, username: data.targetUsername, online: true });
    
    // Tự động click vào để chat
    const item = document.querySelector(`.contact-item[data-id="${data.targetId}"]`);
    if (item) {
        item.click();
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
});

// G. Người khác chặn mình -> Tự động chuyển màn hình
socket.on('you_have_been_blocked', ({ blockerId }) => {
    const li = document.querySelector(`.contact-item[data-id="${blockerId}"]`);
    if (li) {
        // Cập nhật dataset: status là bị chặn, nhưng mình KHÔNG phải là người chủ động chặn
        li.dataset.status = 'blocked';
        li.dataset.isBlocker = 'false';
        
        // Nếu mình ĐANG MỞ khung chat với người đó thì ép tải lại UI để hiện khung đen ngay lập tức
        if (currentChat.partnerId === blockerId) {
            li.click();
        }
    }
});

// H. Người khác bỏ chặn mình -> Tự động mở lại khung chat
socket.on('you_have_been_unblocked', ({ unblockerId }) => {
    const li = document.querySelector(`.contact-item[data-id="${unblockerId}"]`);
    if (li) {
        li.dataset.status = 'accepted';
        li.dataset.isBlocker = 'false';
        
        // Nếu đang mở khung chat thì tự động Handshake lại để chat tiếp
        if (currentChat.partnerId === unblockerId) {
            li.click();
        }
    }
});

socket.on('error', (msg) => alert(msg));

// ============================================================
// 5. API CALLS (DATA LOADING)
// ============================================================

// Tải danh sách bạn bè
async function loadContacts() {
    try {
        // [QUAN TRỌNG] Dùng authFetch thay vì fetch thường
        const res = await authFetch(`/api/chat/contacts`);
        if(!res) return;
        
        const contacts = await res.json();
        dom.contactsList.innerHTML = ''; 
        contacts.forEach(user => renderContactItem(user));
    } catch (err) {
        console.error("Lỗi tải contacts:", err);
    }
}

// Tải lịch sử chat
async function loadChatHistory() {
    const { userId } = myIdentity;
    const { partnerId, sharedSecret } = currentChat;
    if (!userId || !partnerId) return;

    try {
        const res = await authFetch(`/api/chat/history/${partnerId}`);
        if(!res) return;

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
                const type = (msg.sender === userId) ? 'sent' : 'received';

                // [MỚI] Verify chữ ký cho tin nhắn nhận về trong history
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

// Tải lời mời kết bạn
async function loadFriendRequests() {
    try {
        const res = await authFetch(`/api/chat/requests`);
        if(!res) return;
        
        const data = await res.json();
        if (Array.isArray(data)) {
            friendRequests = data;
            updateRequestUI();
        }
    } catch (err) { console.error(err); }
}

// Tải thông báo
async function loadNotifications() {
    try {
        const res = await authFetch(`/api/chat/notifications`);
        if(!res) return;

        notifications = await res.json();
        updateRequestUI();
    } catch (err) { console.error(err); }
}

// ============================================================
// 6. UI RENDERING & INTERACTIONS
// ============================================================

// Vẽ 1 dòng liên hệ vào Sidebar
function renderContactItem(user) {
    if (document.querySelector(`.contact-item[data-id="${user._id}"]`)) return;

    const li = document.createElement('li');
    li.className = 'contact-item';
    li.dataset.id = user._id;
    li.dataset.username = user.username;
    const onlineClass = user.online ? 'online' : '';

    li.dataset.status = user.status; 
    li.dataset.isBlocker = user.isBlocker;

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
        
        // KIỂM TRA TRẠNG THÁI CHẶN TRƯỚC KHI HANDSHAKE
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
                dom.btnUnblock.onclick = () => handleUnblock(user._id); // Gắn sự kiện mở chặn
            } else {
                dom.blockTitle.innerText = `Bạn không thể trả lời cuộc trò chuyện này`;
                dom.btnUnblock.classList.add('hidden'); // Ẩn nút nếu là người bị chặn
            }
        } else {
            // Nếu bình thường thì hiện ô nhập tin nhắn và Handshake
            dom.chatInputArea.classList.remove('hidden');
            dom.blockOverlay.classList.add('hidden');
            startHandshake(user.username);
        }
    });

    dom.contactsList.appendChild(li);
}

// Cập nhật Popup Thông báo
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

    // Vẽ Lời mời
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

    // Vẽ Thông báo
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

// Vẽ tin nhắn
// [SỬA] Thêm tham số signatureValid:
//   null  = không có chữ ký (tin nhắn cũ) hoặc tin mình gửi → hiện bình thường
//   true  = verify thành công → im lặng, không làm gì thêm
//   false = verify thất bại → hiện cảnh báo đỏ, ẩn nội dung
function appendMessage(text, type, signatureValid = null) {
    const div = document.createElement('div');

    if (signatureValid === false) {
        // Verify thất bại → hiện cảnh báo, KHÔNG hiện nội dung tin nhắn
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
        // Verify thành công hoặc không có chữ ký → hiện bình thường, im lặng
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

// Bắt đầu Handshake
function startHandshake(targetUsername) {
    if (!targetUsername) return;
    if (targetUsername === myIdentity.username) return alert("Không thể chat với mình");
    socket.emit('request_public_key', { username: targetUsername });
}

// Gửi tin nhắn
async function sendMessage() {
    const text = dom.msgInput.value.trim();
    if (!text || !currentChat.sharedSecret) return;

    try {
        // [MỚI] BƯỚC 1: Ký plaintext trước khi mã hóa
        const signature = await signMessage(text, myIdentity.signingPrivateKey);

        // BƯỚC 2: Mã hóa như cũ
        const encryptedData = await encryptMessage(text, currentChat.sharedSecret);

        // [BẢO MẬT] Không gửi senderId — server lấy từ socket.userId
        const payload = {
            recipientId: currentChat.partnerId,
            encryptedContent: encryptedData.ciphertext,
            iv: encryptedData.iv,
            signature  // [MỚI]
        };
        socket.emit('send_message', payload);

        // Tin mình gửi → không verify, signatureValid = null
        appendMessage(text, 'sent', null);
        dom.msgInput.value = '';
    } catch (err) {
        console.error("Lỗi gửi tin:", err);
        alert("Không thể mã hóa tin nhắn.");
    }
}

// --- GLOBAL HANDLERS (Gắn vào window để gọi từ HTML) ---

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
        // [QUAN TRỌNG] Dùng authFetch để có Token
        const res = await authFetch('/api/chat/unfriend', {
            method: 'POST',
            body: JSON.stringify({ targetId })
        });
        if(!res) return;

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
        if(!res) return;

        const data = await res.json();
        if (data.success) {
            // 1. Báo cho Server biết để đẩy giao diện chặn sang người kia
            socket.emit('notify_block', { targetId });

            // 2. Cập nhật UI của chính mình (Không reload trang nữa)
            const li = document.querySelector(`.contact-item[data-id="${targetId}"]`);
            if (li) {
                li.dataset.status = 'blocked';
                li.dataset.isBlocker = 'true';
                
                // Ẩn menu 3 chấm đi sau khi đã chặn
                document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));
                
                // Ép click vào người này để giao diện chat chuyển sang màu đen (Overlay)
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
        if(!res) return;

        const data = await res.json();
        if (data.success) {
            // 1. Báo cho người kia biết đã được mở chặn
            socket.emit('notify_unblock', { targetId });
            
            // 2. Cập nhật UI của mình
            const li = document.querySelector(`.contact-item[data-id="${targetId}"]`);
            if(li) {
                li.dataset.status = 'accepted';
                li.dataset.isBlocker = 'false';
                li.click(); // Load lại luồng Handshake chat bình thường
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

// Click ra ngoài thì đóng popup/menu
document.addEventListener('click', (e) => {
    // Đóng menu 3 chấm
    document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));
    
    // Đóng popup thông báo
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
        alert(`Đã gửi lời mời tới ${targetUsername}.`);
    }
});

// CHẠY INIT
initApp();