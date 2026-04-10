// public/js/socket/groupSocket.js
// Tất cả Socket.io event handlers liên quan đến nhóm chat.

import { state }      from '../state.js';
import { dom }        from '../ui/dom.js';
import { authFetch, decryptReplyTo } from '../utils.js';
import {
    appendMessage, appendGroupSystemMessage,
    clearEmptyState, renderReactions,
    renderSeenListFromHistory, updateLastMsgSeenList,
    showTypingIndicator, hideTypingIndicator,
} from '../ui/messageUI.js';
import { renderGroupItem, openGroupChat, loadManageModal } from '../ui/groupUI.js';
import { getGroupKey } from '../crypto/groupCrypto.js';
import { decryptMessage } from '../crypto/key-manager.js';
import { notifyNewMessage, clearNotification } from '../ui/notificationUI.js';

export function registerGroupSocketHandlers(socket) {

    // receive_group_message
    socket.on('receive_group_message', async (payload) => {
        const { groupId, senderId, senderName, encryptedContent, iv, reactions, timestamp, messageId, replyTo } = payload;

        const previewEl = document.getElementById(`group-preview-${groupId}`);
        if (previewEl) previewEl.textContent = `${senderName}: tin nhắn mới`;

        if (state.currentGroupId !== groupId) {
            // Tin nhắn chờ — phát âm thanh + badge
            const badge = document.getElementById(`unread-group-${groupId}`);
            if (badge) {
                const cur = parseInt(badge.textContent) || 0;
                badge.textContent = cur + 1 > 99 ? '99+' : cur + 1;
                badge.classList.remove('hidden');
            }
            notifyNewMessage(senderName);
            return;
        }

        try {
            clearEmptyState();
            const groupKey = await getGroupKey(groupId);
            const text     = await decryptMessage({ ciphertext: encryptedContent, iv }, groupKey);
            const replyToDecrypted = await decryptReplyTo(replyTo, groupKey);
            const wrapper  = appendMessage(text, 'received', null, timestamp, messageId, false, reactions || [], groupId, replyToDecrypted);
            if (wrapper) {
                const label = document.createElement('div');
                label.className   = 'group-sender-label';
                label.textContent = senderName;
                wrapper.insertBefore(label, wrapper.firstChild);
            }
            // Chỉ mark_group_read khi tab đang được focus
            if (!document.hidden) {
                socket.emit('mark_group_read', { groupId });
            }
        } catch (_) {
            appendMessage('[Lỗi giải mã]', 'system');
        }
    });

    // group_message_sent_sync: multi-device sync
    socket.on('group_message_sent_sync', async (payload) => {
        if (payload.senderSocketId === socket.id) {
            const tempEl = dom.messagesList.querySelector('[data-temp="true"]');
            if (tempEl) { tempEl.removeAttribute('data-temp'); tempEl.dataset.msgId = payload.messageId; }
            return;
        }
        if (state.currentGroupId === payload.groupId) {
            const groupKey = await getGroupKey(payload.groupId);
            const text     = await decryptMessage({ ciphertext: payload.encryptedContent, iv: payload.iv }, groupKey);
            appendMessage(text, 'sent', null, payload.timestamp, payload.messageId);
        }
    });

    // group_invited: được thêm vào nhóm mới
    socket.on('group_invited', async ({ groupId, groupName, memberCount }) => {
        socket.emit('join_groups', [groupId]);

        const res = await authFetch('/api/groups');
        if (!res) return;
        const groups   = await res.json();
        const newGroup = groups.find(g => g._id?.toString() === groupId?.toString());
        if (!newGroup) return;

        const cached = JSON.parse(sessionStorage.getItem('myGroupIds') || '[]');
        if (!cached.includes(groupId)) { cached.push(groupId); sessionStorage.setItem('myGroupIds', JSON.stringify(cached)); }

        if (!document.querySelector(`.group-item[data-group-id="${groupId}"]`)) renderGroupItem(newGroup);
        dom.tabGroups?.click();

        if (state.currentGroupId !== groupId) {
            const toast = document.createElement('div');
            toast.className   = 'group-invite-toast';
            toast.textContent = `🎉 Bạn đã được thêm vào nhóm "${groupName}"`;
            toast.addEventListener('click', () => { toast.remove(); openGroupChat(newGroup); });
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 5000);
        }
    });

    // group_read_update: member khác đã đọc
    socket.on('group_read_update', ({ groupId, userId, username }) => {
        if (state.currentGroupId !== groupId) return;
        updateLastMsgSeenList(username);
    });

    // group_kicked: bị xóa khỏi nhóm
    socket.on('group_kicked', ({ groupId }) => {
        document.querySelector(`.group-item[data-group-id="${groupId}"]`)?.remove();
        if (state.currentGroupId === groupId) {
            state.currentGroupId = null;
            dom.messagesList.innerHTML = '<div class="system-msg">Bạn đã bị xoá khỏi nhóm này.</div>';
            dom.msgInput.disabled = true; dom.btnSend.disabled = true;
            dom.btnManageGroup?.classList.add('hidden');
        }
    });

    // group_member_added: thành viên mới tham gia─
    socket.on('group_member_added', ({ groupId, memberCount, newMemberNames }) => {
        const previewEl = document.getElementById(`group-preview-${groupId}`);
        if (previewEl && memberCount) previewEl.textContent = `${memberCount} thành viên`;

        if (state.currentGroupId === groupId) {
            if (memberCount) dom.partnerStatus.innerText = `${memberCount} thành viên`;
            (newMemberNames || []).forEach(name => appendGroupSystemMessage(`${name} đã tham gia nhóm`));
            if (!dom.modalManageGroup.classList.contains('hidden')) loadManageModal(groupId);
        }
    });

    // group_member_removed: thành viên rời/bị xóa
    socket.on('group_member_removed', ({ groupId, removedUserId, removedName, leavingName }) => {
        authFetch(`/api/groups/${groupId}/info`).then(async res => {
            if (!res) return;
            const g = await res.json();
            const previewEl = document.getElementById(`group-preview-${groupId}`);
            if (previewEl) previewEl.textContent = `${g.members?.length || 0} thành viên`;
        });

        if (state.currentGroupId === groupId && removedUserId !== state.myIdentity.userId) {
            const systemText = leavingName
                ? `${leavingName} đã rời khỏi nhóm`
                : `${removedName || 'Thành viên'} đã bị xóa khỏi nhóm`;
            appendGroupSystemMessage(systemText);

            authFetch(`/api/groups/${groupId}/info`).then(async res => {
                if (!res) return;
                const g = await res.json();
                dom.partnerStatus.innerText = `${g.members?.length || 0} thành viên`;
            });
            if (!dom.modalManageGroup.classList.contains('hidden')) loadManageModal(groupId);
        }
    });

    // Group typing indicator
    const groupTypers = new Map(); // Map<userId, username>
    let groupTypingTimer = null;

    function updateGroupTypingUI() {
        if (groupTypers.size === 0) { hideTypingIndicator(); return; }
        const names = [...groupTypers.values()];
        const label = names.length === 1
            ? names[0]
            : names.slice(0, 2).join(', ') + (names.length > 2 ? ` và ${names.length - 2} người khác` : '');
        showTypingIndicator(label);
    }

    socket.on('group_user_typing', ({ userId, username }) => {
        if (state.currentGroupId === null) return;
        groupTypers.set(userId, username);
        updateGroupTypingUI();
    });

    socket.on('group_user_stop_typing', ({ userId }) => {
        groupTypers.delete(userId);
        updateGroupTypingUI();
    });
}
