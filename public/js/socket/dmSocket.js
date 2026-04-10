// public/js/socket/dmSocket.js
// Tất cả Socket.io event handlers liên quan đến DM và presence.

import { state }       from '../state.js';
import { dom }         from '../ui/dom.js';
import { authFetch, decryptReplyTo } from '../utils.js';
import {
    appendMessage, clearEmptyState,
    renderReactions, cancelReply,
    updateLastMsgSeenList,
    showTypingIndicator, hideTypingIndicator,
} from '../ui/messageUI.js';
import {
    renderContactItem, updateRequestUI,
    incrementUnreadBadge, resetUnreadBadge,
    updateContactPreview, clearContactPreview,
    updateHeaderStatus,
} from '../ui/contactUI.js';
import {
    importPublicKey, deriveSharedSecret,
    decryptMessage, verifySignature, importSigningPublicKey,
    encryptMessage, signMessage,
} from '../crypto/key-manager.js';
import { loadChatHistory } from '../api.js';
import { startHandshake }  from '../actions.js';
import { notifyNewMessage, clearNotification } from '../ui/notificationUI.js';

export function registerDMSocketHandlers(socket) {

    // Kết nối lại sau ngắt mạng — cập nhật token mới nhất
    socket.on('connect', () => {
        socket.auth = { token: localStorage.getItem('accessToken') };

        const userId = sessionStorage.getItem('userId');
        if (!userId) return;
        socket.emit('join_user');
        const cachedGroupIds = JSON.parse(sessionStorage.getItem('myGroupIds') || '[]');
        if (cachedGroupIds.length) socket.emit('join_groups', cachedGroupIds);
    });

    // Handshake: nhận public key → derive shared secret
    socket.on('response_public_key', async (data) => {
        try {
            const { userId, publicKey, username, signingPublicKey } = data;
            const partnerKeyObj   = await importPublicKey(publicKey);
            const sharedKey       = await deriveSharedSecret(state.myIdentity.privateKey, partnerKeyObj);
            const partnerSigningKey = signingPublicKey ? await importSigningPublicKey(signingPublicKey) : null;

            state.currentChat = {
                partnerId:              userId,
                partnerPublicKey:       partnerKeyObj,
                partnerSigningPublicKey: partnerSigningKey,
                sharedSecret:           sharedKey,
            };
            state.currentGroupId = null;
            dom.btnManageGroup?.classList.add('hidden');
            dom.msgInput.placeholder = 'Nhập tin nhắn';

            cancelReply();
            updateHeaderStatus(userId);
            dom.chatHeader.classList.remove('hidden');
            dom.partnerName.innerText = username || dom.searchInput.value;
            dom.msgInput.disabled = false;
            dom.btnSend.disabled  = false;
            dom.messagesList.innerHTML = '<div class="system-msg">🔒 Đã thiết lập kênh E2EE.</div>';

            document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
            document.querySelector(`.contact-item[data-id="${userId}"]`)?.classList.add('active');

            clearNotification();
            await loadChatHistory(socket);
            resetUnreadBadge(userId);
            clearContactPreview(userId);

            // Gửi tin đang pending forward
            if (state.pendingForward && state.pendingForward.targetId === userId) {
                const { text } = state.pendingForward;
                state.pendingForward = null;
                const sig = await signMessage(text, state.myIdentity.signingPrivateKey);
                const enc = await encryptMessage(text, state.currentChat.sharedSecret);
                socket.emit('send_message', { recipientId: userId, encryptedContent: enc.ciphertext, iv: enc.iv, signature: sig });
                appendMessage(text, 'sent', null, new Date(), null, true);
            }
        } catch (err) {
            console.error('Lỗi Handshake:', err);
            alert('Lỗi thiết lập mã hóa.');
        }
    });

    // receive_message: nhận tin DM
    socket.on('receive_message', async (payload) => {
        updateContactPreview(payload.senderId);
        if (payload.senderId === state.currentChat.partnerId) {
            try {
                clearEmptyState();
                const decryptedText = await decryptMessage(
                    { ciphertext: payload.encryptedContent, iv: payload.iv },
                    state.currentChat.sharedSecret
                );
                let signatureValid = null;
                if (payload.signature && state.currentChat.partnerSigningPublicKey) {
                    signatureValid = await verifySignature(decryptedText, payload.signature, state.currentChat.partnerSigningPublicKey);
                }
                const replyTo = await decryptReplyTo(payload.replyTo, state.currentChat.sharedSecret);
                appendMessage(decryptedText, 'received', signatureValid, payload.timestamp, payload.messageId, false, [], null, replyTo);
                // Chỉ mark_read khi tab đang được focus
                if (!document.hidden) {
                    socket.emit('mark_read', { partnerId: payload.senderId });
                }
            } catch (_) {
                appendMessage('[Lỗi giải mã]', 'received', false);
            }
        } else {
            // Tin nhắn chờ — phát âm thanh + badge
            incrementUnreadBadge(payload.senderId);
            const contactEl  = document.querySelector(`.contact-item[data-id="${payload.senderId}"]`);
            const senderName = contactEl?.dataset.username || 'Tin nhắn mới';
            notifyNewMessage(senderName);
        }
    });

    // message_sent_sync: đồng bộ multi-device─
    socket.on('message_sent_sync', async (payload) => {
        const { senderSocketId, messageId, recipientId, encryptedContent, iv, timestamp, replyTo } = payload;
        if (senderSocketId === socket.id) {
            const tempEl = dom.messagesList.querySelector('[data-temp="true"]');
            if (tempEl) { tempEl.removeAttribute('data-temp'); tempEl.dataset.msgId = messageId; }
            return;
        }
        updateContactPreview(recipientId);
        if (state.currentChat.partnerId === recipientId && state.currentChat.sharedSecret) {
            try {
                const text            = await decryptMessage({ ciphertext: encryptedContent, iv }, state.currentChat.sharedSecret);
                const replyToDecrypted = await decryptReplyTo(replyTo, state.currentChat.sharedSecret);
                appendMessage(text, 'sent', null, timestamp, messageId, false, [], null, replyToDecrypted);
            } catch (_) {
                appendMessage('[Tin nhắn từ thiết bị khác]', 'system');
            }
        }
    });

    // messages_read: đối tác đã đọc tin
    socket.on('messages_read', ({ by }) => {
        if (!state.currentChat.partnerId || state.currentChat.partnerId !== by) return;
        if (state.currentGroupId) return;
        document.querySelectorAll('.msg-wrapper .msg-status').forEach(el => {
            el.textContent = '✓✓'; el.classList.add('read');
        });
    });

    // Khi user quay lại tab → mark_read nếu đang trong đoạn chat
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && state.currentChat.partnerId) {
            socket.emit('mark_read', { partnerId: state.currentChat.partnerId });
        }
        if (!document.hidden && state.currentGroupId) {
            socket.emit('mark_group_read', { groupId: state.currentGroupId });
        }
    });

    // Typing indicator (DM)
    socket.on('user_typing', ({ userId }) => {
        if (state.currentChat.partnerId !== userId) return;
        const name = dom.partnerName.innerText || 'Đối phương';
        showTypingIndicator(name);
    });

    socket.on('user_stop_typing', ({ userId }) => {
        if (state.currentChat.partnerId !== userId) return;
        hideTypingIndicator();
    });

    // user_status_change
    socket.on('user_status_change', ({ userId, status }) => {
        const dot = document.getElementById(`status-${userId}`);
        if (dot) dot.classList.toggle('online', status === 'online');
        updateHeaderStatus(userId);
    });

    // Friend events
    socket.on('receive_friend_request', (data) => {
        state.friendRequests.push(data);
        updateRequestUI();
    });

    socket.on('request_accepted', (data) => {
        if (data.notification) {
            data.notification._id = 'temp_' + Date.now();
            state.notifications.unshift(data.notification);
            updateRequestUI();
        }
        renderContactItem({ _id: data.accepterId, username: data.accepterName, online: true });
        startHandshake(data.accepterName);
    });

    socket.on('start_handshake_init', (data) => {
        renderContactItem({ _id: data.targetId, username: data.targetUsername, online: true });
        const item = document.querySelector(`.contact-item[data-id="${data.targetId}"]`);
        if (item) { item.click(); item.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });

    socket.on('request_sent_success', (msg) => {
        state.notifications.unshift({ _id: 'temp_' + Date.now(), content: msg });
        updateRequestUI();
    });

    // Block events
    socket.on('you_have_been_blocked', ({ blockerId }) => {
        const li = document.querySelector(`.contact-item[data-id="${blockerId}"]`);
        if (li) {
            li.dataset.status = 'blocked'; li.dataset.isBlocker = 'false';
            if (state.currentChat.partnerId === blockerId) li.click();
        }
    });

    socket.on('you_have_been_unblocked', ({ unblockerId }) => {
        const li = document.querySelector(`.contact-item[data-id="${unblockerId}"]`);
        if (li) {
            li.dataset.status = 'accepted'; li.dataset.isBlocker = 'false';
            if (state.currentChat.partnerId === unblockerId) li.click();
        }
    });

    // Generic events
    socket.on('system_message', ({ text }) => appendMessage(text, 'system'));

    socket.on('message_deleted', ({ messageId }) => {
        document.querySelector(`.msg-wrapper[data-msg-id="${messageId}"]`)?.remove();
    });

    socket.on('reaction_updated', ({ messageId, reactions }) => {
        const bar = document.querySelector(`.msg-wrapper[data-msg-id="${messageId}"] .reaction-bar`);
        if (bar) renderReactions(bar, reactions);
    });

    socket.on('error', (msg) => alert(msg));
}
