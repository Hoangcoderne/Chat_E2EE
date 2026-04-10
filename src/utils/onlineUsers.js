// src/utils/onlineUsers.js
// Encapsulated module quản lý trạng thái online — thay thế global.onlineUsers.
// Mỗi userId có thể có nhiều socket (multi-device).

const onlineUsers = new Map(); // Map<userId, Set<socketId>>

function addSocket(userId, socketId) {
    if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socketId);
}

function removeSocket(userId, socketId) {
    const sockets = onlineUsers.get(userId);
    if (!sockets) return 0;
    sockets.delete(socketId);
    if (sockets.size === 0) {
        onlineUsers.delete(userId);
    }
    return sockets.size;
}

function isOnline(userId) {
    return onlineUsers.has(userId);
}

function getSocketCount(userId) {
    return onlineUsers.get(userId)?.size || 0;
}

function isFirstSocket(userId) {
    return getSocketCount(userId) === 1;
}

module.exports = { addSocket, removeSocket, isOnline, getSocketCount, isFirstSocket };
