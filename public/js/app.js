// public/js/app.js
// Entry point — chỉ khởi tạo, kết nối các module, đăng ký event listeners DOM.
// Business logic KHÔNG nằm ở đây.

import { state }    from './state.js';
import { dom }      from './ui/dom.js';
import { logout, loadKeyFromDB } from './utils.js';
import { loadContacts, loadFriendRequests, loadNotifications, loadGroups } from './api.js';
import { updateRequestUI, setSocket as setContactSocket } from './ui/contactUI.js';
import { setSocket as setGroupSocket, openCreateGroupModal, submitCreateGroup, addSelectedMembers, loadManageModal } from './ui/groupUI.js';
import { setSocket as setActionsSocket, sendMessage, sendGroupMessage, startHandshake } from './actions.js';
import { registerDMSocketHandlers }    from './socket/dmSocket.js';
import { registerGroupSocketHandlers } from './socket/groupSocket.js';
import { cancelReply } from './ui/messageUI.js';

// ── Khởi tạo Socket.io ────────────────────────────────────────────────────
// eslint-disable-next-line no-undef
const socket = io();

// Inject socket vào các module cần dùng
setContactSocket(socket);
setGroupSocket(socket);
setActionsSocket(socket);

// Đăng ký tất cả socket event handlers
registerDMSocketHandlers(socket);
registerGroupSocketHandlers(socket);

// ════════════════════════════════════════════════════════════════════════════
// initApp — chạy một lần khi trang load
// ════════════════════════════════════════════════════════════════════════════
async function initApp() {
    const token    = localStorage.getItem('accessToken');
    const userId   = sessionStorage.getItem('userId');
    const username = sessionStorage.getItem('username');

    if (!token || !userId || !username) {
        window.location.href = '/login.html';
        return;
    }

    try {
        const privateKey = await loadKeyFromDB('my-private-key');
        if (!privateKey) throw new Error('Không tìm thấy Private Key');

        const signingPrivateKey = await loadKeyFromDB('my-signing-key');
        if (!signingPrivateKey) throw new Error('Không tìm thấy Signing Key');

        state.myIdentity = { userId, username, privateKey, signingPrivateKey };
        dom.myUsername.innerText   = username;
        dom.status.innerText       = '🟢 Online';
        dom.status.style.color     = 'green';

        socket.emit('join_user', userId);

        await loadContacts();
        await loadFriendRequests(updateRequestUI);
        await loadNotifications(updateRequestUI);
        await loadGroups(socket);

    } catch (err) {
        console.error(err);
        alert('Lỗi khởi tạo: ' + err.message);
        logout();
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Mobile navigation
// ════════════════════════════════════════════════════════════════════════════
function goBackToSidebar() {
    dom.chatArea.classList.remove('mobile-active');
    document.querySelector('.sidebar').classList.remove('mobile-hidden');
    dom.btnBack.classList.add('hidden');
}

window.addEventListener('popstate', () => {
    if (window.innerWidth > 768) return;
    goBackToSidebar();
});

// ════════════════════════════════════════════════════════════════════════════
// DOM Event Listeners
// ════════════════════════════════════════════════════════════════════════════

// ── Auth ──────────────────────────────────────────────────────────────────
dom.btnLogout.addEventListener('click', logout);

// ── Send message (DM hoặc Group) ──────────────────────────────────────────
dom.btnSend.addEventListener('click', () => {
    if (state.currentGroupId) sendGroupMessage();
    else                      sendMessage();
});
dom.msgInput.addEventListener('keypress', (e) => {
    if (e.key !== 'Enter') return;
    if (state.currentGroupId) sendGroupMessage();
    else                      sendMessage();
});

// ── Back (mobile) ─────────────────────────────────────────────────────────
dom.btnBack.addEventListener('click', () => { goBackToSidebar(); history.back(); });

// ── Search / Add contact ──────────────────────────────────────────────────
dom.btnConnect.addEventListener('click', () => {
    const targetUsername = dom.searchInput.value.trim();
    if (!targetUsername) return;
    const existing = document.querySelector(`.contact-item[data-username="${targetUsername}"]`);
    if (existing) startHandshake(targetUsername);
    else          socket.emit('send_friend_request', { targetUsername });
});

// ── Notification popup ────────────────────────────────────────────────────
dom.btnRequests.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.reqPopup.classList.toggle('hidden');
});

// ── Click outside → close menus ──────────────────────────────────────────
document.addEventListener('click', (e) => {
    if (!e.target.closest('.contact-options-btn') && !e.target.closest('.options-menu'))
        document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));
    if (!e.target.closest('.msg-action-btn') && !e.target.closest('.emoji-picker') && !e.target.closest('.msg-options-menu')) {
        document.getElementById('_emoji_picker')?.remove();
        document.getElementById('_msg_options_menu')?.remove();
    }
    if (!dom.reqPopup.contains(e.target) && e.target !== dom.btnRequests)
        dom.reqPopup.classList.add('hidden');
});

// ── Sidebar tabs ──────────────────────────────────────────────────────────
dom.tabFriends?.addEventListener('click', () => {
    dom.tabFriends.classList.add('active'); dom.tabGroups.classList.remove('active');
    dom.panelFriends.classList.remove('hidden'); dom.panelGroups.classList.add('hidden');
});
dom.tabGroups?.addEventListener('click', () => {
    dom.tabGroups.classList.add('active'); dom.tabFriends.classList.remove('active');
    dom.panelGroups.classList.remove('hidden'); dom.panelFriends.classList.add('hidden');
});

// ── Create Group Modal ────────────────────────────────────────────────────
dom.btnCreateGroup?.addEventListener('click', openCreateGroupModal);
document.getElementById('btn-close-create-group')?.addEventListener('click', () => dom.modalCreateGroup.classList.add('hidden'));
document.getElementById('btn-cancel-create-group')?.addEventListener('click', () => dom.modalCreateGroup.classList.add('hidden'));
document.getElementById('btn-submit-create-group')?.addEventListener('click', submitCreateGroup);
dom.modalCreateGroup?.addEventListener('click', (e) => { if (e.target === dom.modalCreateGroup) dom.modalCreateGroup.classList.add('hidden'); });

// ── Manage Group Modal ────────────────────────────────────────────────────
dom.btnManageGroup?.addEventListener('click', () => {
    const groupId = dom.btnManageGroup.dataset.groupId;
    if (groupId) { dom.modalManageGroup.classList.remove('hidden'); loadManageModal(groupId); }
});
document.getElementById('btn-close-manage-group')?.addEventListener('click',   () => dom.modalManageGroup.classList.add('hidden'));
document.getElementById('btn-close-manage-group-2')?.addEventListener('click', () => dom.modalManageGroup.classList.add('hidden'));
dom.modalManageGroup?.addEventListener('click', (e) => { if (e.target === dom.modalManageGroup) dom.modalManageGroup.classList.add('hidden'); });

document.getElementById('btn-leave-group')?.addEventListener('click', async () => {
    if (!state.currentGroupId) return;
    if (!confirm('Bạn có chắc muốn rời nhóm này?')) return;
    const res  = await (await import('./utils.js')).authFetch(`/api/groups/${state.currentGroupId}/leave`, { method: 'POST' });
    if (!res) return;
    const data = await res.json();
    if (data.success) {
        socket.emit('broadcast_group_left', { groupId: state.currentGroupId, leavingName: data.leavingName || state.myIdentity.username });
        document.querySelector(`.group-item[data-group-id="${state.currentGroupId}"]`)?.remove();
        state.groupKeys.delete(state.currentGroupId);
        state.currentGroupId = null;
        dom.modalManageGroup.classList.add('hidden');
        dom.btnManageGroup.classList.add('hidden');
        dom.messagesList.innerHTML = '<div class="system-msg">Bạn đã rời nhóm.</div>';
        dom.msgInput.disabled = true; dom.btnSend.disabled = true;
    }
});
document.getElementById('btn-add-member')?.addEventListener('click', addSelectedMembers);

// ── Khởi động ─────────────────────────────────────────────────────────────
initApp();
