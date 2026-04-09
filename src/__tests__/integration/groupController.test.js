// src/__tests__/integration/groupController.test.js
// Integration tests cho groupController — dùng jest.mock mongoose models.

process.env.SESSION_SECRET = 'integration_test_secret_2026';
process.env.NODE_ENV       = 'test';

jest.mock('../../models/Group');
jest.mock('../../models/GroupMessage');
jest.mock('../../models/User');
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mongoose      = require('mongoose');
const Group         = require('../../models/Group');
const GroupMessage  = require('../../models/GroupMessage');
const User          = require('../../models/User');
const groupController = require('../../controllers/groupController');

function mkRes() {
  return {
    _status: null, _body: null,
    status(s) { this._status = s; return this; },
    json(b)   { this._body = b;   return this; },
  };
}
function mkReq(body = {}, params = {}, userId = 'uid_alice', query = {}) {
  return { body, params, query, user: { userId } };
}

// ── Helpers tạo fake objects ──────────────────────────────────────────────
function fakeId(str) {
  // trả về object có toString() → string, để isMember/isAdmin check hoạt động
  const id = new mongoose.Types.ObjectId();
  return id;
}

function fakeGroup(creatorId, memberIds = [], overrides = {}) {
  const creator = typeof creatorId === 'string' ? { toString: () => creatorId } : creatorId;
  return {
    _id:     fakeId(),
    name:    'Test Group',
    creator,
    admins:  [creator],
    members: [creatorId, ...memberIds].map(uid => ({
      userId:            typeof uid === 'string' ? { toString: () => uid, _id: { toString: () => uid } } : uid,
      encryptedGroupKey: 'encKey==',
      keyIv:             'iv==',
      keyHolderId:       creator,
    })),
    save:    jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════
describe('groupController.getMemberKeys()', () => {
  test('trả publicKey + _id của các user requested', async () => {
    const uid1 = fakeId(), uid2 = fakeId();
    User.find.mockReturnValue({
      select: jest.fn().mockResolvedValue([
        { _id: uid1, username: 'alice', publicKey: 'pkAlice=', signingPublicKey: 'spkAlice=' },
        { _id: uid2, username: 'bob',   publicKey: 'pkBob=',   signingPublicKey: 'spkBob=' },
      ])
    });

    const res = mkRes();
    await groupController.getMemberKeys(
      mkReq({}, {}, 'uid_alice', { userIds: `${uid1},${uid2}` }), res
    );

    expect(res._body).toHaveLength(2);
    expect(res._body[0]).toHaveProperty('publicKey');
    expect(res._body[0]).not.toHaveProperty('encryptedPrivateKey');
    expect(res._body[0]).not.toHaveProperty('authKeyHash');
  });

  test('thiếu userIds param → 400', async () => {
    const res = mkRes();
    await groupController.getMemberKeys(mkReq({}, {}, 'uid_alice', {}), res);

    expect(res._status).toBe(400);
  });

  test('chỉ trả fields publicKey, không tiết lộ privateKey hay authKeyHash', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockResolvedValue([
        { _id: fakeId(), username: 'alice', publicKey: 'pk=', signingPublicKey: 'spk=' }
      ])
    });

    const res = mkRes();
    await groupController.getMemberKeys(mkReq({}, {}, 'uid_alice', { userIds: 'someid' }), res);

    res._body.forEach(u => {
      expect(u).not.toHaveProperty('encryptedPrivateKey');
      expect(u).not.toHaveProperty('authKeyHash');
      expect(u).not.toHaveProperty('recoveryKeyHash');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupController.createGroup()', () => {
  // Dùng ObjectId thật vì controller gọi mongoose.Types.ObjectId.isValid()
  let aliceId, bobId;
  beforeEach(() => {
    aliceId = new mongoose.Types.ObjectId().toString();
    bobId   = new mongoose.Types.ObjectId().toString();
  });

  test('tạo nhóm thành công → 201, trả group object', async () => {
    const createdGroup = {
      _id: fakeId(), name: 'NewGroup',
      populate: jest.fn().mockResolvedValue({ _id: fakeId(), name: 'NewGroup', members: [] }),
    };
    Group.create = jest.fn().mockResolvedValue(createdGroup);

    const members = [
      { userId: aliceId, encryptedGroupKey: 'encA=', keyIv: 'ivA=' },
      { userId: bobId,   encryptedGroupKey: 'encB=', keyIv: 'ivB=' },
    ];
    const res = mkRes();
    await groupController.createGroup(mkReq({ name: 'NewGroup', members }, {}, aliceId), res);

    expect(res._status).toBe(201);
    expect(Group.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'NewGroup', creator: aliceId, admins: [aliceId] })
    );
  });

  test('keyHolderId được set là creatorId cho mỗi member', async () => {
    let capturedData = null;
    Group.create = jest.fn().mockImplementation((data) => {
      capturedData = data;
      return { ...data, populate: jest.fn().mockResolvedValue(data) };
    });

    const members = [
      { userId: aliceId, encryptedGroupKey: 'encA=', keyIv: 'ivA=' },
      { userId: bobId,   encryptedGroupKey: 'encB=', keyIv: 'ivB=' },
    ];
    const res = mkRes();
    await groupController.createGroup(mkReq({ name: 'KeyTestGroup', members }, {}, aliceId), res);

    capturedData.members.forEach(m => {
      expect(m.keyHolderId).toBe(aliceId);
    });
  });

  test('ít hơn 2 members → 400', async () => {
    const res = mkRes();
    await groupController.createGroup(
      mkReq({ name: 'TooSmall', members: [{ userId: aliceId, encryptedGroupKey: 'enc=', keyIv: 'iv=' }] }, {}, aliceId), res
    );
    expect(res._status).toBe(400);
  });

  test('tên nhóm rỗng → 400', async () => {
    const members = [
      { userId: aliceId, encryptedGroupKey: 'encA=', keyIv: 'ivA=' },
      { userId: bobId,   encryptedGroupKey: 'encB=', keyIv: 'ivB=' },
    ];
    const res = mkRes();
    await groupController.createGroup(mkReq({ name: '   ', members }, {}, aliceId), res);

    expect(res._status).toBe(400);
  });

  test('member thiếu encryptedGroupKey → 400 (dữ liệu không hợp lệ)', async () => {
    const members = [
      { userId: aliceId, encryptedGroupKey: 'encA=', keyIv: 'ivA=' },
      { userId: bobId }, // thiếu encryptedGroupKey + keyIv
    ];
    const res = mkRes();
    await groupController.createGroup(mkReq({ name: 'BadGroup', members }, {}, aliceId), res);

    expect(res._status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupController.getMyGroupKey()', () => {
  test('member lấy được key của mình kèm keyHolderPublicKey', async () => {
    const bobId    = 'uid_bob_789';
    const aliceId  = 'uid_alice_123';
    const groupId  = fakeId().toString();
    const holderId = fakeId();

    const group = fakeGroup(aliceId, [bobId]);
    group._id   = { toString: () => groupId };
    // member entry cho bob
    group.members = [{
      userId: { toString: () => bobId, _id: { toString: () => bobId } },
      encryptedGroupKey: 'encKeyForBob=',
      keyIv:             'ivForBob=',
      keyHolderId:       holderId,
    }];

    Group.findById = jest.fn().mockResolvedValue(group);
    User.findById  = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ publicKey: 'holderPubKey=', _id: holderId }),
    });

    const res = mkRes();
    await groupController.getMyGroupKey(mkReq({}, { groupId }, bobId), res);

    expect(res._body).toHaveProperty('encryptedGroupKey', 'encKeyForBob=');
    expect(res._body).toHaveProperty('keyIv', 'ivForBob=');
    expect(res._body).toHaveProperty('keyHolderPublicKey', 'holderPubKey=');
  });

  test('không phải member → 403', async () => {
    const group = fakeGroup('uid_alice');
    Group.findById = jest.fn().mockResolvedValue(group);

    const res = mkRes();
    await groupController.getMyGroupKey(mkReq({}, { groupId: group._id.toString() }, 'uid_charlie'), res);

    expect(res._status).toBe(403);
  });

  test('group không tồn tại → 403', async () => {
    Group.findById = jest.fn().mockResolvedValue(null);

    const res = mkRes();
    await groupController.getMyGroupKey(mkReq({}, { groupId: fakeId().toString() }, 'uid_alice'), res);

    expect(res._status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupController.addMember()', () => {
  test('admin thêm thành viên mới thành công', async () => {
    const aliceId = 'uid_alice_admin';
    const carolId = 'uid_carol_new';
    const group   = fakeGroup(aliceId, []);
    Group.findById = jest.fn().mockResolvedValue(group);
    User.findById  = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: carolId, username: 'carol', publicKey: 'pk=' }),
    });

    const res = mkRes();
    await groupController.addMember(
      mkReq({ userId: carolId, encryptedGroupKey: 'encCarol=', keyIv: 'ivCarol=' },
        { groupId: group._id.toString() }, aliceId), res
    );

    expect(res._body.success).toBe(true);
    expect(group.save).toHaveBeenCalled();
    const carolMember = group.members.find(m => m.userId === carolId);
    expect(carolMember).toBeDefined();
  });

  test('non-admin cố thêm member → 403', async () => {
    const aliceId = 'uid_alice_creator';
    const bobId   = 'uid_bob_notadmin';
    const carolId = 'uid_carol_new';
    const group   = fakeGroup(aliceId, [bobId]); // bob là member nhưng không phải admin
    Group.findById = jest.fn().mockResolvedValue(group);

    const res = mkRes();
    await groupController.addMember(
      mkReq({ userId: carolId, encryptedGroupKey: 'enc=', keyIv: 'iv=' },
        { groupId: group._id.toString() }, bobId), res  // bob gọi
    );

    expect(res._status).toBe(403);
    expect(group.save).not.toHaveBeenCalled();
  });

  test('user đã là member → 400', async () => {
    const aliceId = 'uid_alice_a2';
    const bobId   = 'uid_bob_a2';
    const group   = fakeGroup(aliceId, [bobId]);
    Group.findById = jest.fn().mockResolvedValue(group);

    const res = mkRes();
    await groupController.addMember(
      mkReq({ userId: bobId, encryptedGroupKey: 'enc=', keyIv: 'iv=' },
        { groupId: group._id.toString() }, aliceId), res
    );

    expect(res._status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupController.removeMember()', () => {
  test('admin xóa member thành công + system message được tạo', async () => {
    const aliceId = 'uid_alice_rm';
    const bobId   = 'uid_bob_rm';
    const group   = fakeGroup(aliceId, [bobId]);
    Group.findById = jest.fn().mockResolvedValue(group);
    User.findById  = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ username: 'bob' }),
    });
    GroupMessage.create = jest.fn().mockResolvedValue({});

    const res = mkRes();
    await groupController.removeMember(
      mkReq({ userId: bobId }, { groupId: group._id.toString() }, aliceId), res
    );

    expect(res._body.success).toBe(true);
    expect(group.save).toHaveBeenCalled();
    // System message được tạo
    expect(GroupMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'system', systemText: expect.stringContaining('bob') })
    );
  });

  test('không thể xóa creator → 400', async () => {
    const aliceId = 'uid_alice_creator2';
    const group   = fakeGroup(aliceId, []);
    Group.findById = jest.fn().mockResolvedValue(group);

    const res = mkRes();
    await groupController.removeMember(
      mkReq({ userId: aliceId }, { groupId: group._id.toString() }, aliceId), res
    );

    expect(res._status).toBe(400);
    expect(group.save).not.toHaveBeenCalled();
  });

  test('non-admin cố xóa member → 403', async () => {
    const aliceId = 'uid_alice_c3';
    const bobId   = 'uid_bob_c3';
    const carolId = 'uid_carol_c3';
    const group   = fakeGroup(aliceId, [bobId, carolId]);
    Group.findById = jest.fn().mockResolvedValue(group);

    const res = mkRes();
    await groupController.removeMember(
      mkReq({ userId: carolId }, { groupId: group._id.toString() }, bobId), // bob gọi
      res
    );

    expect(res._status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupController.leaveGroup()', () => {
  test('member rời nhóm → success + system message', async () => {
    const aliceId = 'uid_alice_leave';
    const bobId   = 'uid_bob_leave';
    const group   = fakeGroup(aliceId, [bobId]);
    Group.findById = jest.fn().mockResolvedValue(group);
    User.findById  = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ username: 'bob' }),
    });
    GroupMessage.create = jest.fn().mockResolvedValue({});

    const res = mkRes();
    await groupController.leaveGroup(
      mkReq({}, { groupId: group._id.toString() }, bobId), res
    );

    expect(res._body.success).toBe(true);
    expect(GroupMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'system', systemText: expect.stringContaining('bob') })
    );
  });

  test('creator cố rời khi còn member → 400', async () => {
    const aliceId = 'uid_alice_leave2';
    const bobId   = 'uid_bob_leave2';
    const group   = fakeGroup(aliceId, [bobId]);
    Group.findById = jest.fn().mockResolvedValue(group);

    const res = mkRes();
    await groupController.leaveGroup(
      mkReq({}, { groupId: group._id.toString() }, aliceId), res
    );

    expect(res._status).toBe(400);
    expect(res._body.message).toMatch(/chuyển quyền/);
  });

  test('member cuối rời → nhóm bị xóa hoàn toàn (không còn member)', async () => {
    const aliceId = 'uid_alice_last';
    const group   = fakeGroup(aliceId, []); // chỉ 1 member = alice (creator)
    Group.findById    = jest.fn().mockResolvedValue(group);
    User.findById     = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ username: 'alice' }),
    });
    Group.findByIdAndDelete = jest.fn().mockResolvedValue({});
    GroupMessage.deleteMany = jest.fn().mockResolvedValue({});

    const res = mkRes();
    await groupController.leaveGroup(
      mkReq({}, { groupId: group._id.toString() }, aliceId), res
    );

    expect(res._body.success).toBe(true);
    expect(Group.findByIdAndDelete).toHaveBeenCalled();
    expect(GroupMessage.deleteMany).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupController.deleteGroupMessage()', () => {
  test('sender xóa tin của mình → thành công', async () => {
    const msgId = fakeId().toString();
    const mockMsg = {
      sender: { toString: () => 'uid_alice' },
      groupId: { toString: () => 'gid_001' },
    };
    GroupMessage.findById         = jest.fn().mockResolvedValue(mockMsg);
    GroupMessage.findByIdAndDelete = jest.fn().mockResolvedValue({});

    const res = mkRes();
    await groupController.deleteGroupMessage(mkReq({ messageId: msgId }, {}, 'uid_alice'), res);

    expect(res._body.success).toBe(true);
    expect(GroupMessage.findByIdAndDelete).toHaveBeenCalledWith(msgId);
  });

  test('non-sender cố xóa → 403', async () => {
    const msgId = fakeId().toString();
    GroupMessage.findById = jest.fn().mockResolvedValue({
      sender: { toString: () => 'uid_alice' },
      groupId: { toString: () => 'gid_001' },
    });
    GroupMessage.findByIdAndDelete = jest.fn();

    const res = mkRes();
    await groupController.deleteGroupMessage(mkReq({ messageId: msgId }, {}, 'uid_bob'), res);

    expect(res._status).toBe(403);
    expect(GroupMessage.findByIdAndDelete).not.toHaveBeenCalled();
  });

  test('messageId không hợp lệ → 400', async () => {
    const res = mkRes();
    await groupController.deleteGroupMessage(mkReq({ messageId: 'invalid-id' }), res);

    expect(res._status).toBe(400);
  });

  test('tin nhắn không tồn tại → 404', async () => {
    GroupMessage.findById = jest.fn().mockResolvedValue(null);

    const res = mkRes();
    await groupController.deleteGroupMessage(
      mkReq({ messageId: fakeId().toString() }, {}, 'uid_alice'), res
    );

    expect(res._status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupController.toggleGroupReaction()', () => {
  function makeGroupMsg(senderId = 'uid_alice', reactions = []) {
    return {
      sender:    { toString: () => senderId },
      groupId:   { toString: () => 'gid_react' },
      reactions,
      save:      jest.fn().mockResolvedValue(true),
    };
  }

  function fakeGroupWithMember(memberId) {
    return {
      members: [{ userId: { toString: () => memberId, _id: { toString: () => memberId } } }],
    };
  }

  test('thêm reaction hợp lệ thành công', async () => {
    const msgId = fakeId().toString();
    const msg   = makeGroupMsg('uid_alice');
    GroupMessage.findById = jest.fn().mockResolvedValue(msg);
    Group.findById        = jest.fn().mockResolvedValue(fakeGroupWithMember('uid_alice'));

    const res = mkRes();
    await groupController.toggleGroupReaction(
      mkReq({ messageId: msgId, emoji: '👍' }, {}, 'uid_alice'), res
    );

    expect(res._body.success).toBe(true);
    expect(msg.reactions).toHaveLength(1);
    expect(msg.reactions[0].emoji).toBe('👍');
  });

  test('cùng emoji → toggle off', async () => {
    const msgId = fakeId().toString();
    const msg   = makeGroupMsg('uid_alice', [{ emoji: '❤️', userId: { toString: () => 'uid_alice' } }]);
    GroupMessage.findById = jest.fn().mockResolvedValue(msg);
    Group.findById        = jest.fn().mockResolvedValue(fakeGroupWithMember('uid_alice'));

    const res = mkRes();
    await groupController.toggleGroupReaction(
      mkReq({ messageId: msgId, emoji: '❤️' }, {}, 'uid_alice'), res
    );

    expect(msg.reactions).toHaveLength(0);
  });

  test('emoji không hợp lệ → 400', async () => {
    GroupMessage.findById = jest.fn().mockResolvedValue(makeGroupMsg());
    Group.findById        = jest.fn().mockResolvedValue(fakeGroupWithMember('uid_alice'));

    const res = mkRes();
    await groupController.toggleGroupReaction(
      mkReq({ messageId: fakeId().toString(), emoji: '🤡' }, {}, 'uid_alice'), res
    );

    expect(res._status).toBe(400);
  });

  test('không phải member của group → 403', async () => {
    const msgId = fakeId().toString();
    GroupMessage.findById = jest.fn().mockResolvedValue(makeGroupMsg('uid_alice'));
    Group.findById        = jest.fn().mockResolvedValue(fakeGroupWithMember('uid_alice')); // chỉ alice

    const res = mkRes();
    await groupController.toggleGroupReaction(
      mkReq({ messageId: msgId, emoji: '👍' }, {}, 'uid_charlie'), // charlie không phải member
      res
    );

    expect(res._status).toBe(403);
  });

  test('messageId không hợp lệ → 400', async () => {
    const res = mkRes();
    await groupController.toggleGroupReaction(
      mkReq({ messageId: 'bad-id', emoji: '👍' }), res
    );

    expect(res._status).toBe(400);
  });
});
