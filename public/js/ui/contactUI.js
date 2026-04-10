// public/js/ui/contactUI.js
// Render và quản lý sidebar contacts: danh bạ, badge, preview, notifications.

import { state }     from '../state.js';
import { dom }       from './dom.js';
import { authFetch } from '../utils.js';

let _socket = null; // được inject từ app.js
export function setSocket(s) { _socket = s; }

// Unread badges
export function setUnreadBadge(userId, count) {
    state.unreadCounts[userId] = count;
    const badge = document.getElementById(`unread-${userId}`);
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}
export const incrementUnreadBadge = (id) => setUnreadBadge(id, (state.unreadCounts[id] || 0) + 1);
export const resetUnreadBadge     = (id) => setUnreadBadge(id, 0);

// Preview text
export function updateContactPreview(userId) {
    const el = document.getElementById(`preview-${userId}`);
    if (el) el.textContent = 'Có tin nhắn mới';
}
export function clearContactPreview(userId) {
    const el = document.getElementById(`preview-${userId}`);
    if (el) el.textContent = '';
}
export function clearGroupPreview(groupId) {
    const el = document.getElementById(`group-preview-${groupId}`);
    if (el) el.textContent = '';
}

// Header status
export function updateHeaderStatus(userId) {
    if (state.currentChat.partnerId !== userId) return;
    const dot = document.getElementById(`status-${userId}`);
    const online = dot && dot.classList.contains('online');
    dom.partnerStatus.innerText = online ? 'Online' : 'Offline';
    dom.partnerStatus.classList.toggle('online', online);
}

// renderContactItem
export function renderContactItem(user) {
    if (document.querySelector(`.contact-item[data-id="${user._id}"]`)) return;

    const li = document.createElement('li');
    li.className        = 'contact-item';
    li.dataset.id       = user._id;
    li.dataset.username = user.username;
    li.dataset.status   = user.status   || 'accepted';
    li.dataset.isBlocker = user.isBlocker || false;

    // Context menu — append to body để tránh overflow clipping
    const menu = document.createElement('div');
    menu.id        = `menu-${user._id}`;
    menu.className = 'options-menu hidden';

    const btnBlock = document.createElement('button');
    btnBlock.className   = 'danger';
    btnBlock.textContent = '🚫 Chặn';
    btnBlock.addEventListener('click', (e) => handleBlock(e, user._id));

    const btnUnfriend = document.createElement('button');
    btnUnfriend.className   = 'danger';
    btnUnfriend.textContent = '❌ Hủy kết bạn';
    btnUnfriend.addEventListener('click', (e) => handleUnfriend(e, user._id));

    menu.appendChild(btnBlock);
    menu.appendChild(btnUnfriend);
    document.body.appendChild(menu);

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'avatar-container';
    avatar.innerHTML = `
        <div class="avatar">${user.username[0].toUpperCase()}</div>
        <div class="status-dot ${user.online ? 'online' : ''}" id="status-${user._id}"></div>`;

    // Info
    const info = document.createElement('div');
    info.className = 'contact-info';
    info.innerHTML = `
        <div class="contact-name">${user.username}</div>
        <div class="last-message" id="preview-${user._id}">Nhấn để chat</div>`;

    // Unread badge
    const badge = document.createElement('span');
    badge.className = 'unread-badge hidden';
    badge.id        = `unread-${user._id}`;
    if (user.unreadCount > 0) {
        badge.textContent = user.unreadCount > 99 ? '99+' : user.unreadCount;
        badge.classList.remove('hidden');
        state.unreadCounts[user._id] = user.unreadCount;
        const previewEl = info.querySelector('.last-message');
        if (previewEl) previewEl.textContent = 'Có tin nhắn mới';
    }

    // Options button
    const optionsBtn = document.createElement('button');
    optionsBtn.className   = 'contact-options-btn';
    optionsBtn.textContent = '⋮';
    optionsBtn.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        toggleMenu(e, optionsBtn, user._id);
    });

    li.appendChild(avatar);
    li.appendChild(info);
    li.appendChild(badge);
    li.appendChild(optionsBtn);

    li.addEventListener('click', async (e) => {
        if (e.target.closest('.contact-options-btn') || e.target.closest('.options-menu')) return;

        document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        dom.searchInput.value = user.username;

        const status    = li.dataset.status;
        const isBlocker = li.dataset.isBlocker === 'true';

        if (status === 'blocked') {
            dom.chatInputArea.classList.add('hidden');
            dom.blockOverlay.classList.remove('hidden');
            dom.chatHeader.classList.remove('hidden');
            dom.partnerName.innerText      = user.username;
            dom.messagesList.innerHTML     = '<div class="system-msg">Không thể lấy khóa E2EE do cuộc trò chuyện đã bị chặn.</div>';
            dom.blockTitle.innerText       = isBlocker
                ? `Bạn đã chặn tin nhắn từ ${user.username}`
                : 'Bạn không thể trả lời cuộc trò chuyện này';
            dom.btnUnblock.classList.toggle('hidden', !isBlocker);
            if (isBlocker) dom.btnUnblock.onclick = () => handleUnblock(user._id);
        } else {
            dom.chatInputArea.classList.remove('hidden');
            dom.blockOverlay.classList.add('hidden');
            const { startHandshake } = await import('../actions.js');
            startHandshake(user.username);
        }

        if (window.innerWidth <= 768) {
            dom.chatArea.classList.add('mobile-active');
            document.querySelector('.sidebar').classList.add('mobile-hidden');
            dom.btnBack.classList.remove('hidden');
            if (window.innerWidth <= 768) history.pushState({ chatOpen: true }, '');
        }
    });

    dom.contactsList.appendChild(li);
}

// Notification popup
export function updateRequestUI() {
    const total = state.friendRequests.length + state.notifications.length;
    if (total > 0) {
        dom.reqCount.innerText = total;
        dom.reqCount.classList.remove('hidden');
    } else {
        dom.reqCount.classList.add('hidden');
        dom.reqList.innerHTML = '<li class="empty-msg">Không có thông báo mới</li>';
        return;
    }

    dom.reqList.innerHTML = '';

    state.friendRequests.forEach(req => {
        const li = document.createElement('li');
        li.className = 'req-item';
        li.innerHTML = `<div style="flex:1">👋 <b>${req.fromUser}</b> mời kết bạn</div>
            <button class="btn-accept small-btn" style="background:#28a745;margin-left:5px">✔</button>`;
        li.querySelector('.btn-accept').addEventListener('click', () => {
            _socket?.emit('accept_friend_request', { requesterId: req.fromId });
            state.friendRequests = state.friendRequests.filter(r => r.fromId !== req.fromId);
            updateRequestUI();
        });
        dom.reqList.appendChild(li);
    });

    state.notifications.forEach(notif => {
        const li = document.createElement('li');
        li.className = 'notif-item';
        li.style.cssText = 'border-left:3px solid #0084ff;background:#f0f8ff';
        li.innerHTML = `<div style="flex:1;font-size:0.9em">${notif.content}</div>
            <button class="btn-clear small-btn" style="background:#999;margin-left:5px">✕</button>`;
        li.querySelector('.btn-clear').addEventListener('click', () => {
            if (notif._id) _socket?.emit('clear_notification', { notifId: notif._id });
            state.notifications = state.notifications.filter(n => n._id !== notif._id);
            updateRequestUI();
        });
        dom.reqList.appendChild(li);
    });
}

// Context menu (⋮)
export function toggleMenu(e, btn, id) {
    e.stopPropagation(); e.preventDefault();
    const menu   = document.getElementById(`menu-${id}`);
    if (!menu) return;
    const isOpen = !menu.classList.contains('hidden');
    document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));
    if (isOpen) return;

    menu.classList.remove('hidden');
    const r    = btn.getBoundingClientRect();
    const menuW = menu.offsetWidth || 140, menuH = menu.offsetHeight || 80;
    let top  = r.bottom + 4, left = r.right - menuW;
    if (top + menuH > window.innerHeight) top = r.top - menuH - 4;
    if (left < 8) left = 8;
    menu.style.top = `${top}px`; menu.style.left = `${left}px`;
}

// Block / Unblock / Unfriend
export async function handleUnfriend(e, targetId) {
    e.stopPropagation();
    if (!confirm('Bạn chắc chắn muốn hủy kết bạn?')) return;
    const res  = await authFetch('/api/chat/unfriend', { method: 'POST', body: JSON.stringify({ targetId }) });
    if (!res) return;
    const data = await res.json();
    if (data.success) {
        document.querySelector(`.contact-item[data-id="${targetId}"]`)?.remove();
        document.getElementById(`menu-${targetId}`)?.remove();
        if (state.currentChat.partnerId === targetId) {
            dom.chatHeader.classList.add('hidden');
            dom.messagesList.innerHTML = '';
        }
    }
}

export async function handleBlock(e, targetId) {
    e.stopPropagation();
    if (!confirm('Bạn chắc chắn muốn chặn người này?')) return;
    const res  = await authFetch('/api/chat/block', { method: 'POST', body: JSON.stringify({ targetId }) });
    if (!res) return;
    const data = await res.json();
    if (data.success) {
        _socket?.emit('notify_block', { targetId });
        const li = document.querySelector(`.contact-item[data-id="${targetId}"]`);
        if (li) {
            li.dataset.status    = 'blocked';
            li.dataset.isBlocker = 'true';
            document.querySelectorAll('.options-menu').forEach(el => el.classList.add('hidden'));
            li.click();
        }
    }
}

export async function handleUnblock(targetId) {
    const res  = await authFetch('/api/chat/unblock', { method: 'POST', body: JSON.stringify({ targetId }) });
    if (!res) return;
    const data = await res.json();
    if (data.success) {
        _socket?.emit('notify_unblock', { targetId });
        const li = document.querySelector(`.contact-item[data-id="${targetId}"]`);
        if (li) { li.dataset.status = 'accepted'; li.dataset.isBlocker = 'false'; li.click(); }
    }
}
