// src/__tests__/integration/chatController.test.js

process.env.SESSION_SECRET = 'integration_test_secret_2026';
process.env.NODE_ENV       = 'test';

jest.mock('../../models/Message');
jest.mock('../../models/User');
jest.mock('../../models/Friendship');
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mongoose   = require('mongoose');
const Message    = require('../../models/Message');
const Friendship = require('../../models/Friendship');
const chatController = require('../../controllers/chatController');

global.onlineUsers = new Set();

function mkRes() {
  return {
    _status: null, _body: null,
    status(s) { this._status = s; return this; },
    json(b)   { this._body = b;   return this; },
  };
}
function mkReq(body = {}, params = {}, userId = 'uid_alice') {
  return { body, params, query: {}, user: { userId } };
}

function fakeMsg(overrides = {}) {
  return {
    _id:              new mongoose.Types.ObjectId(),
    sender:           overrides.sender    || 'uid_alice',
    recipient:        overrides.recipient || 'uid_bob',
    encryptedContent: overrides.encryptedContent || 'enc==',
    iv:               overrides.iv        || 'iv==',
    signature:        overrides.signature || null,
    read:             overrides.read      ?? false,
    reactions:        overrides.reactions || [],
    timestamp:        new Date(),
    save:             jest.fn().mockResolvedThis ? undefined : undefined,
    ...overrides,
  };
}

beforeEach(() => { jest.clearAllMocks(); global.onlineUsers.clear(); });

// ════════════════════════════════════════════════════════════════════════
describe('chatController.getChatHistory()', () => {
  test('trả danh sách messages (paginated)', async () => {
    const msgs = [
      { ...fakeMsg({ sender: 'uid_alice', timestamp: new Date('2026-01-01') }) },
      { ...fakeMsg({ sender: 'uid_bob',   timestamp: new Date('2026-01-02') }) },
    ];
    // Mongoose query chain: find().sort().limit()
    Message.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(msgs)
      })
    });
    Message.updateMany.mockResolvedValue({ modifiedCount: 0 });

    const res = mkRes();
    await chatController.getChatHistory(mkReq({}, { partnerId: 'uid_bob' }), res);

    expect(res._body.messages).toHaveLength(2);
    expect(res._body).toHaveProperty('hasMore');
  });

  test('messages từ partner → gọi updateMany để mark read', async () => {
    Message.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([])
      })
    });
    Message.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await chatController.getChatHistory(mkReq({}, { partnerId: 'uid_bob' }), mkRes());

    expect(Message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ sender: 'uid_bob', recipient: 'uid_alice', read: false }),
      { read: true }
    );
  });

  test('IDOR: chỉ query messages của đúng cặp user (dùng userId từ JWT)', async () => {
    Message.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([])
      })
    });
    Message.updateMany.mockResolvedValue({});

    await chatController.getChatHistory(mkReq({}, { partnerId: 'uid_bob' }, 'uid_alice'), mkRes());

    // $or query phải chứa đúng uid_alice (từ JWT) và uid_bob (params)
    const queryArg = Message.find.mock.calls[0][0];
    const orClauses = queryArg.$or;
    const hasAliceBob = orClauses.some(c => 
      (c.sender === 'uid_alice' && c.recipient === 'uid_bob') ||
      (c.sender === 'uid_bob'   && c.recipient === 'uid_alice')
    );
    expect(hasAliceBob).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('chatController.getContacts()', () => {
  beforeEach(() => {
    Message.aggregate = jest.fn().mockResolvedValue([]);
  });

  test('chỉ trả contacts status accepted hoặc blocked', async () => {
    const aliceId = new mongoose.Types.ObjectId();
    const bobId   = new mongoose.Types.ObjectId();
    const carolId = new mongoose.Types.ObjectId();

    Friendship.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([
        { requester: { _id: aliceId, username: 'alice' }, recipient: { _id: bobId, username: 'bob' }, status: 'accepted' },
        { requester: { _id: aliceId, username: 'alice' }, recipient: { _id: carolId, username: 'carol' }, status: 'blocked' },
      ])
    });

    const res = mkRes();
    await chatController.getContacts(mkReq({}, {}, aliceId.toString()), res);

    const names = res._body.map(c => c.username);
    expect(names).toContain('bob');
    expect(names).toContain('carol');
  });

  test('unreadCount tính đúng từ aggregate result', async () => {
    const aliceId = new mongoose.Types.ObjectId();
    const bobId   = new mongoose.Types.ObjectId();

    Friendship.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([
        { requester: { _id: aliceId, username: 'alice' }, recipient: { _id: bobId, username: 'bob' }, status: 'accepted' },
      ])
    });
    Message.aggregate.mockResolvedValue([{ _id: bobId, count: 3 }]);

    const res = mkRes();
    await chatController.getContacts(mkReq({}, {}, aliceId.toString()), res);

    const bob = res._body.find(c => c.username === 'bob');
    expect(bob.unreadCount).toBe(3);
  });

  test('isBlocker=true khi mình là requester và status=blocked', async () => {
    const aliceId = new mongoose.Types.ObjectId();
    const bobId   = new mongoose.Types.ObjectId();

    Friendship.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([
        { requester: { _id: aliceId, username: 'alice' }, recipient: { _id: bobId, username: 'bob' }, status: 'blocked' },
      ])
    });

    const res = mkRes();
    await chatController.getContacts(mkReq({}, {}, aliceId.toString()), res);

    const bob = res._body.find(c => c.username === 'bob');
    expect(bob.isBlocker).toBe(true);
  });

  test('isBlocker=false khi mình là recipient và status=blocked', async () => {
    const aliceId = new mongoose.Types.ObjectId();
    const bobId   = new mongoose.Types.ObjectId();

    Friendship.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([
        { requester: { _id: bobId, username: 'bob' }, recipient: { _id: aliceId, username: 'alice' }, status: 'blocked' },
      ])
    });

    const res = mkRes();
    await chatController.getContacts(mkReq({}, {}, aliceId.toString()), res);

    const bob = res._body.find(c => c.username === 'bob');
    expect(bob.isBlocker).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('chatController.blockUser()', () => {
  test('block thành công → 200 success', async () => {
    Friendship.findOneAndDelete = jest.fn().mockResolvedValue({});
    Friendship.create          = jest.fn().mockResolvedValue({});

    const res = mkRes();
    await chatController.blockUser(mkReq({ targetId: new mongoose.Types.ObjectId().toString() }, {}, 'uid_alice'), res);

    expect(res._body.success).toBe(true);
    expect(Friendship.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked' })
    );
  });

  test('targetId không phải ObjectId hợp lệ → 400', async () => {
    const res = mkRes();
    await chatController.blockUser(mkReq({ targetId: 'invalid-id' }), res);

    expect(res._status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('chatController.unblockUser()', () => {
  test('unblock thành công → 200 success', async () => {
    Friendship.findOneAndUpdate = jest.fn().mockResolvedValue({ status: 'accepted' });

    const res = mkRes();
    await chatController.unblockUser(mkReq({ targetId: new mongoose.Types.ObjectId().toString() }, {}, 'uid_alice'), res);

    expect(res._body.success).toBe(true);
  });

  test('không tìm thấy friendship bị chặn → 400', async () => {
    Friendship.findOneAndUpdate = jest.fn().mockResolvedValue(null);

    const res = mkRes();
    await chatController.unblockUser(mkReq({ targetId: new mongoose.Types.ObjectId().toString() }), res);

    expect(res._status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('chatController.unfriend()', () => {
  test('unfriend thành công → friendship bị xóa, trả success', async () => {
    Friendship.findOneAndDelete = jest.fn().mockResolvedValue({ status: 'accepted' });
    const targetId = new mongoose.Types.ObjectId().toString();

    const res = mkRes();
    await chatController.unfriend(mkReq({ targetId }, {}, 'uid_alice'), res);

    expect(res._body.success).toBe(true);
    expect(Friendship.findOneAndDelete).toHaveBeenCalled();
  });

  test('không tìm thấy friendship → 404', async () => {
    Friendship.findOneAndDelete = jest.fn().mockResolvedValue(null);

    const res = mkRes();
    await chatController.unfriend(mkReq({ targetId: new mongoose.Types.ObjectId().toString() }), res);

    expect(res._status).toBe(404);
  });

  test('targetId không hợp lệ → 400', async () => {
    const res = mkRes();
    await chatController.unfriend(mkReq({ targetId: 'bad-id' }), res);

    expect(res._status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('chatController.deleteMessage()', () => {
  test('sender xóa tin của mình → thành công, trả recipientId', async () => {
    const msgId = new mongoose.Types.ObjectId().toString();
    Message.findById           = jest.fn().mockResolvedValue({ sender: { toString: () => 'uid_alice' }, recipient: { toString: () => 'uid_bob' } });
    Message.findByIdAndDelete  = jest.fn().mockResolvedValue({});

    const res = mkRes();
    await chatController.deleteMessage(mkReq({ messageId: msgId }, {}, 'uid_alice'), res);

    expect(res._body.success).toBe(true);
    expect(res._body.recipientId).toBe('uid_bob');
  });

  test('IDOR: recipient cố xóa tin người gửi → 403', async () => {
    const msgId = new mongoose.Types.ObjectId().toString();
    // Tin của alice, bob cố xóa
    Message.findById = jest.fn().mockResolvedValue({ sender: { toString: () => 'uid_alice' }, recipient: { toString: () => 'uid_bob' } });

    const res = mkRes();
    await chatController.deleteMessage(mkReq({ messageId: msgId }, {}, 'uid_bob'), res);

    expect(res._status).toBe(403);
    expect(Message.findByIdAndDelete).not.toHaveBeenCalled();
  });

  test('messageId không tồn tại → 404', async () => {
    Message.findById = jest.fn().mockResolvedValue(null);

    const res = mkRes();
    await chatController.deleteMessage(
      mkReq({ messageId: new mongoose.Types.ObjectId().toString() }, {}, 'uid_alice'), res
    );
    expect(res._status).toBe(404);
  });

  test('messageId không phải ObjectId → 400', async () => {
    const res = mkRes();
    await chatController.deleteMessage(mkReq({ messageId: 'invalid-id' }), res);

    expect(res._status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('chatController.toggleReaction()', () => {
  function makeMsgWithSave(overrides = {}) {
    const msg = {
      sender:    { toString: () => overrides.sender    || 'uid_alice' },
      recipient: { toString: () => overrides.recipient || 'uid_bob' },
      reactions: overrides.reactions || [],
      save:      jest.fn().mockResolvedValue(true),
    };
    return msg;
  }

  test('thêm reaction mới thành công', async () => {
    const msg = makeMsgWithSave();
    Message.findById = jest.fn().mockResolvedValue(msg);

    const res = mkRes();
    await chatController.toggleReaction(
      mkReq({ messageId: new mongoose.Types.ObjectId().toString(), emoji: '👍' }, {}, 'uid_alice'), res
    );

    expect(res._body.success).toBe(true);
    expect(msg.reactions).toHaveLength(1);
    expect(msg.reactions[0].emoji).toBe('👍');
  });

  test('cùng emoji → toggle off (xóa reaction)', async () => {
    const msg = makeMsgWithSave({ reactions: [{ emoji: '❤️', userId: { toString: () => 'uid_alice' } }] });
    Message.findById = jest.fn().mockResolvedValue(msg);

    const res = mkRes();
    await chatController.toggleReaction(
      mkReq({ messageId: new mongoose.Types.ObjectId().toString(), emoji: '❤️' }, {}, 'uid_alice'), res
    );

    expect(res._body.success).toBe(true);
    expect(msg.reactions).toHaveLength(0);
  });

  test('khác emoji → đổi emoji, không tạo thêm entry', async () => {
    const existingReaction = { emoji: '👍', userId: { toString: () => 'uid_alice' } };
    const msg = makeMsgWithSave({ reactions: [existingReaction] });
    Message.findById = jest.fn().mockResolvedValue(msg);

    const res = mkRes();
    await chatController.toggleReaction(
      mkReq({ messageId: new mongoose.Types.ObjectId().toString(), emoji: '😂' }, {}, 'uid_alice'), res
    );

    expect(msg.reactions).toHaveLength(1);       // vẫn 1 entry
    expect(msg.reactions[0].emoji).toBe('😂');   // đã đổi
  });

  test('emoji không trong whitelist → 400', async () => {
    Message.findById = jest.fn().mockResolvedValue(makeMsgWithSave());
    const res = mkRes();
    await chatController.toggleReaction(
      mkReq({ messageId: new mongoose.Types.ObjectId().toString(), emoji: '🤡' }, {}, 'uid_alice'), res
    );

    expect(res._status).toBe(400);
  });

  test('user không phải sender/recipient → 403', async () => {
    const msg = makeMsgWithSave({ sender: 'uid_alice', recipient: 'uid_bob' });
    Message.findById = jest.fn().mockResolvedValue(msg);

    const res = mkRes();
    await chatController.toggleReaction(
      mkReq({ messageId: new mongoose.Types.ObjectId().toString(), emoji: '👍' }, {}, 'uid_charlie'), res
    );

    expect(res._status).toBe(403);
  });

  test('messageId không hợp lệ → 400', async () => {
    const res = mkRes();
    await chatController.toggleReaction(mkReq({ messageId: 'bad', emoji: '👍' }), res);

    expect(res._status).toBe(400);
  });
});
