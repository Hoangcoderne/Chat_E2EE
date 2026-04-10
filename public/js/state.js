// public/js/state.js
// Single source of truth cho toàn bộ client-side state.
// Tất cả modules import object này và mutate trực tiếp.
// Dùng object thay vì export let vì ES module bindings là read-only từ ngoài.

export const state = {
    // Auth
    myIdentity: {
        userId:           null,
        username:         null,
        privateKey:       null,   // ECDH CryptoKey — chỉ tồn tại trong memory
        signingPrivateKey: null,  // ECDSA CryptoKey
    },

    // Active DM chat
    currentChat: {
        partnerId:              null,
        partnerPublicKey:       null,
        partnerSigningPublicKey: null,
        sharedSecret:           null,   // AES-GCM CryptoKey — không bao giờ lên server
    },

    // Active group chat
    currentGroupId: null,

    // Group key cache (tránh fetch lại mỗi lần mở chat)
    groupKeys: new Map(), // Map<groupId, CryptoKey>

    // Notification state
    friendRequests: [],
    notifications:  [],

    // Unread badges
    unreadCounts: {}, // { [contactId]: number }

    // Pending forward (sau khi handshake xong mới gửi)
    pendingForward: null, // { text, targetId }

    // Reply state
    currentReply: null,   // { messageId, senderName, plaintext }
};
