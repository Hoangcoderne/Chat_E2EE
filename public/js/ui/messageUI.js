// public/js/ui/messageUI.js
// Tất cả logic render tin nhắn: bubble, reactions, emoji picker,
// message menu, reply bar, forward modal, seen list.

import { state }     from '../state.js';
import { dom }       from './dom.js';
import { authFetch } from '../utils.js';
import { formatTime } from '../utils.js';

// appendMessage — render một tin nhắn vào danh sách
export function appendMessage(
    text, type,
    signatureValid = null,
    timestamp      = null,
    msgId          = null,
    isTemp         = false,
    reactions      = [],
    groupId        = null,
    replyTo        = null
) {
    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${type === 'sent' ? 'wrapper-sent' : type === 'system' ? 'wrapper-system' : 'wrapper-received'}`;

    if (msgId)   wrapper.dataset.msgId   = msgId;
    if (isTemp)  wrapper.dataset.temp    = 'true';
    if (groupId) wrapper.dataset.groupId = groupId;
    if (text && type !== 'system') wrapper.dataset.plaintext = text;

    // Bubble
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

        // Reply quote
        if (replyTo?.plaintext && type !== 'system') {
            const quote = document.createElement('div');
            quote.className = 'reply-quote';

            const quoteName = document.createElement('div');
            quoteName.className   = 'reply-quote-name';
            quoteName.textContent = replyTo.senderName || '';

            const quoteText = document.createElement('div');
            quoteText.className   = 'reply-quote-text';
            quoteText.textContent = replyTo.plaintext.length > 80
                ? replyTo.plaintext.slice(0, 80) + '…'
                : replyTo.plaintext;

            quote.appendChild(quoteName);
            quote.appendChild(quoteText);

            if (replyTo.messageId) {
                quote.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const target = dom.messagesList.querySelector(`[data-msg-id="${replyTo.messageId}"]`);
                    if (target) {
                        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        target.classList.add('msg-highlight');
                        setTimeout(() => target.classList.remove('msg-highlight'), 1500);
                    }
                });
            }
            div.appendChild(quote);
        }

        div.appendChild(document.createTextNode(text));
    }

    // Action buttons (chỉ cho tin thường)
    if (type !== 'system' && signatureValid !== false) {
        const actions = document.createElement('div');
        actions.className = `msg-actions ${type === 'sent' ? 'actions-sent' : 'actions-received'}`;

        const emojiBtn = document.createElement('button');
        emojiBtn.className = 'msg-action-btn';
        emojiBtn.title     = 'Cảm xúc';
        emojiBtn.textContent = '😊';
        emojiBtn.addEventListener('click', (e) => { e.stopPropagation(); showEmojiPicker(e, wrapper); });

        const moreBtn = document.createElement('button');
        moreBtn.className = 'msg-action-btn';
        moreBtn.title     = 'Tùy chọn';
        moreBtn.textContent = '⋯';
        moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showMsgMenu(e, wrapper, type); });

        if (type === 'sent') { actions.appendChild(moreBtn); actions.appendChild(emojiBtn); }
        else                 { actions.appendChild(emojiBtn); actions.appendChild(moreBtn); }

        const row = document.createElement('div');
        row.className = `msg-row ${type === 'sent' ? 'row-sent' : 'row-received'}`;
        row.appendChild(actions);
        row.appendChild(div);
        wrapper.appendChild(row);
    } else {
        wrapper.appendChild(div);
    }

    // Reaction bar
    const reactionBar = document.createElement('div');
    reactionBar.className = `reaction-bar ${type === 'sent' ? 'rbar-sent' : 'rbar-received'}`;
    renderReactions(reactionBar, reactions);
    wrapper.appendChild(reactionBar);

    // Meta (timestamp + status)
    if (type !== 'system') {
        const meta = document.createElement('div');
        meta.className = `msg-meta ${type === 'sent' ? 'meta-sent' : 'meta-received'}`;

        const timeEl = document.createElement('span');
        timeEl.className   = 'msg-time';
        timeEl.textContent = formatTime(timestamp || new Date());
        meta.appendChild(timeEl);

        if (type === 'sent') {
            if (groupId) {
                const seenList = document.createElement('div');
                seenList.className = 'group-seen-list';
                meta.appendChild(seenList);
            } else {
                const statusEl = document.createElement('span');
                statusEl.className   = 'msg-status';
                statusEl.textContent = '✓';
                meta.appendChild(statusEl);
            }
        }
        wrapper.appendChild(meta);
    }

    dom.messagesList.appendChild(wrapper);
    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
    return wrapper;
}

// clearEmptyState
export function clearEmptyState() {
    dom.messagesList.querySelectorAll('.empty-state-msg').forEach(el => el.remove());
}

// appendGroupSystemMessage
export function appendGroupSystemMessage(text) {
    clearEmptyState();
    const div = document.createElement('div');
    div.className   = 'group-system-event';
    div.textContent = text;
    dom.messagesList.appendChild(div);
    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
}

// Reactions
export function renderReactions(bar, reactions) {
    bar.innerHTML = '';
    if (!reactions || reactions.length === 0) return;

    const groups = {};
    reactions.forEach(r => { if (!groups[r.emoji]) groups[r.emoji] = []; groups[r.emoji].push(r.userId); });

    Object.entries(groups).forEach(([emoji, users]) => {
        const pill = document.createElement('span');
        pill.className = 'reaction-pill';
        if (users.some(uid => uid === state.myIdentity.userId || uid.toString() === state.myIdentity.userId))
            pill.classList.add('my-reaction');
        pill.textContent = emoji + (users.length > 1 ? ' ' + users.length : '');
        pill.title       = users.length + ' người';
        bar.appendChild(pill);
    });
}

// Emoji picker
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

export function showEmojiPicker(e, wrapper) {
    closeAllPopups();
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker.id        = '_emoji_picker';

    EMOJIS.forEach(em => {
        const btn = document.createElement('button');
        btn.className   = 'emoji-option';
        btn.textContent = em;
        btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            picker.remove();
            const msgId = wrapper.dataset.msgId;
            if (!msgId) return;
            // Import dynamically to avoid circular at module load
            const { doToggleReaction } = await import('../actions.js');
            await doToggleReaction(msgId, em, wrapper);
        });
        picker.appendChild(btn);
    });

    picker.style.cssText = 'position:fixed;visibility:hidden';
    document.body.appendChild(picker);

    const r = e.currentTarget.getBoundingClientRect();
    const pw = picker.offsetWidth, ph = picker.offsetHeight, mg = 6, pad = 8;
    let top  = r.top - ph - mg;
    let left = r.left + r.width / 2 - pw / 2;
    if (top < pad)                            top  = r.bottom + mg;
    if (left < pad)                           left = pad;
    if (left + pw > window.innerWidth - pad)  left = window.innerWidth - pw - pad;

    picker.style.top        = `${top}px`;
    picker.style.left       = `${left}px`;
    picker.style.visibility = '';
}

// Message options menu (⋯)
export function showMsgMenu(e, wrapper, type) {
    closeAllPopups();
    const msgId    = wrapper.dataset.msgId;
    const isSender = type === 'sent';

    const menu = document.createElement('div');
    menu.className = 'msg-options-menu';
    menu.id        = '_msg_options_menu';

    const replyBtn = document.createElement('button');
    replyBtn.textContent = '↩ Trả lời';
    replyBtn.addEventListener('click', () => { menu.remove(); setReply(wrapper); });
    menu.appendChild(replyBtn);

    const fwdBtn = document.createElement('button');
    fwdBtn.textContent = '↪ Chuyển tiếp';
    fwdBtn.addEventListener('click', async () => {
        menu.remove();
        const { showForwardModal } = await import('./forwardModal.js');
        showForwardModal(wrapper);
    });
    menu.appendChild(fwdBtn);

    if (isSender && msgId) {
        const delBtn = document.createElement('button');
        delBtn.className   = 'danger';
        delBtn.textContent = '🗑 Gỡ tin nhắn';
        delBtn.addEventListener('click', async () => {
            menu.remove();
            if (!confirm('Xoá tin nhắn này? Hành động không thể hoàn tác.')) return;
            const { doDeleteMessage } = await import('../actions.js');
            await doDeleteMessage(msgId, wrapper);
        });
        menu.appendChild(delBtn);
    }

    const r = e.currentTarget.getBoundingClientRect();
    menu.style.cssText = `position:fixed;top:${r.bottom + 4}px;left:${Math.max(8, r.right - 160)}px`;
    document.body.appendChild(menu);
}

export function closeAllPopups() {
    document.getElementById('_emoji_picker')?.remove();
    document.getElementById('_msg_options_menu')?.remove();
    document.getElementById('_forward_modal')?.remove();
}

// Reply bar
export function setReply(wrapper) {
    const plaintext = wrapper.dataset.plaintext;
    const msgId     = wrapper.dataset.msgId;
    if (!plaintext) return;

    let senderName;
    const senderLabel = wrapper.querySelector('.group-sender-label');
    if (senderLabel)                                senderName = senderLabel.textContent;
    else if (wrapper.classList.contains('wrapper-sent')) senderName = state.myIdentity.username;
    else                                            senderName = dom.partnerName.innerText.replace('👥 ', '');

    state.currentReply = { messageId: msgId, senderName, plaintext };
    showReplyBar();
    dom.msgInput.focus();
}

export function showReplyBar() {
    const bar = document.getElementById('reply-bar');
    if (!bar) return;

    const name    = state.currentReply.senderName || '';
    const preview = state.currentReply.plaintext.length > 80
        ? state.currentReply.plaintext.slice(0, 80) + '…'
        : state.currentReply.plaintext;

    bar.innerHTML = `
        <div class="reply-bar-content">
            <div class="reply-bar-line"></div>
            <div class="reply-bar-text">
                <span class="reply-bar-name"></span>
                <span class="reply-bar-preview"></span>
            </div>
        </div>
        <button class="reply-bar-close" title="Huỷ reply">✕</button>`;
    bar.querySelector('.reply-bar-name').textContent    = name;
    bar.querySelector('.reply-bar-preview').textContent = preview;
    bar.querySelector('.reply-bar-close').addEventListener('click', cancelReply);
    bar.classList.remove('hidden');
}

export function cancelReply() {
    state.currentReply = null;
    const bar = document.getElementById('reply-bar');
    if (bar) bar.classList.add('hidden');
}

// Seen list (group)
export function updateLastMsgSeenList(username) {
    const sentWrappers = [...dom.messagesList.querySelectorAll('.msg-wrapper.wrapper-sent')];
    if (!sentWrappers.length) return;
    const seenList = sentWrappers[sentWrappers.length - 1].querySelector('.group-seen-list');
    if (!seenList || seenList.querySelector(`[data-user="${username}"]`)) return;

    const existing = [...seenList.querySelectorAll('[data-user]')].map(el => el.dataset.user);
    existing.push(username);
    renderSeenList(seenList, existing);
    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
}

export function renderSeenList(container, users) {
    if (!users || users.length === 0) { container.innerHTML = ''; return; }
    const isExpanded = container.dataset.expanded === 'true';
    const MAX_SHOWN  = 3;
    container.innerHTML = '';

    const eye = document.createElement('span');
    eye.className = 'seen-eye'; eye.textContent = '👁';
    container.appendChild(eye);

    const shown    = isExpanded ? users : users.slice(0, MAX_SHOWN);
    const overflow = users.length - MAX_SHOWN;

    shown.forEach(uname => {
        const chip = document.createElement('span');
        chip.className = 'seen-chip'; chip.dataset.user = uname;
        chip.title = uname; chip.textContent = uname[0].toUpperCase();
        container.appendChild(chip);
    });

    if (!isExpanded && overflow > 0) {
        const more = document.createElement('span');
        more.className = 'seen-chip seen-more'; more.textContent = `+${overflow}`;
        container.appendChild(more);
    }

    if (users.length > MAX_SHOWN) {
        container.style.cursor = 'pointer';
        container.onclick = (e) => {
            e.stopPropagation();
            container.dataset.expanded = isExpanded ? 'false' : 'true';
            renderSeenList(container, users);
        };
    } else {
        container.style.cursor = 'default';
        container.onclick = null;
    }
}

export function renderSeenListFromHistory(wrapper, readBy, senderId) {
    const seenList = wrapper.querySelector('.group-seen-list');
    if (!seenList) return;
    const viewers = (readBy || [])
        .filter(u => (u._id || u)?.toString() !== senderId?.toString())
        .map(u => u.username || u.toString());
    renderSeenList(seenList, viewers);
}

// Typing indicator
export function showTypingIndicator(name) {
    let el = document.getElementById('typing-indicator');
    if (!el) {
        el = document.createElement('div');
        el.id = 'typing-indicator';
        el.className = 'typing-indicator';
        dom.messagesList.appendChild(el);
    }
    el.innerHTML = '';

    const text = document.createElement('span');
    text.className = 'typing-text';
    text.textContent = `${name} đang soạn tin`;

    const dots = document.createElement('span');
    dots.className = 'typing-dots';
    dots.innerHTML = '<span></span><span></span><span></span>';

    el.appendChild(text);
    el.appendChild(dots);

    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
}

export function hideTypingIndicator() {
    document.getElementById('typing-indicator')?.remove();
}

