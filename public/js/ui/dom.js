// public/js/ui/dom.js
// Tập trung toàn bộ DOM references vào một chỗ.
// Mọi module import từ đây thay vì gọi getElementById rải rác.

export const dom = {
    // ── Sidebar ──────────────────────────────────────────────────────────────
    status:       document.getElementById('status-bar'),
    myUsername:   document.getElementById('my-username'),
    searchInput:  document.getElementById('search-input'),
    btnConnect:   document.getElementById('btn-connect'),
    contactsList: document.getElementById('contacts-list'),
    btnRequests:  document.getElementById('btn-requests'),
    reqPopup:     document.getElementById('requests-popup'),
    reqList:      document.getElementById('requests-list'),
    reqCount:     document.getElementById('req-count'),

    // ── Chat area ─────────────────────────────────────────────────────────────
    chatHeader:    document.getElementById('chat-header'),
    partnerName:   document.getElementById('partner-name'),
    partnerStatus: document.getElementById('partner-status'),
    messagesList:  document.getElementById('messages-list'),
    msgInput:      document.getElementById('msg-input'),
    btnSend:       document.getElementById('btn-send'),
    chatInputArea: document.getElementById('chat-input-area'),
    blockOverlay:  document.getElementById('block-overlay'),
    blockTitle:    document.getElementById('block-title'),
    btnUnblock:    document.getElementById('btn-unblock'),
    btnLogout:     document.getElementById('btn-logout'),

    // ── Group ─────────────────────────────────────────────────────────────────
    tabFriends:       document.getElementById('tab-friends'),
    tabGroups:        document.getElementById('tab-groups'),
    panelFriends:     document.getElementById('panel-friends'),
    panelGroups:      document.getElementById('panel-groups'),
    groupsList:       document.getElementById('groups-list'),
    btnCreateGroup:   document.getElementById('btn-create-group'),
    btnManageGroup:   document.getElementById('btn-manage-group'),
    modalCreateGroup: document.getElementById('modal-create-group'),
    modalManageGroup: document.getElementById('modal-manage-group'),

    // ── Mobile ────────────────────────────────────────────────────────────────
    btnBack:  document.getElementById('btn-back'),
    chatArea: document.querySelector('.chat-area'),
};
