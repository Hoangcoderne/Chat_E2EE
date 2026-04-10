// public/js/actions.js
// Các action do user trigger: gửi tin, xóa tin, reaction, forward, handshake.
// Tách khỏi UI để dễ test và tái sử dụng giữa DM và Group.

import { state }      from './state.js';
import { dom }        from './ui/dom.js';
import { authFetch }  from './utils.js';
import { appendMessage, clearEmptyState, cancelReply } from './ui/messageUI.js';
import { renderReactions } from './ui/messageUI.js';
import { encryptMessage, signMessage, decryptMessage } from './crypto/key-manager.js';
import { getGroupKey, encryptGroupKeyForMember }       from './crypto/groupCrypto.js';
import { decryptReplyTo } from './utils.js';

let _socket = null;
export function setSocket(s) { _socket = s; }

// ── startHandshake: emit request_public_key tới server ────────────────────
export function startHandshake(targetUsername) {
    if (!targetUsername) return;
    if (targetUsername === state.myIdentity.username) return alert('Không thể chat với mình');
    _socket?.emit('request_public_key', { username: targetUsername });
}

// ════════════════════════════════════════════════════════════════════════════
// DM: sendMessage
// ════════════════════════════════════════════════════════════════════════════
export async function sendMessage() {
    const text = dom.msgInput.value.trim();
    if (!text || !state.currentChat.sharedSecret) return;

    try {
        const signature     = await signMessage(text, state.myIdentity.signingPrivateKey);
        const encryptedData = await encryptMessage(text, state.currentChat.sharedSecret);

        let replyToPayload = null;
        if (state.currentReply) {
            const encReply = await encryptMessage(state.currentReply.plaintext, state.currentChat.sharedSecret);
            replyToPayload = {
                messageId:        state.currentReply.messageId,
                senderName:       state.currentReply.senderName,
                encryptedContent: encReply.ciphertext,
                iv:               encReply.iv,
            };
        }

        _socket?.emit('send_message', {
            recipientId:      state.currentChat.partnerId,
            encryptedContent: encryptedData.ciphertext,
            iv:               encryptedData.iv,
            signature,
            replyTo:          replyToPayload,
        });

        clearEmptyState();
        const replySnapshot = state.currentReply ? { ...state.currentReply } : null;
        cancelReply();
        appendMessage(text, 'sent', null, new Date(), null, true, [], state.currentGroupId, replySnapshot);
        dom.msgInput.value = '';
    } catch (err) {
        console.error('Lỗi gửi tin:', err);
        alert('Không thể mã hóa tin nhắn.');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Group: sendGroupMessage
// ════════════════════════════════════════════════════════════════════════════
export async function sendGroupMessage() {
    const text = dom.msgInput.value.trim();
    if (!text || !state.currentGroupId) return;

    const groupKey = state.groupKeys.get(state.currentGroupId);
    if (!groupKey) { alert('Chưa có khoá nhóm. Vui lòng thử lại.'); return; }

    try {
        const signature = await signMessage(text, state.myIdentity.signingPrivateKey);
        const encrypted = await encryptMessage(text, groupKey);

        let replyToPayload = null;
        if (state.currentReply) {
            const encReply = await encryptMessage(state.currentReply.plaintext, groupKey);
            replyToPayload = {
                messageId:        state.currentReply.messageId,
                senderName:       state.currentReply.senderName,
                encryptedContent: encReply.ciphertext,
                iv:               encReply.iv,
            };
        }

        _socket?.emit('send_group_message', {
            groupId:          state.currentGroupId,
            encryptedContent: encrypted.ciphertext,
            iv:               encrypted.iv,
            signature,
            replyTo:          replyToPayload,
        });

        clearEmptyState();
        const replySnapshot = state.currentReply ? { ...state.currentReply } : null;
        cancelReply();
        appendMessage(text, 'sent', null, new Date(), null, true, [], state.currentGroupId, replySnapshot);
        dom.msgInput.value = '';
    } catch (err) {
        console.error('sendGroupMessage error:', err);
        alert('Không thể gửi tin nhắn nhóm.');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Delete message
// ════════════════════════════════════════════════════════════════════════════
export async function doDeleteMessage(msgId, wrapper) {
    try {
        const groupId  = wrapper.dataset.groupId || null;
        const endpoint = groupId ? '/api/groups/message/delete' : '/api/chat/message/delete';
        const res      = await authFetch(endpoint, { method: 'POST', body: JSON.stringify({ messageId: msgId }) });
        if (!res) return;
        const data = await res.json();
        if (!data.success) return alert(data.message || 'Xoá thất bại');

        if (groupId) {
            _socket?.emit('broadcast_delete_group_message', { groupId, messageId: msgId });
        } else {
            _socket?.emit('broadcast_delete_message', { messageId: msgId, recipientId: data.recipientId });
        }
        wrapper.remove();
    } catch (err) {
        console.error('Delete error:', err);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Toggle reaction
// ════════════════════════════════════════════════════════════════════════════
export async function doToggleReaction(msgId, emoji, wrapper) {
    try {
        const isGroupMsg = !!state.currentGroupId;
        const endpoint   = isGroupMsg ? '/api/groups/message/reaction' : '/api/chat/message/reaction';
        const res        = await authFetch(endpoint, { method: 'POST', body: JSON.stringify({ messageId: msgId, emoji }) });
        if (!res) return;
        const data = await res.json();
        if (!data.success) return;

        const bar = wrapper.querySelector('.reaction-bar');
        if (bar) renderReactions(bar, data.reactions);

        if (isGroupMsg) {
            _socket?.emit('broadcast_group_reaction', { groupId: state.currentGroupId, messageId: msgId, reactions: data.reactions });
        } else {
            _socket?.emit('broadcast_reaction', { messageId: msgId, reactions: data.reactions, partnerId: data.partnerId });
        }
    } catch (err) {
        console.error('Reaction error:', err);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Forward
// ════════════════════════════════════════════════════════════════════════════
export async function doForwardMessage(text, targetId, targetUsername) {
    if (state.currentChat.partnerId === targetId && state.currentChat.sharedSecret) {
        const sig = await signMessage(text, state.myIdentity.signingPrivateKey);
        const enc = await encryptMessage(text, state.currentChat.sharedSecret);
        _socket?.emit('send_message', { recipientId: targetId, encryptedContent: enc.ciphertext, iv: enc.iv, signature: sig });
        appendMessage(text, 'sent', null, new Date(), null, true);
        return;
    }
    state.pendingForward = { text, targetId };
    startHandshake(targetUsername);
}

export async function doForwardToGroup(text, groupId) {
    const groupKey = await getGroupKey(groupId);
    if (!groupKey) return;
    try {
        const sig = await signMessage(text, state.myIdentity.signingPrivateKey);
        const enc = await encryptMessage(text, groupKey);
        _socket?.emit('send_group_message', { groupId, encryptedContent: enc.ciphertext, iv: enc.iv, signature: sig });
        if (state.currentGroupId === groupId) appendMessage(text, 'sent', null, new Date(), null, true);
    } catch (err) {
        console.error('Forward to group error:', err);
    }
}
