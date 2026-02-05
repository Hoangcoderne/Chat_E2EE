// public/js/app.js
import { importPublicKey, deriveSharedSecret, encryptMessage, decryptMessage } from './crypto/key-manager.js';

const socket = io();
let friendRequests = [];
let notifications = [];
// --- STATE QUẢN LÝ TRẠNG THÁI ---
let myIdentity = {
    userId: null,
    username: null,
    privateKey: null // Sẽ load từ IndexedDB
};

let currentChat = {
    partnerId: null,
    partnerPublicKey: null,
    sharedSecret: null // Khóa phiên chung
};

// --- DOM ELEMENTS ---
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
    reqCount: document.getElementById('req-count')
};

// --- 1. KHỞI TẠO ỨNG DỤNG ---
async function initApp() {
    // A. Kiểm tra Session Storage
    const userId = sessionStorage.getItem('userId');
    const username = sessionStorage.getItem('username');
    
    if (!userId || !username) {
        window.location.href = '/login.html'; // Chưa login thì đá về trang login
        return;
    }

    // B. Load Private Key từ IndexedDB
    try {
        const privateKey = await loadKeyFromDB();
        if (!privateKey) throw new Error("Không tìm thấy Private Key");
        
        // Lưu vào State
        myIdentity = { userId, username, privateKey };
        dom.myUsername.innerText = username;
        
        // C. Kết nối Socket
        socket.emit('join_user', userId);
        dom.status.innerText = "🟢 Online";
        dom.status.style.color = "green";
        await loadContacts();
        await loadFriendRequests(); // Tải danh sách lời mời kết bạn
        await loadNotifications();

        console.log("App Initialized. Ready to E2EE.");

    } catch (err) {
        console.error(err);
        alert("Lỗi phiên đăng nhập: Mất khóa bảo mật. Vui lòng đăng nhập lại.");
        logout();
    }
   
}

// --- HELPER: Đọc IndexedDB ---
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

function updateHeaderStatus(userId) {
    // Nếu không phải người đang chat thì bỏ qua
    if (currentChat.partnerId !== userId) return;

    // Kiểm tra trạng thái trên Sidebar (nguồn sự thật)
    const sidebarDot = document.getElementById(`status-${userId}`);
    if (sidebarDot && sidebarDot.classList.contains('online')) {
        dom.partnerStatus.innerText = "Online";
        dom.partnerStatus.classList.add('online');
    } else {
        dom.partnerStatus.innerText = "Offline"; // Hoặc hiện thời gian offline nếu muốn
        dom.partnerStatus.classList.remove('online');
    }
}

function logout() {
    sessionStorage.clear();
    window.location.href = '/login.html';
}

dom.btnLogout.addEventListener('click', logout);

// Sự kiện bấm nút "Kết nối"
dom.btnConnect.addEventListener('click', () => {
    startHandshake(dom.searchInput.value.trim());
});

// Server trả về Public Key của đối phương
socket.on('response_public_key', async (data) => {
    try {
        const { userId, publicKey, username } = data; // username có thể server trả về hoặc lấy từ input
        console.log("Đã nhận Public Key của đối phương:", userId);

        // A. Import Public Key của họ vào format WebCrypto
        const partnerKeyObj = await importPublicKey(publicKey);

        // B. TẠO SHARED SECRET (Magic Step!)
        // Trộn Private Key của mình + Public Key của họ
        const sharedKey = await deriveSharedSecret(myIdentity.privateKey, partnerKeyObj);

        // C. Lưu vào State hiện tại
        currentChat = {
            partnerId: userId,
            partnerPublicKey: partnerKeyObj,
            sharedSecret: sharedKey
        };

        // THÊM: Nếu người này chưa có trong sidebar thì thêm vào
        renderContactItem({ _id: data.userId, username: data.username });
        
        // Highlight người đó
        document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
        const item = document.querySelector(`.contact-item[data-id="${data.userId}"]`);
        if(item) item.classList.add('active');
        
        updateHeaderStatus(data.userId);

        // D. Cập nhật UI
        dom.chatHeader.classList.remove('hidden');
        dom.partnerName.innerText = dom.searchInput.value; // Hoặc data.username
        dom.msgInput.disabled = false;
        dom.btnSend.disabled = false;
        dom.messagesList.innerHTML = `<div class="system-msg"> Đã thiết lập kênh E2EE an toàn. Server không thể đọc tin nhắn này.</div>`;
        
        // Sau khi đã có Shared Secret, ta mới giải mã được lịch sử
        await loadChatHistory(); 
        

    } catch (err) {
        console.error("Lỗi Handshake:", err);
        alert("Lỗi thiết lập mã hóa. Kiểm tra Console.");
    }
});

// Nếu không tìm thấy user
socket.on('error', (msg) => {
    alert(msg);
});

dom.btnSend.addEventListener('click', sendMessage);
dom.msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const text = dom.msgInput.value.trim();
    if (!text || !currentChat.sharedSecret) return;

    try {
        // A. Mã hóa tin nhắn
        // encryptMessage trả về { iv, ciphertext } (đều là Base64)
        const encryptedData = await encryptMessage(text, currentChat.sharedSecret);

        // B. Gửi lên Server (Relay)
        const payload = {
            senderId: myIdentity.userId,
            recipientId: currentChat.partnerId,
            encryptedContent: encryptedData.ciphertext,
            iv: encryptedData.iv
        };

        socket.emit('send_message', payload);

        // C. Hiển thị lên màn hình mình (Tin mình gửi thì mình tự hiện text gốc)
        appendMessage(text, 'sent');
        dom.msgInput.value = '';

    } catch (err) {
        console.error("Lỗi gửi tin:", err);
        alert("Không thể mã hóa tin nhắn.");
    }
}

// --- 4. XỬ LÝ NHẬN TIN NHẮN ---

socket.on('receive_message', async (payload) => {
    // payload gồm: { senderId, encryptedContent, iv, timestamp }
    
    // Kiểm tra xem tin nhắn có phải từ người đang chat không
    // (Trong demo này ta chỉ hỗ trợ chat 1-1 tại 1 thời điểm)
    if (payload.senderId !== currentChat.partnerId) {
        console.log("⚠️ Nhận tin từ người lạ (hoặc chưa connect):", payload.senderId);
        // Có thể hiện thông báo nhỏ ở đây
        return;
    }

    try {
        // A. Giải mã tin nhắn
        // decryptMessage cần { ciphertext, iv } và SharedSecret
        const decryptedText = await decryptMessage(
            { ciphertext: payload.encryptedContent, iv: payload.iv },
            currentChat.sharedSecret
        );

        // B. Hiển thị
        appendMessage(decryptedText, 'received');

    } catch (err) {
        console.error("Giải mã thất bại:", err);
        appendMessage("⚠️ [Tin nhắn lỗi - Không thể giải mã]", 'received');
    }
});

// --- HELPER: Vẽ tin nhắn lên giao diện ---
function appendMessage(text, type) {
    const div = document.createElement('div');
    div.classList.add('message', type === 'sent' ? 'msg-sent' : 'msg-received');
    div.innerText = text; // innerText an toàn, chống XSS
    
    dom.messagesList.appendChild(div);
    
    // Tự động cuộn xuống cuối
    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
}

// --- 5. TẢI VÀ GIẢI MÃ LỊCH SỬ CHAT ---
async function loadChatHistory() {
    const userId = myIdentity.userId;
    const partnerId = currentChat.partnerId;

    if (!userId || !partnerId) return;

    try {
        console.log("Đang tải lịch sử chat...");
        
        // Gọi API Backend
        const res = await fetch(`/api/chat/history/${userId}/${partnerId}`);
        const messages = await res.json();

        // Xóa tin nhắn chào mừng mặc định
        dom.messagesList.innerHTML = ''; 
        
        if (messages.length === 0) {
            dom.messagesList.innerHTML = '<div class="system-msg">Chưa có tin nhắn nào. Hãy bắt đầu cuộc trò chuyện!</div>';
            return;
        }

        // Lặp qua từng tin nhắn để giải mã
        for (const msg of messages) {
            try {
                // msg.encryptedContent và msg.iv là chuỗi Base64 từ DB
                const decryptedText = await decryptMessage(
                    { ciphertext: msg.encryptedContent, iv: msg.iv },
                    currentChat.sharedSecret
                );

                // Xác định chiều tin nhắn (Gửi hay Nhận)
                const type = (msg.sender === userId) ? 'sent' : 'received';
                
                // Hiển thị ra màn hình
                appendMessage(decryptedText, type);
            } catch (err) {
                console.error("Lỗi giải mã tin nhắn cũ:", err);
                appendMessage("[Không thể giải mã tin nhắn này]", 'received');
            }
        }
        
        // Cuộn xuống cuối cùng
        dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
        console.log(`Đã tải ${messages.length} tin nhắn.`);

    } catch (err) {
        console.error("Lỗi tải history:", err);
    }
}

// --- 6. QUẢN LÝ DANH SÁCH LIÊN HỆ ---

async function loadContacts() {
    try {
        const res = await fetch(`/api/chat/contacts/${myIdentity.userId}`);
        const contacts = await res.json();
        
        dom.contactsList.innerHTML = ''; // Xóa cũ
        contacts.forEach(user => {
            renderContactItem(user);
        });

    } catch (err) {
        console.error("Lỗi tải danh sách liên hệ:", err);
    }
}

function renderContactItem(user) {
    // Kiểm tra xem đã có trong list chưa (tránh trùng)
    if (document.querySelector(`.contact-item[data-id="${user._id}"]`)) return;

    const li = document.createElement('li');
    li.className = 'contact-item';
    li.dataset.id = user._id; // Lưu ID để tìm
    li.dataset.username = user.username;
    
    const onlineClass = user.online ? 'online' : '';

    li.innerHTML = `
            <div class="avatar">${user.username[0].toUpperCase()}</div>
            <div class="info">
                <span class="name">${user.username}</span>
                <span class="status-dot ${onlineClass}" id="status-${user._id}"></span>
            </div>
    `;

    // SỰ KIỆN CLICK: Bắt đầu chat với người này
    li.addEventListener('click', () => {
        // Highlight người đang chọn
        document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
        li.classList.add('active');

        // Điền vào ô tìm kiếm và kích hoạt quy trình Handshake
        dom.searchInput.value = user.username;
        startHandshake(user.username); // Hàm này mình tách ra bên dưới
    });

    dom.contactsList.appendChild(li);
}

function startHandshake(targetUsername) {
    if (!targetUsername) return;
    if (targetUsername === myIdentity.username) return alert("Không thể chat với mình");

    console.log(`Kết nối với: ${targetUsername}...`);
    socket.emit('request_public_key', { username: targetUsername });
}

// --- 7. XỬ LÝ TRẠNG THÁI ONLINE/OFFLINE ---

socket.on('user_status_change', (data) => {
    // data = { userId, status: 'online' | 'offline' }
    const dot = document.getElementById(`status-${data.userId}`);
    if (dot) {
        if (data.status === 'online') {
            dot.classList.add('online');
        } else {
            dot.classList.remove('online');
        }
    }
    updateHeaderStatus(data.userId);
});

const originalSocketResponse = socket.listeners('response_public_key')[0];

// 2. Xử lý logic Popup (Mở/Đóng khi click ra ngoài)
dom.btnRequests.addEventListener('click', (e) => {
    e.stopPropagation(); // Chặn sự kiện nổi bọt
    dom.reqPopup.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
    if (!dom.reqPopup.contains(e.target) && e.target !== dom.btnRequests) {
        dom.reqPopup.classList.add('hidden');
    }
});

// 3. THAY ĐỔI NÚT KẾT NỐI (Quan trọng)
// Thay vì gọi startHandshake ngay, ta gửi lời mời
dom.btnConnect.addEventListener('click', () => {
    const targetUsername = dom.searchInput.value.trim();
    if (!targetUsername) return;
    
    // Nếu đã có trong danh sách chat thì Handshake luôn (như cũ)
    const existingContact = document.querySelector(`.contact-item[data-username="${targetUsername}"]`);
    if (existingContact) {
        startHandshake(targetUsername);
    } else {
        // Nếu là người mới -> Gửi lời mời
        socket.emit('send_friend_request', { targetUsername });
        alert(`Đã gửi lời mời kết nối tới ${targetUsername}. Chờ họ chấp nhận nhé!`);
    }
});

// 4. XỬ LÝ SỰ KIỆN SOCKET MỚI

// A. Nhận lời mời từ người khác
socket.on('receive_friend_request', (data) => {
    // data = { fromUser, fromId }
    friendRequests.push(data);
    updateRequestUI();
    alert(`Bạn có lời mời kết nối mới từ ${data.fromUser}`);
});

// B. Bên kia đã chấp nhận -> Bắt đầu Handshake (Sửa lỗi mã hóa ở đây)
socket.on('request_accepted', (data) => {
    // data = { accepterName, notification }
    console.log(`${data.accepterName} đã chấp nhận!`);
    
    // Thêm vào danh sách thông báo client để hiện số đỏ ngay
    if (data.notification) {
        data.notification._id = 'temp_' + Date.now();
        notifications.unshift(data.notification); // Thêm vào đầu danh sách
        updateRequestUI();
    }

    startHandshake(data.accepterName);
});

// C. Tự mình chấp nhận -> Cũng bắt đầu Handshake
socket.on('start_handshake_init', (data) => {
    // data = { targetId, targetUsername }
    
    console.log("Đã chấp nhận kết bạn. Đang mở chat...");

    // 1. Ép hiển thị người đó lên Sidebar ngay lập tức (kể cả chưa có tin nhắn)
    // Giả định họ đang online vì vừa tương tác
    renderContactItem({ 
        _id: data.targetId, 
        username: data.targetUsername,
        online: true 
    });

    // 2. Tìm item vừa tạo và kích hoạt sự kiện Click để vào chat
    const item = document.querySelector(`.contact-item[data-id="${data.targetId}"]`);
    if (item) {
        item.click(); // Tự động click vào để mở chat
        
        // Cuộn thanh bên trái đến chỗ người đó (nếu danh sách dài)
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
});

// 5. Hàm cập nhật giao diện Popup
function updateRequestUI() {
    // Đảm bảo biến là mảng (tránh lỗi null/undefined)
    if (!friendRequests) friendRequests = [];
    if (!notifications) notifications = [];

    const totalCount = friendRequests.length + notifications.length;

    // Hiển thị số đỏ trên chuông
    if (totalCount > 0) {
        dom.reqCount.innerText = totalCount;
        dom.reqCount.classList.remove('hidden');
    } else {
        dom.reqCount.classList.add('hidden');
        dom.reqList.innerHTML = '<li class="empty-msg">Không có thông báo mới</li>';
        return;
    }

    dom.reqList.innerHTML = '';

    // A. VẼ LỜI MỜI (Ưu tiên hiện trước)
    friendRequests.forEach(req => {
        const li = document.createElement('li');
        li.className = 'req-item'; // Bạn có thể CSS thêm cho class này
        li.innerHTML = `
            <div style="flex:1">👋 <b>${req.fromUser}</b> mời kết bạn</div>
            <button class="btn-accept small-btn" style="background:#28a745; margin-left:5px">✔</button>
        `;

        // Xử lý nút Chấp nhận
        li.querySelector('.btn-accept').addEventListener('click', () => {
            socket.emit('accept_friend_request', { requesterId: req.fromId });
            // Xóa tạm khỏi UI
            friendRequests = friendRequests.filter(r => r.fromId !== req.fromId);
            updateRequestUI();
        });
        dom.reqList.appendChild(li);
    });

    // B. VẼ THÔNG BÁO (Hiện sau)
    notifications.forEach(notif => {
        const li = document.createElement('li');
        li.className = 'notif-item';
        li.style.borderLeft = "3px solid #0084ff"; // Đánh dấu khác biệt
        li.style.backgroundColor = "#f0f8ff";

        li.innerHTML = `
            <div style="flex:1; font-size:0.9em">${notif.content}</div>
            <button class="btn-clear small-btn" style="background:#999; margin-left:5px">✕</button>
        `;

        // Xử lý nút Xóa thông báo
        li.querySelector('.btn-clear').addEventListener('click', () => {
            if (notif._id) {
                socket.emit('clear_notification', { notifId: notif._id });
            }
            notifications = notifications.filter(n => n._id !== notif._id);
            updateRequestUI();
        });

        dom.reqList.appendChild(li);
    });
}

async function loadFriendRequests() {
    try {
        const res = await fetch(`/api/chat/requests/${myIdentity.userId}`);
        const data = await res.json();
        
        // Cập nhật biến toàn cục friendRequests
        if (Array.isArray(data)) {
            friendRequests = data;
            updateRequestUI(); // Vẽ lại giao diện (số đỏ, danh sách)
        }
    } catch (err) {
        console.error("Lỗi tải lời mời kết bạn:", err);
    }
}

async function loadNotifications() {
    try {
        const res = await fetch(`/api/chat/notifications/${myIdentity.userId}`);
        notifications = await res.json();
        updateRequestUI(); // Gọi lại hàm vẽ UI (ta sẽ sửa hàm này để vẽ cả 2)
    } catch (err) {
        console.error(err);
    }
}

// Chạy khởi tạo
initApp();