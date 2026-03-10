// public/js/app.js
import { importPublicKey, deriveSharedSecret, encryptMessage, decryptMessage } from './crypto/key-manager.js';

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
    privateKey: null 
};
let currentChat = {
    partnerId: null,
    partnerPublicKey: null,
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

// [MỚI] Hàm Wrapper để gọi API có đính kèm Token
async function authFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    
    // Nếu không có headers thì tạo mới
    if (!options.headers) options.headers = {};
    
    // Đính kèm Token và Content-Type
    options.headers['Authorization'] = `Bearer ${token}`;
    if (!options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, options);

    // Nếu Token hết hạn hoặc không hợp lệ (Lỗi 401) -> Đá văng ra login
    if (res.status === 401) {
        alert("Phiên đăng nhập hết hạn.");
        logout();
        return null;
    }
    return res;
}

// Hàm đọc Private Key từ IndexedDB
function loadKeyFromDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("SecureChatDB", 1);
        request.onsuccess = (event) => {
            const db = event.target.result;
            const tx = db.transaction("keys", "readonly");
            const store = tx.objectStore("keys");
            const query = store.get("my-private-key");
            
            query.onsuccess = () => resolve(query.result ? query.result.key : null);
            query.onerror = () => reject("Lỗi đọc DB");
        };
        request.onerror = () => reject("Không mở được DB");
    });
}

function logout() {
    sessionStorage.clear();
    localStorage.removeItem('token'); // Xóa cả token
    window.location.href = '/login.html';
}

// ============================================================
// 3. INITIALIZATION
// ============================================================

async function initApp() {
    // Kiểm tra Token và Session
    const token = localStorage.getItem('token');
    const userId = sessionStorage.getItem('userId');
    const username = sessionStorage.getItem('username');
    
    if (!token || !userId || !username) {
        window.location.href = '/login.html';
        return;
    }

    try {
        // Load Private Key
        const privateKey = await loadKeyFromDB();
        if (!privateKey) throw new Error("Không tìm thấy Private Key");
        
        // Lưu State
        myIdentity = { userId, username, privateKey };
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
        const { userId, publicKey, username } = data;
        console.log("🔑 Handshake: Received key from", username);

        const partnerKeyObj = await importPublicKey(publicKey);
        const sharedKey = await deriveSharedSecret(myIdentity.privateKey, partnerKeyObj);

        currentChat = {
            partnerId: userId,
            partnerPublicKey: partnerKeyObj,
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
        appendMessage(decryptedText, 'received');
    } catch (err) {
        console.error("Decryption failed:", err);
        appendMessage("⚠️ [Lỗi giải mã]", 'received');
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
        // [FIX] Đánh dấu isTemp=true để khi xóa biết không cần gọi DB
        data.notification._id = 'temp_' + Date.now();
        data.notification.isTemp = true;
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

// F. Tín hiệu bắt đầu Handshake (Khi mình chấp nhận người khác)
socket.on('start_handshake_init', (data) => {
    console.log("Start Handshake Init...");
    renderContactItem({ _id: data.targetId, username: data.targetUsername, online: true });
    
    const item = document.querySelector(`.contact-item[data-id="${data.targetId}"]`);
    if (item) {
        // [FIX] Chỉ tự động click nếu KHÔNG bị block (tránh race condition)
        if (item.dataset.status !== 'blocked') {
            item.click();
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
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

// [MỚI] Nhận thông báo hệ thống từ server (vd: chưa phải bạn bè)
socket.on('system_message', ({ text }) => {
    const div = document.createElement('div');
    div.className = 'message system-msg';
    div.innerText = text;
    dom.messagesList.appendChild(div);
    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
});

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
                appendMessage(decryptedText, type);
            } catch (err) {
                appendMessage("[Tin nhắn lỗi]", 'received');
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
            // [FIX] Chỉ gọi server xóa nếu là thông báo thật (có ObjectId hợp lệ trong DB)
            if (notif._id && !notif.isTemp) {
                socket.emit('clear_notification', { notifId: notif._id });
            }
            notifications = notifications.filter(n => n._id !== notif._id);
            updateRequestUI();
        });
        dom.reqList.appendChild(li);
    });
}

// Vẽ tin nhắn
function appendMessage(text, type) {
    const div = document.createElement('div');
    div.classList.add('message', type === 'sent' ? 'msg-sent' : 'msg-received');
    div.innerText = text; 
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
        const encryptedData = await encryptMessage(text, currentChat.sharedSecret);
        // [BẢO MẬT] Không gửi senderId lên nữa — server tự lấy từ socket.userId đã xác thực
        const payload = {
            recipientId: currentChat.partnerId,
            encryptedContent: encryptedData.ciphertext,
            iv: encryptedData.iv
        };
        socket.emit('send_message', payload);
        appendMessage(text, 'sent');
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