// public/js/ui/groupUI.js
// Render và quản lý UI nhóm chat: sidebar item, open chat, create/manage modal.

import { state }     from '../state.js';
import { dom }       from './dom.js';
import { authFetch } from '../utils.js';
import { cancelReply }    from './messageUI.js';
import { clearGroupPreview } from './contactUI.js';
import { getGroupKey, encryptGroupKeyForMember } from '../crypto/groupCrypto.js';
import { loadGroupHistory } from '../api.js';

let _socket = null;
export function setSocket(s) { _socket = s; }

// renderGroupItem
export function renderGroupItem(group) {
    if (document.querySelector(`.group-item[data-group-id="${group._id}"]`)) return;

    const li = document.createElement('li');
    li.className       = 'contact-item group-item';
    li.dataset.groupId = group._id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar-container';
    avatar.innerHTML = `<div class="avatar group-avatar">${group.name[0].toUpperCase()}</div>`;

    const info = document.createElement('div');
    info.className = 'contact-info';
    info.innerHTML = `
        <div class="contact-name">${group.name}</div>
        <div class="last-message" id="group-preview-${group._id}">${group.members?.length || 0} thành viên</div>`;

    const badge = document.createElement('span');
    badge.className = 'unread-badge hidden';
    badge.id        = `unread-group-${group._id}`;
    if (group.unreadCount > 0) {
        badge.textContent = group.unreadCount > 99 ? '99+' : group.unreadCount;
        badge.classList.remove('hidden');
    }

    li.appendChild(avatar);
    li.appendChild(info);
    li.appendChild(badge);
    li.addEventListener('click', () => openGroupChat(group));
    dom.groupsList.appendChild(li);
}

// openGroupChat
export async function openGroupChat(group) {
    cancelReply();
    state.currentGroupId = group._id;
    state.currentChat    = { partnerId: null, partnerPublicKey: null, partnerSigningPublicKey: null, sharedSecret: null };

    document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.group-item[data-group-id="${group._id}"]`)?.classList.add('active');

    dom.chatHeader.classList.remove('hidden');
    dom.partnerName.innerText  = `👥 ${group.name}`;
    dom.partnerStatus.innerText = `${group.members?.length || '?'} thành viên`;
    dom.partnerStatus.classList.remove('online');
    dom.btnManageGroup.classList.remove('hidden');
    dom.btnManageGroup.dataset.groupId = group._id;
    dom.chatInputArea.classList.remove('hidden');
    dom.blockOverlay.classList.add('hidden');
    dom.msgInput.disabled     = false;
    dom.btnSend.disabled      = false;
    dom.msgInput.placeholder  = 'Nhắn tin vào nhóm...';
    dom.messagesList.innerHTML = '<div class="system-msg">🔒 Đang tải lịch sử nhóm...</div>';

    try {
        await getGroupKey(group._id);
    } catch (_) {
        dom.messagesList.innerHTML = '<div class="system-msg">⚠️ Không thể tải khoá nhóm. Vui lòng thử lại.</div>';
        return;
    }

    await loadGroupHistory(group._id, _socket);

    const badge = document.getElementById(`unread-group-${group._id}`);
    if (badge) { badge.textContent = ''; badge.classList.add('hidden'); }
    clearGroupPreview(group._id);

    if (window.innerWidth <= 768) {
        dom.chatArea.classList.add('mobile-active');
        document.querySelector('.sidebar').classList.add('mobile-hidden');
        dom.btnBack.classList.remove('hidden');
        history.pushState({ chatOpen: true }, '');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Create Group Modal
// ════════════════════════════════════════════════════════════════════════════
export async function openCreateGroupModal() {
    dom.modalCreateGroup.classList.remove('hidden');
    document.getElementById('group-name-input').value = '';
    document.getElementById('create-group-error').classList.add('hidden');
    document.getElementById('selected-members-preview').classList.add('hidden');
    document.getElementById('selected-chips').innerHTML = '';

    const checkboxList = document.getElementById('friend-checkboxes');
    checkboxList.innerHTML = '<div style="color:#999;font-size:13px">Đang tải...</div>';

    const contacts = [...document.querySelectorAll('.contact-item[data-status="accepted"]')];
    if (!contacts.length) {
        checkboxList.innerHTML = '<div style="color:#999;font-size:13px">Bạn chưa có bạn bè nào.</div>';
        return;
    }

    checkboxList.innerHTML = '';
    contacts.forEach(item => {
        const label = document.createElement('label');
        label.className = 'friend-checkbox-item';
        label.innerHTML = `
            <input type="checkbox" class="member-checkbox" data-id="${item.dataset.id}" data-name="${item.dataset.username}">
            <span class="friend-checkbox-avatar">${item.dataset.username[0].toUpperCase()}</span>
            <span>${item.dataset.username}</span>`;
        label.querySelector('input').addEventListener('change', updateSelectedPreview);
        checkboxList.appendChild(label);
    });
}

function updateSelectedPreview() {
    const checked = [...document.querySelectorAll('.member-checkbox:checked')];
    const preview = document.getElementById('selected-members-preview');
    const chips   = document.getElementById('selected-chips');
    chips.innerHTML = '';
    if (!checked.length) { preview.classList.add('hidden'); return; }
    preview.classList.remove('hidden');
    checked.forEach(cb => {
        const chip = document.createElement('span');
        chip.className = 'member-chip'; chip.textContent = cb.dataset.name;
        chips.appendChild(chip);
    });
}

export async function submitCreateGroup() {
    const name    = document.getElementById('group-name-input').value.trim();
    const checked = [...document.querySelectorAll('.member-checkbox:checked')];
    const errEl   = document.getElementById('create-group-error');
    errEl.classList.add('hidden');

    if (!name) { errEl.textContent = 'Vui lòng nhập tên nhóm'; errEl.classList.remove('hidden'); return; }
    if (!checked.length) { errEl.textContent = 'Chọn ít nhất 1 thành viên'; errEl.classList.remove('hidden'); return; }

    const btn = document.getElementById('btn-submit-create-group');
    btn.disabled = true; btn.textContent = 'Đang tạo...';

    try {
        const memberIds = checked.map(cb => cb.dataset.id);
        const allIds    = [...memberIds, state.myIdentity.userId];
        const keysRes   = await authFetch(`/api/groups/member-keys?userIds=${allIds.join(',')}`);
        if (!keysRes) throw new Error('Không lấy được public keys');
        const members   = await keysRes.json();

        const groupKey = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

        const memberPayloads = await Promise.all(members.map(async m => {
            const { encryptedGroupKey, keyIv } = await encryptGroupKeyForMember(groupKey, m.publicKey);
            return { userId: m._id, encryptedGroupKey, keyIv };
        }));

        const res   = await authFetch('/api/groups/create', { method: 'POST', body: JSON.stringify({ name, members: memberPayloads }) });
        if (!res) throw new Error('Lỗi mạng');
        const group = await res.json();
        if (!group._id) throw new Error(group.message || 'Tạo nhóm thất bại');

        state.groupKeys.set(group._id, groupKey);
        const cached = JSON.parse(sessionStorage.getItem('myGroupIds') || '[]');
        cached.push(group._id);
        sessionStorage.setItem('myGroupIds', JSON.stringify(cached));
        _socket?.emit('join_groups', [group._id]);
        renderGroupItem({ ...group, unreadCount: 0 });

        const newMemberIds = memberPayloads.map(m => m.userId.toString()).filter(uid => uid !== state.myIdentity.userId);
        _socket?.emit('broadcast_group_member_added', { groupId: group._id, newMemberIds, groupName: name });

        dom.modalCreateGroup.classList.add('hidden');
        dom.tabGroups?.click();
        openGroupChat(group);
    } catch (err) {
        errEl.textContent = err.message; errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false; btn.textContent = 'Tạo nhóm';
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Manage Group Modal
// ════════════════════════════════════════════════════════════════════════════
export async function loadManageModal(groupId) {
    document.getElementById('manage-group-error').classList.add('hidden');
    const res   = await authFetch(`/api/groups/${groupId}/info`);
    if (!res) return;
    const group = await res.json();
    if (!group?._id) {
        const errEl = document.getElementById('manage-group-error');
        errEl.textContent = 'Không thể tải thông tin nhóm.'; errEl.classList.remove('hidden');
        return;
    }

    document.getElementById('manage-group-title').textContent = `⚙️ ${group.name}`;
    const members   = group.members || [];
    document.getElementById('member-count').textContent = members.length;

    const creatorId = group.creator?._id?.toString() || group.creator?.toString();
    const myId      = state.myIdentity.userId?.toString();
    const adminIds  = (group.admins || []).map(a => (a._id || a).toString());
    const isAdmin   = adminIds.includes(myId);

    const memberList = document.getElementById('member-list');
    memberList.innerHTML = '';

    members.forEach(m => {
        const uid         = (m.userId?._id || m.userId)?.toString();
        const username    = m.userId?.username || '(unknown)';
        const isCreator   = uid === creatorId;
        const isThisAdmin = adminIds.includes(uid);

        const li   = document.createElement('li');
        li.className = 'member-list-item';

        const left = document.createElement('div');
        left.className = 'member-list-left';
        left.innerHTML = `
            <div class="member-avatar">${username[0].toUpperCase()}</div>
            <div>
                <div class="member-name">${username}</div>
                ${isCreator ? '<div class="member-role creator">Trưởng nhóm</div>' : isThisAdmin ? '<div class="member-role admin">Quản trị</div>' : ''}
            </div>`;
        li.appendChild(left);

        if (isAdmin && !isCreator && uid !== myId) {
            const removeBtn = document.createElement('button');
            removeBtn.className   = 'btn-remove-member';
            removeBtn.textContent = 'Xoá';
            removeBtn.addEventListener('click', () => removeMemberFromGroup(groupId, uid, username));
            li.appendChild(removeBtn);
        }
        memberList.appendChild(li);
    });

    const addSection = document.getElementById('add-member-section');
    if (isAdmin) {
        addSection.classList.remove('hidden');
        const currentMemberIds  = new Set(members.map(m => (m.userId?._id || m.userId)?.toString()));
        const checkboxes        = document.getElementById('add-member-checkboxes');
        checkboxes.innerHTML    = '';
        const availableFriends  = [...document.querySelectorAll('.contact-item[data-status="accepted"]')]
            .filter(item => !currentMemberIds.has(item.dataset.id));

        if (!availableFriends.length) {
            checkboxes.innerHTML = '<div style="color:#999;font-size:12px">Tất cả bạn bè đã trong nhóm.</div>';
        } else {
            availableFriends.forEach(item => {
                const label = document.createElement('label');
                label.className = 'friend-checkbox-item';
                label.innerHTML = `
                    <input type="checkbox" class="add-member-checkbox" data-id="${item.dataset.id}" data-name="${item.dataset.username}">
                    <span class="friend-checkbox-avatar">${item.dataset.username[0].toUpperCase()}</span>
                    <span>${item.dataset.username}</span>`;
                checkboxes.appendChild(label);
            });
        }
    } else {
        addSection.classList.add('hidden');
    }
}

export async function addSelectedMembers() {
    const checked = [...document.querySelectorAll('.add-member-checkbox:checked')];
    if (!checked.length) { alert('Chọn ít nhất 1 người'); return; }

    const groupId  = state.currentGroupId;
    const groupKey = await getGroupKey(groupId);
    if (!groupKey) { alert('Không có group key'); return; }

    const btn   = document.getElementById('btn-add-member');
    const errEl = document.getElementById('manage-group-error');
    btn.disabled = true; btn.textContent = 'Đang thêm...';
    errEl.classList.add('hidden');

    try {
        const ids      = checked.map(cb => cb.dataset.id);
        const keysRes  = await authFetch(`/api/groups/member-keys?userIds=${ids.join(',')}`);
        if (!keysRes) throw new Error('Không lấy được public keys');
        const members  = await keysRes.json();
        const addedIds = [];
        const groupName = document.getElementById('manage-group-title').textContent.replace('⚙️ ', '');

        for (const m of members) {
            const { encryptedGroupKey, keyIv } = await encryptGroupKeyForMember(groupKey, m.publicKey);
            const res  = await authFetch(`/api/groups/${groupId}/add-member`, {
                method: 'POST', body: JSON.stringify({ userId: m._id, encryptedGroupKey, keyIv })
            });
            if (!res) continue;
            const data = await res.json();
            if (data.success) addedIds.push(m._id.toString());
        }

        if (addedIds.length) _socket?.emit('broadcast_group_member_added', { groupId, newMemberIds: addedIds, groupName });
        await loadManageModal(groupId);
    } catch (err) {
        errEl.textContent = err.message; errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false; btn.textContent = '＋ Thêm thành viên đã chọn';
    }
}

export async function removeMemberFromGroup(groupId, userId, username) {
    if (!confirm(`Xoá ${username} khỏi nhóm?`)) return;
    const errEl = document.getElementById('manage-group-error');
    errEl.classList.add('hidden');
    const res  = await authFetch(`/api/groups/${groupId}/remove-member`, { method: 'POST', body: JSON.stringify({ userId }) });
    if (!res) return;
    const data = await res.json();
    if (data.success) {
        _socket?.emit('broadcast_group_member_removed', { groupId, removedUserId: userId, removedName: data.removedName || username });
        await loadManageModal(groupId);
    } else {
        errEl.textContent = data.message; errEl.classList.remove('hidden');
    }
}
