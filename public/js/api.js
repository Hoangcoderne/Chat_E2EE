// public/js/api.js
// Tập trung tất cả API calls (HTTP fetch) theo domain.
// Socket events KHÔNG nằm ở đây — xem socket/dmSocket.js và socket/groupSocket.js.

import { state }      from './state.js';
import { authFetch }  from './utils.js';
import { dom }        from './ui/dom.js';
import { renderContactItem }            from './ui/contactUI.js';
import { renderGroupItem }              from './ui/groupUI.js';
import { appendMessage }                from './ui/messageUI.js';
import { resetUnreadBadge, clearContactPreview } from './ui/contactUI.js';
import { decryptMessage, verifySignature }       from './crypto/key-manager.js';
import { decryptReplyTo }               from './utils.js';
import { getGroupKey }                  from './crypto/groupCrypto.js';

// ── Contacts ──────────────────────────────────────────────────────────────
export async function loadContacts() {
    try {
        const res = await authFetch('/api/chat/contacts');
        if (!res) return;
        const contacts = await res.json();
        dom.contactsList.innerHTML = '';
        contacts.forEach(user => renderContactItem(user));
    } catch (err) {
        console.error('Lỗi tải contacts:', err);
    }
}

// ── DM chat history ───────────────────────────────────────────────────────
export async function loadChatHistory(socket) {
    const { userId }               = state.myIdentity;
    const { partnerId, sharedSecret, partnerSigningPublicKey } = state.currentChat;
    if (!userId || !partnerId) return;

    try {
        const res = await authFetch(`/api/chat/history/${partnerId}`);
        if (!res) return;

        const messages = await res.json();
        dom.messagesList.innerHTML = '';

        if (messages.length === 0) {
            dom.messagesList.innerHTML = '<div class="system-msg empty-state-msg">Chưa có tin nhắn nào.</div>';
            return;
        }

        for (const msg of messages) {
            try {
                const decryptedText = await decryptMessage(
                    { ciphertext: msg.encryptedContent, iv: msg.iv },
                    sharedSecret
                );
                const type = msg.sender.toString() === userId ? 'sent' : 'received';

                let signatureValid = null;
                if (msg.signature && type === 'received' && partnerSigningPublicKey) {
                    signatureValid = await verifySignature(decryptedText, msg.signature, partnerSigningPublicKey);
                }

                const replyTo = await decryptReplyTo(msg.replyTo, sharedSecret);
                appendMessage(decryptedText, type, signatureValid, msg.timestamp, msg._id, false, msg.reactions || [], null, replyTo);

                if (type === 'sent' && msg.read) {
                    const statusEl = dom.messagesList.lastElementChild?.querySelector('.msg-status');
                    if (statusEl) { statusEl.textContent = '✓✓'; statusEl.classList.add('read'); }
                }
            } catch (_) {
                appendMessage('[Tin nhắn lỗi]', 'received', false, msg.timestamp);
            }
        }

        dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
        socket.emit('mark_read', { partnerId });
        resetUnreadBadge(partnerId);
        clearContactPreview(partnerId);
    } catch (err) {
        console.error('Lỗi tải history:', err);
    }
}

// ── Friend requests ───────────────────────────────────────────────────────
export async function loadFriendRequests(updateRequestUI) {
    try {
        const res = await authFetch('/api/chat/requests');
        if (!res) return;
        const data = await res.json();
        if (Array.isArray(data)) {
            state.friendRequests = data;
            updateRequestUI();
        }
    } catch (err) { console.error(err); }
}

// ── Notifications ─────────────────────────────────────────────────────────
export async function loadNotifications(updateRequestUI) {
    try {
        const res = await authFetch('/api/chat/notifications');
        if (!res) return;
        state.notifications = await res.json();
        updateRequestUI();
    } catch (err) { console.error(err); }
}

// ── Groups ────────────────────────────────────────────────────────────────
export async function loadGroups(socket) {
    try {
        const res = await authFetch('/api/groups');
        if (!res) return;
        const groups = await res.json();

        sessionStorage.setItem('myGroupIds', JSON.stringify(groups.map(g => g._id)));
        socket.emit('join_groups', groups.map(g => g._id));

        dom.groupsList.innerHTML = '';
        groups.forEach(g => renderGroupItem(g));
    } catch (err) {
        console.error('loadGroups error:', err);
    }
}

// ── Group history ─────────────────────────────────────────────────────────
export async function loadGroupHistory(groupId, socket) {
    try {
        const res = await authFetch(`/api/groups/${groupId}/history`);
        if (!res) return;
        const messages = await res.json();

        dom.messagesList.innerHTML = '';
        if (messages.length === 0) {
            dom.messagesList.innerHTML = '<div class="system-msg empty-state-msg">Chưa có tin nhắn nào trong nhóm.</div>';
            return;
        }

        const groupKey = await getGroupKey(groupId);
        if (!groupKey) return;

        for (const msg of messages) {
            try {
                if (msg.type === 'system' && msg.systemText) {
                    // Import appendGroupSystemMessage lazily để tránh circular
                    const { appendGroupSystemMessage } = await import('./ui/messageUI.js');
                    appendGroupSystemMessage(msg.systemText);
                    continue;
                }
                const text   = await decryptMessage({ ciphertext: msg.encryptedContent, iv: msg.iv }, groupKey);
                const isMine = msg.sender._id === state.myIdentity.userId || msg.sender._id?.toString() === state.myIdentity.userId;
                const type   = isMine ? 'sent' : 'received';
                const replyToDecrypted = await decryptReplyTo(msg.replyTo, groupKey);
                const wrapper = appendMessage(text, type, null, msg.timestamp, msg._id, false, msg.reactions || [], groupId, replyToDecrypted);

                if (!isMine && wrapper) {
                    const label = document.createElement('div');
                    label.className   = 'group-sender-label';
                    label.textContent = msg.sender.username || '';
                    wrapper.insertBefore(label, wrapper.firstChild);
                }
                if (isMine && wrapper && msg.readBy) {
                    const { renderSeenListFromHistory } = await import('./ui/messageUI.js');
                    renderSeenListFromHistory(wrapper, msg.readBy, state.myIdentity.userId);
                }
            } catch (_) {
                appendMessage('[Lỗi giải mã]', 'system');
            }
        }

        dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
        socket.emit('mark_group_read', { groupId });
    } catch (err) {
        console.error('loadGroupHistory error:', err);
    }
}
