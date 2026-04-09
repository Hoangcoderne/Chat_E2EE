// src/__tests__/helpers/db.js
// Stub file - không dùng mongodb-memory-server vì binary bị chặn.
// Integration tests dùng jest.mock() để mock mongoose models trực tiếp.
module.exports = {
  connect:       async () => {},
  clearDatabase: async () => {},
  disconnect:    async () => {},
};
