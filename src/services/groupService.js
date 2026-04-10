// src/services/groupService.js
// Business logic dùng chung cho group: kiểm tra membership, quyền admin.
// Tách ra để controller gọn hơn và logic có thể tái sử dụng giữa controller và socket handler.

/**
 * Kiểm tra user có phải là admin của nhóm không.
 * Xử lý cả hai trường hợp: admins là ObjectId hoặc object đã populate.
 * @param {object} group   - Mongoose Group document
 * @param {string} userId
 * @returns {boolean}
 */
function isAdmin(group, userId) {
    return group.admins.some(a => (a._id || a).toString() === userId.toString());
}

/**
 * Kiểm tra user có phải là member của nhóm không.
 * Xử lý cả hai trường hợp: members[].userId là ObjectId hoặc object đã populate.
 * @param {object} group   - Mongoose Group document
 * @param {string} userId
 * @returns {boolean}
 */
function isMember(group, userId) {
    return group.members.some(m => {
        const mid = m.userId?._id || m.userId;
        return mid?.toString() === userId.toString();
    });
}

/**
 * Kiểm tra user có phải là creator (trưởng nhóm) không.
 * @param {object} group
 * @param {string} userId
 * @returns {boolean}
 */
function isCreator(group, userId) {
    const creatorId = group.creator?._id?.toString() || group.creator?.toString();
    return creatorId === userId.toString();
}

module.exports = { isAdmin, isMember, isCreator };
