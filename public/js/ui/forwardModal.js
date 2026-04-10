// public/js/ui/forwardModal.js
// Modal chuyển tiếp tin nhắn tới DM hoặc nhóm.

import { closeAllPopups } from './messageUI.js';

export function showForwardModal(wrapper) {
    closeAllPopups();
    const text = wrapper.dataset.plaintext;
    if (!text) return alert('Không thể chuyển tiếp tin nhắn này.');

    const selectedMap = new Map();

    const modal = document.createElement('div');
    modal.id        = '_forward_modal';
    modal.className = 'forward-modal-overlay';
    modal.innerHTML = `
        <div class="forward-modal-box">
            <div class="forward-modal-header">
                <span class="forward-modal-title">Chuyển tiếp tin nhắn</span>
                <button class="forward-modal-close-btn" id="_fwd_close">✕</button>
            </div>
            <div class="forward-msg-preview">
                <span class="forward-msg-preview-label">Nội dung:</span>
                <span class="forward-msg-preview-text">${text.length > 80 ? text.slice(0, 80) + '…' : text}</span>
            </div>
            <div class="forward-selected-bar hidden" id="_fwd_selected_bar">
                <span class="forward-selected-label">Đã chọn:</span>
                <div class="forward-chips" id="_fwd_chips"></div>
            </div>
            <ul class="forward-contact-list" id="_fwd_list"></ul>
            <div class="forward-footer">
                <button class="forward-cancel-btn" id="_fwd_cancel">Huỷ</button>
                <button class="forward-send-btn" id="_fwd_send" disabled>Gửi <span id="_fwd_count"></span></button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const list    = modal.querySelector('#_fwd_list');
    const friends = [...document.querySelectorAll('.contact-item[data-status="accepted"]')];
    const groups  = [...document.querySelectorAll('.group-item')];

    if (!friends.length && !groups.length) {
        list.innerHTML = '<li class="forward-empty">Không có ai để chuyển tiếp.</li>';
    }

    const renderItem = (id, name, isGroup = false) => {
        const li = document.createElement('li');
        li.className   = 'forward-contact-item';
        li.dataset.id   = id;
        li.dataset.name = name;
        li.innerHTML = `
            <span class="forward-item-check hidden" id="fwd-check-${id}">✓</span>
            <span class="forward-avatar ${isGroup ? 'forward-avatar-group' : ''}">${name[0].toUpperCase()}</span>
            <span class="forward-item-name">${name}</span>
            ${isGroup ? '<span class="forward-item-badge">Nhóm</span>' : ''}`;
        li.addEventListener('click', () => {
            const key = (isGroup ? 'group:' : 'dm:') + id;
            if (selectedMap.has(key)) {
                selectedMap.delete(key);
                li.classList.remove('forward-item-selected');
                modal.querySelector(`#fwd-check-${id}`)?.classList.add('hidden');
            } else {
                selectedMap.set(key, { id, name, isGroup });
                li.classList.add('forward-item-selected');
                modal.querySelector(`#fwd-check-${id}`)?.classList.remove('hidden');
            }
            updateForwardUI();
        });
        list.appendChild(li);
    };

    if (friends.length) {
        const sep = document.createElement('li');
        sep.className = 'forward-section-label'; sep.textContent = 'Bạn bè';
        list.appendChild(sep);
        friends.forEach(item => renderItem(item.dataset.id, item.dataset.username, false));
    }
    if (groups.length) {
        const sep = document.createElement('li');
        sep.className = 'forward-section-label'; sep.textContent = 'Nhóm';
        list.appendChild(sep);
        groups.forEach(item => {
            const gName = item.querySelector('.contact-name')?.textContent || 'Nhóm';
            renderItem(item.dataset.groupId, gName, true);
        });
    }

    function updateForwardUI() {
        const count   = selectedMap.size;
        const sendBtn = modal.querySelector('#_fwd_send');
        sendBtn.disabled = count === 0;
        modal.querySelector('#_fwd_count').textContent = count > 0 ? `(${count})` : '';

        const chips = modal.querySelector('#_fwd_chips');
        chips.innerHTML = '';
        selectedMap.forEach(({ name }, key) => {
            const chip = document.createElement('span');
            chip.className = 'forward-chip'; chip.textContent = name;
            const x = document.createElement('button');
            x.className = 'forward-chip-remove'; x.textContent = '×';
            x.addEventListener('click', (e) => {
                e.stopPropagation(); selectedMap.delete(key);
                const id = key.split(':')[1];
                modal.querySelector(`.forward-contact-item[data-id="${id}"]`)?.classList.remove('forward-item-selected');
                modal.querySelector(`#fwd-check-${id}`)?.classList.add('hidden');
                updateForwardUI();
            });
            chip.appendChild(x); chips.appendChild(chip);
        });
        modal.querySelector('#_fwd_selected_bar').classList.toggle('hidden', count === 0);
    }

    modal.querySelector('#_fwd_send').addEventListener('click', async () => {
        if (!selectedMap.size) return;
        modal.querySelector('#_fwd_send').disabled    = true;
        modal.querySelector('#_fwd_send').textContent = 'Đang gửi...';
        const targets = [...selectedMap.values()];
        modal.remove();
        const { doForwardMessage, doForwardToGroup } = await import('../actions.js');
        for (const { id, name, isGroup } of targets) {
            if (isGroup) await doForwardToGroup(text, id);
            else         await doForwardMessage(text, id, name);
        }
    });

    const closeModal = () => modal.remove();
    modal.querySelector('#_fwd_close').addEventListener('click', closeModal);
    modal.querySelector('#_fwd_cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
}
