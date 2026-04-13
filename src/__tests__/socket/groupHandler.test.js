// src/__tests__/unit/socket/groupHandler.test.js
// Unit tests cho src/socket/groupHandler.js

jest.mock('../../models/Group');
jest.mock('../../models/GroupMessage');
jest.mock('../../utils/logger', () => ({
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
}));

const mongoose      = require('mongoose');
const Group         = require('../../models/Group');
const GroupMessage  = require('../../models/GroupMessage');
const groupHandler  = require('../../socket/groupHandler');

// ── Mock factories ────────────────────────────────────────────────────────

function createIoWithCapture() {
    const emitters = {};
    const io = {
        to: jest.fn((room) => {
            if (!emitters[room]) emitters[room] = { emit: jest.fn() };
            return emitters[room];
        }),
        _emitters: emitters,
    };
    return io;
}

function createMockSocket(overrides = {}) {
    const handlers = {};
    const toEmitter = { emit: jest.fn() };
    const socket = {
        userId:   'uid_alice',
        username: 'alice',
        id:       'socket_001',
        emit:     jest.fn(),
        join:     jest.fn(),
        leave:    jest.fn(),
        to:       jest.fn().mockReturnValue(toEmitter),
        on:       jest.fn((event, cb) => { handlers[event] = cb; }),
        _trigger: async (event, data) => {
            const handler = handlers[event];
            if (!handler) throw new Error(`Không có handler: ${event}`);
            return handler(data);
        },
        _toEmitter: toEmitter,
        ...overrides,
    };
    return socket;
}

// Tạo fake group với members gồm userId cho isMember check
function fakeGroupWithMember(userId = 'uid_alice') {
    return {
        _id:     new mongoose.Types.ObjectId(),
        members: [{ userId: { toString: () => userId } }],
    };
}

const VALID_GROUP_ID = new mongoose.Types.ObjectId().toString();

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════
describe('groupHandler — join_groups', () => {
    test('chỉ join các group mà user thật sự là member', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        const gid1 = new mongoose.Types.ObjectId().toString();
        const gid2 = new mongoose.Types.ObjectId().toString();
        Group.find.mockReturnValue({
            select: jest.fn().mockResolvedValue([
                { _id: { toString: () => gid1 } }, // chỉ gid1 hợp lệ
            ]),
        });

        groupHandler(io, socket);
        await socket._trigger('join_groups', [gid1, gid2]);

        expect(socket.join).toHaveBeenCalledWith('group:' + gid1);
        expect(socket.join).not.toHaveBeenCalledWith('group:' + gid2);
    });

    test('join tất cả group hợp lệ', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        const gids = [
            new mongoose.Types.ObjectId().toString(),
            new mongoose.Types.ObjectId().toString(),
        ];

        Group.find.mockReturnValue({
            select: jest.fn().mockResolvedValue(
                gids.map(gid => ({ _id: { toString: () => gid } }))
            ),
        });

        groupHandler(io, socket);
        await socket._trigger('join_groups', gids);

        expect(socket.join).toHaveBeenCalledTimes(gids.length);
        gids.forEach(gid => {
            expect(socket.join).toHaveBeenCalledWith('group:' + gid);
        });
    });

    test('groupIds không phải array → bỏ qua', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        groupHandler(io, socket);
        await socket._trigger('join_groups', 'not-an-array');

        expect(Group.find).not.toHaveBeenCalled();
        expect(socket.join).not.toHaveBeenCalled();
    });

    test('groupIds.length > 100 → bỏ qua', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        groupHandler(io, socket);
        await socket._trigger('join_groups', new Array(101).fill('gid'));

        expect(Group.find).not.toHaveBeenCalled();
    });

    test('array rỗng → không join gì', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        Group.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });

        groupHandler(io, socket);
        await socket._trigger('join_groups', []);

        expect(socket.join).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupHandler — send_group_message', () => {
    const VALID_PAYLOAD = {
        groupId:          VALID_GROUP_ID,
        encryptedContent: 'dGVzdEVuY3J5cHRlZA==',
        iv:               'aXZCYXNlNjQ=',
        signature:        'c2lnQmFzZTY0==',
    };

    function setupGroupWithMember(userId = 'uid_alice') {
        Group.findById.mockResolvedValue(fakeGroupWithMember(userId));
    }

    function setupGroupMessageCreate() {
        const mockMsg = {
            _id:       { toString: () => 'msg_grp_001' },
            timestamp: new Date('2026-01-01T10:00:00Z'),
            replyTo:   null,
        };
        GroupMessage.create.mockResolvedValue(mockMsg);
        return mockMsg;
    }

    test('thành công: lưu DB + broadcast tới group room + sync sender', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        setupGroupWithMember('uid_alice');
        const mockMsg = setupGroupMessageCreate();

        groupHandler(io, socket);
        await socket._trigger('send_group_message', VALID_PAYLOAD);

        // Lưu vào DB
        expect(GroupMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({
                groupId:          VALID_GROUP_ID,
                sender:           'uid_alice',
                encryptedContent: VALID_PAYLOAD.encryptedContent,
            })
        );
        // Broadcast tới group room (không gồm sender)
        expect(socket.to).toHaveBeenCalledWith('group:' + VALID_GROUP_ID);
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('receive_group_message',
            expect.objectContaining({
                groupId:    VALID_GROUP_ID,
                senderId:   'uid_alice',
                senderName: 'alice',
                messageId:  'msg_grp_001',
            })
        );
        // Sync multi-device sender
        expect(io._emitters['uid_alice'].emit).toHaveBeenCalledWith('group_message_sent_sync',
            expect.objectContaining({ senderSocketId: 'socket_001' })
        );
    });

    test('không phải member của group → emit error, không lưu DB', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        // Group không có alice trong members
        Group.findById.mockResolvedValue({ members: [] });

        groupHandler(io, socket);
        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(socket.emit).toHaveBeenCalledWith('error', expect.stringContaining('nhóm'));
        expect(GroupMessage.create).not.toHaveBeenCalled();
    });

    test('group không tồn tại → emit error', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        Group.findById.mockResolvedValue(null);

        groupHandler(io, socket);
        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
        expect(GroupMessage.create).not.toHaveBeenCalled();
    });

    test('socket không có userId → emit error session', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        groupHandler(io, socket);
        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(socket.emit).toHaveBeenCalledWith('error', expect.stringContaining('gián đoạn'));
    });

    test('payload thiếu encryptedContent → emit validation error', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        groupHandler(io, socket);
        await socket._trigger('send_group_message', {
            groupId: VALID_GROUP_ID,
            iv: 'iv==',
        });

        expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
        expect(Group.findById).not.toHaveBeenCalled();
    });

    test('payload thiếu groupId → emit validation error', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        groupHandler(io, socket);
        await socket._trigger('send_group_message', {
            encryptedContent: 'enc==',
            iv: 'iv==',
        });

        expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
    });

    test('sender được thêm vào readBy khi create GroupMessage', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        setupGroupWithMember('uid_alice');
        setupGroupMessageCreate();

        let capturedData = null;
        GroupMessage.create.mockImplementation((data) => {
            capturedData = data;
            return { _id: { toString: () => 'm1' }, timestamp: new Date(), replyTo: null };
        });

        groupHandler(io, socket);
        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(capturedData.readBy).toContain('uid_alice');
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupHandler — mark_group_read', () => {
    test('updateMany + emit group_read_update tới group room', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        GroupMessage.updateMany.mockResolvedValue({ modifiedCount: 2 });

        groupHandler(io, socket);
        await socket._trigger('mark_group_read', { groupId: VALID_GROUP_ID });

        expect(GroupMessage.updateMany).toHaveBeenCalledWith(
            { groupId: VALID_GROUP_ID, readBy: { $ne: 'uid_alice' } },
            { $addToSet: { readBy: 'uid_alice' } }
        );
        expect(socket.to).toHaveBeenCalledWith('group:' + VALID_GROUP_ID);
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('group_read_update', {
            groupId:  VALID_GROUP_ID,
            userId:   'uid_alice',
            username: 'alice',
        });
    });

    test('socket không có userId → bỏ qua', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        groupHandler(io, socket);
        await socket._trigger('mark_group_read', { groupId: VALID_GROUP_ID });

        expect(GroupMessage.updateMany).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupHandler — broadcast_group_member_added', () => {
    test('emit group_member_added tới group room + system message + notify new members', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        const bobId = 'uid_bob';
        Group.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue({
                members: [
                    { userId: { _id: { toString: () => 'uid_alice' }, username: 'alice' } },
                    { userId: { _id: { toString: () => bobId }, username: 'bob' } },
                ],
            }),
        });
        GroupMessage.create.mockResolvedValue({});

        groupHandler(io, socket);
        await socket._trigger('broadcast_group_member_added', {
            groupId:      VALID_GROUP_ID,
            newMemberIds: [bobId],
            groupName:    'Test Group',
        });

        // Broadcast tới toàn bộ group room
        expect(io._emitters['group:' + VALID_GROUP_ID].emit).toHaveBeenCalledWith(
            'group_member_added',
            expect.objectContaining({ groupId: VALID_GROUP_ID, newMemberNames: ['bob'] })
        );
        // Lưu system message vào DB
        expect(GroupMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'system',
                systemText: expect.stringContaining('bob'),
            })
        );
        // Notify riêng cho member mới
        expect(io._emitters[bobId].emit).toHaveBeenCalledWith('group_invited', {
            groupId:     VALID_GROUP_ID,
            groupName:   'Test Group',
            memberCount: 2,
        });
    });

    test('socket không có userId → bỏ qua', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        groupHandler(io, socket);
        await socket._trigger('broadcast_group_member_added', {
            groupId: VALID_GROUP_ID, newMemberIds: ['uid_bob'], groupName: 'G',
        });

        expect(Group.findById).not.toHaveBeenCalled();
    });

    test('group không tồn tại → bỏ qua (không emit)', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        Group.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });

        groupHandler(io, socket);
        await socket._trigger('broadcast_group_member_added', {
            groupId: VALID_GROUP_ID, newMemberIds: ['uid_bob'], groupName: 'G',
        });

        expect(GroupMessage.create).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupHandler — broadcast_group_member_removed', () => {
    test('emit group_member_removed tới group room + group_kicked tới member bị xóa', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        groupHandler(io, socket);
        socket._trigger('broadcast_group_member_removed', {
            groupId:       VALID_GROUP_ID,
            removedUserId: 'uid_bob',
            removedName:   'bob',
        });

        expect(io._emitters['group:' + VALID_GROUP_ID].emit).toHaveBeenCalledWith(
            'group_member_removed',
            { groupId: VALID_GROUP_ID, removedUserId: 'uid_bob', removedName: 'bob' }
        );
        expect(io._emitters['uid_bob'].emit).toHaveBeenCalledWith('group_kicked', {
            groupId: VALID_GROUP_ID,
        });
    });

    test('socket không có userId → bỏ qua', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        groupHandler(io, socket);
        socket._trigger('broadcast_group_member_removed', {
            groupId: VALID_GROUP_ID, removedUserId: 'uid_bob', removedName: 'bob',
        });

        expect(io.to).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupHandler — broadcast_delete_group_message', () => {
    test('emit message_deleted tới group room (dùng socket.to, không gồm sender)', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        groupHandler(io, socket);
        socket._trigger('broadcast_delete_group_message', {
            groupId:   VALID_GROUP_ID,
            messageId: 'msg_del_001',
        });

        expect(socket.to).toHaveBeenCalledWith('group:' + VALID_GROUP_ID);
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('message_deleted', {
            messageId: 'msg_del_001',
        });
    });

    test('socket không có userId → bỏ qua', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        groupHandler(io, socket);
        socket._trigger('broadcast_delete_group_message', {
            groupId: VALID_GROUP_ID, messageId: 'msg_001',
        });

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupHandler — broadcast_group_reaction', () => {
    test('emit reaction_updated tới group room', () => {
        const io       = createIoWithCapture();
        const socket   = createMockSocket();
        const reactions = [{ emoji: '❤️', userId: 'uid_alice' }];

        groupHandler(io, socket);
        socket._trigger('broadcast_group_reaction', {
            groupId:   VALID_GROUP_ID,
            messageId: 'msg_react',
            reactions,
        });

        expect(socket.to).toHaveBeenCalledWith('group:' + VALID_GROUP_ID);
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('reaction_updated', {
            messageId: 'msg_react',
            reactions,
        });
    });

    test('socket không có userId → bỏ qua', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        groupHandler(io, socket);
        socket._trigger('broadcast_group_reaction', {
            groupId: VALID_GROUP_ID, messageId: 'm1', reactions: [],
        });

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupHandler — broadcast_group_left', () => {
    test('emit group_member_removed tới group room + socket leave room', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        groupHandler(io, socket);
        socket._trigger('broadcast_group_left', {
            groupId:     VALID_GROUP_ID,
            leavingName: 'alice',
        });

        expect(socket.to).toHaveBeenCalledWith('group:' + VALID_GROUP_ID);
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('group_member_removed', {
            groupId:       VALID_GROUP_ID,
            removedUserId: 'uid_alice',
            leavingName:   'alice',
        });
        expect(socket.leave).toHaveBeenCalledWith('group:' + VALID_GROUP_ID);
    });

    test('socket không có userId → bỏ qua', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        groupHandler(io, socket);
        socket._trigger('broadcast_group_left', { groupId: VALID_GROUP_ID, leavingName: 'alice' });

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
        expect(socket.leave).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('groupHandler — đăng ký đủ các event', () => {
    test('đăng ký chính xác 8 event handlers', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        groupHandler(io, socket);

        const events = socket.on.mock.calls.map(([e]) => e);
        expect(events).toEqual(expect.arrayContaining([
            'join_groups', 'send_group_message', 'mark_group_read',
            'broadcast_group_member_added', 'broadcast_group_member_removed',
            'broadcast_delete_group_message', 'broadcast_group_reaction',
            'broadcast_group_left',
        ]));
        expect(events).toHaveLength(8);
    });
});
