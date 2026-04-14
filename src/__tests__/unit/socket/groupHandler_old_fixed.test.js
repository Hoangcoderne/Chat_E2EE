// src/__tests__/socket/groupHandler.test.js
// Tests cho src/socket/groupHandler.js:
//   - join_groups: chỉ join room của group mà user thật sự là member
//   - send_group_message: verify membership, lưu DB, broadcast tới group
//   - mark_group_read: updateMany readBy, broadcast group_read_update
//   - broadcast_group_member_added / removed: relay events
//   - broadcast_delete_group_message / broadcast_group_reaction
//   - broadcast_group_left: emit + socket leave room

'use strict';

process.env.SESSION_SECRET = 'group_handler_test_secret_2026';

jest.mock('../../../models/Group');
jest.mock('../../../models/GroupMessage');
jest.mock('../../../models/User');
jest.mock('../../../utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));
jest.mock('../../../utils/socketValidator', () => ({
    validateSocketPayload: jest.fn().mockReturnValue({ valid: true }),
    SCHEMAS: {
        send_group_message: {},
        mark_group_read:    {},
        join_groups:        {},
    },
}));

const mongoose       = require('mongoose');
const Group          = require('../../../models/Group');
const GroupMessage   = require('../../../models/GroupMessage');
const User           = require('../../../models/User');
const { validateSocketPayload } = require('../../../utils/socketValidator');
const groupHandler   = require('../../../socket/groupHandler');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSocket(overrides = {}) {
    const listeners  = {};
    const toEmitter  = { emit: jest.fn() };
    const socket = {
        userId:   'uid_alice',
        username: 'alice',
        id:       'socket_grp_001',
        on:       jest.fn((event, fn) => { listeners[event] = fn; }),
        emit:     jest.fn(),
        join:     jest.fn(),
        leave:    jest.fn(),
        to:       jest.fn().mockReturnValue(toEmitter),
        _toEmitter: toEmitter,
        _listeners: listeners,
        async _trigger(event, data) {
            const fn = listeners[event];
            if (!fn) throw new Error(`No listener for '${event}'`);
            return fn(data);
        },
        ...overrides,
    };
    return socket;
}

function makeIo() {
    const emitters = {};
    const io = {
        to: jest.fn().mockImplementation((room) => {
            if (!emitters[room]) emitters[room] = { emit: jest.fn() };
            return emitters[room];
        }),
        emit: jest.fn(),
        _emitters: emitters,
    };
    return io;
}

function fakeGroup(memberIds = ['uid_alice']) {
    return {
        _id:     { toString: () => 'gid_001' },
        name:    'Test Group',
        members: memberIds.map(uid => ({
            userId: { toString: () => uid, _id: { toString: () => uid } },
        })),
    };
}

// ════════════════════════════════════════════════════════════════════════════
describe('groupHandler — join_groups', () => {

    beforeEach(() => jest.clearAllMocks());

    test('chỉ join room của group user là member (filter invalid groups)', async () => {
        Group.find.mockReturnValue({
            select: jest.fn().mockResolvedValue([
                { _id: { toString: () => 'gid_valid_1' } },
                { _id: { toString: () => 'gid_valid_2' } },
            ])
        });

        const io     = makeIo();
        const socket = makeSocket();
        groupHandler(io, socket);

        // Gửi 3 groupId nhưng chỉ 2 được DB xác nhận là member
        await socket._trigger('join_groups', ['gid_valid_1', 'gid_valid_2', 'gid_fake']);

        expect(socket.join).toHaveBeenCalledWith('group:gid_valid_1');
        expect(socket.join).toHaveBeenCalledWith('group:gid_valid_2');
        expect(socket.join).toHaveBeenCalledTimes(2); // không join gid_fake
    });

    test('groupIds là mảng rỗng → DB trả về [] → không join', async () => {
        // clearAllMocks() không reset mockReturnValue của test trước.
        // Cần mock Group.find trả về [] rõ ràng ở đây.
        Group.find.mockReturnValue({
            select: jest.fn().mockResolvedValue([]),
        });

        const io     = makeIo();
        const socket = makeSocket();
        groupHandler(io, socket);

        await socket._trigger('join_groups', []);

        // $in: [] không khớp document nào → không có group hợp lệ → không join
        expect(socket.join).not.toHaveBeenCalled();
    });

    test('vượt quá 100 groupId → bị bỏ qua hoàn toàn', async () => {
        const io     = makeIo();
        const socket = makeSocket();
        groupHandler(io, socket);

        const tooMany = Array.from({ length: 101 }, (_, i) => `gid_${i}`);
        await socket._trigger('join_groups', tooMany);

        expect(Group.find).not.toHaveBeenCalled();
        expect(socket.join).not.toHaveBeenCalled();
    });

    test('groupIds không phải array → bị bỏ qua', async () => {
        const io     = makeIo();
        const socket = makeSocket();
        groupHandler(io, socket);

        await socket._trigger('join_groups', 'not-an-array');

        expect(socket.join).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('groupHandler — send_group_message', () => {

    const VALID_PAYLOAD = {
        groupId:          'gid_001',
        encryptedContent: 'encContent==',
        iv:               'ivBase64==',
        signature:        'sigBase64==',
    };

    function mockGroupMessageCreate(id = 'gmsg_001') {
        GroupMessage.create.mockResolvedValue({
            _id:       { toString: () => id },
            timestamp: new Date('2026-01-01T10:00:00Z'),
            replyTo:   null,
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        validateSocketPayload.mockReturnValue({ valid: true });
    });

    test('member hợp lệ → lưu GroupMessage, broadcast tới group room', async () => {
        Group.findById.mockResolvedValue(fakeGroup(['uid_alice', 'uid_bob']));
        mockGroupMessageCreate();

        const io     = makeIo();
        const socket = makeSocket({ userId: 'uid_alice' });
        groupHandler(io, socket);

        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(GroupMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({
                groupId:          'gid_001',
                sender:           'uid_alice',
                encryptedContent: 'encContent==',
                iv:               'ivBase64==',
            })
        );
        // Broadcast tới room (không bao gồm sender)
        expect(socket.to).toHaveBeenCalledWith('group:gid_001');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith(
            'receive_group_message',
            expect.objectContaining({ groupId: 'gid_001', senderId: 'uid_alice' })
        );
    });

    test('member hợp lệ → multi-device sync qua io.to(senderId)', async () => {
        Group.findById.mockResolvedValue(fakeGroup(['uid_alice']));
        mockGroupMessageCreate();

        const io     = makeIo();
        const socket = makeSocket({ userId: 'uid_alice' });
        groupHandler(io, socket);

        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(io.to).toHaveBeenCalledWith('uid_alice');
        expect(io._emitters['uid_alice'].emit).toHaveBeenCalledWith(
            'group_message_sent_sync',
            expect.objectContaining({ senderSocketId: 'socket_grp_001' })
        );
    });

    test('không phải member → emit error, KHÔNG lưu DB', async () => {
        Group.findById.mockResolvedValue(fakeGroup(['uid_bob'])); // alice không trong group

        const io     = makeIo();
        const socket = makeSocket({ userId: 'uid_alice' });
        groupHandler(io, socket);

        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(GroupMessage.create).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
    });

    test('group không tồn tại → emit error, KHÔNG lưu DB', async () => {
        Group.findById.mockResolvedValue(null);

        const io     = makeIo();
        const socket = makeSocket();
        groupHandler(io, socket);

        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(GroupMessage.create).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
    });

    test('payload validation thất bại → emit error, không tiếp tục', async () => {
        validateSocketPayload.mockReturnValueOnce({ valid: false, error: 'groupId invalid' });

        const io     = makeIo();
        const socket = makeSocket();
        groupHandler(io, socket);

        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(Group.findById).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith('error', 'groupId invalid');
    });

    test('readBy của message mới include senderId (sender tự coi là đã đọc)', async () => {
        Group.findById.mockResolvedValue(fakeGroup(['uid_alice']));
        mockGroupMessageCreate();

        const io     = makeIo();
        const socket = makeSocket({ userId: 'uid_alice' });
        groupHandler(io, socket);

        await socket._trigger('send_group_message', VALID_PAYLOAD);

        expect(GroupMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({ readBy: ['uid_alice'] })
        );
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('groupHandler — mark_group_read', () => {

    beforeEach(() => jest.clearAllMocks());

    test('updateMany readBy và broadcast group_read_update', async () => {
        GroupMessage.updateMany.mockResolvedValue({ modifiedCount: 5 });

        const io     = makeIo();
        const socket = makeSocket({ userId: 'uid_alice', username: 'alice' });
        groupHandler(io, socket);

        await socket._trigger('mark_group_read', { groupId: 'gid_001' });

        expect(GroupMessage.updateMany).toHaveBeenCalledWith(
            { groupId: 'gid_001', readBy: { $ne: 'uid_alice' } },
            { $addToSet: { readBy: 'uid_alice' } }
        );
        expect(socket.to).toHaveBeenCalledWith('group:gid_001');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith(
            'group_read_update',
            { groupId: 'gid_001', userId: 'uid_alice', username: 'alice' }
        );
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('groupHandler — broadcast_group_member_removed', () => {

    beforeEach(() => jest.clearAllMocks());

    test('emit group_member_removed tới group room và group_kicked tới removed user', async () => {
        const io     = makeIo();
        const socket = makeSocket({ userId: 'uid_alice' });
        groupHandler(io, socket);

        await socket._trigger('broadcast_group_member_removed', {
            groupId:        'gid_001',
            removedUserId:  'uid_carol',
            removedName:    'carol',
        });

        // Implementation dùng io.to() (broadcast tới tất cả, kể cả sender),
        // không phải socket.to() (loại trừ sender). Đây là intentional:
        // admin cũng cần thấy event xóa thành viên ngay lập tức.
        expect(io.to).toHaveBeenCalledWith('group:gid_001');
        expect(io._emitters['group:gid_001'].emit).toHaveBeenCalledWith(
            'group_member_removed',
            { groupId: 'gid_001', removedUserId: 'uid_carol', removedName: 'carol' }
        );

        // Emit riêng tới user bị xóa
        expect(io.to).toHaveBeenCalledWith('uid_carol');
        expect(io._emitters['uid_carol'].emit).toHaveBeenCalledWith(
            'group_kicked', { groupId: 'gid_001' }
        );
    });

    test('bỏ qua nếu socket.userId null', async () => {
        const io     = makeIo();
        const socket = makeSocket({ userId: null });
        groupHandler(io, socket);

        await socket._trigger('broadcast_group_member_removed', {
            groupId: 'gid_001', removedUserId: 'uid_carol', removedName: 'carol',
        });

        expect(socket.to).not.toHaveBeenCalled();
        expect(io.to).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('groupHandler — broadcast_delete_group_message', () => {

    beforeEach(() => jest.clearAllMocks());

    test('emit message_deleted tới group room (không bao gồm sender)', async () => {
        const io     = makeIo();
        const socket = makeSocket({ userId: 'uid_alice' });
        groupHandler(io, socket);

        await socket._trigger('broadcast_delete_group_message', {
            groupId:   'gid_001',
            messageId: 'gmsg_del_001',
        });

        // Dùng socket.to (không bao gồm sender — sender đã tự remove khỏi UI)
        expect(socket.to).toHaveBeenCalledWith('group:gid_001');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith(
            'message_deleted', { messageId: 'gmsg_del_001' }
        );
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('groupHandler — broadcast_group_reaction', () => {

    beforeEach(() => jest.clearAllMocks());

    test('emit reaction_updated tới group room', async () => {
        const io        = makeIo();
        const socket    = makeSocket({ userId: 'uid_alice' });
        const reactions = [{ emoji: '❤️', userId: 'uid_alice' }];
        groupHandler(io, socket);

        await socket._trigger('broadcast_group_reaction', {
            groupId:   'gid_001',
            messageId: 'gmsg_001',
            reactions,
        });

        expect(socket.to).toHaveBeenCalledWith('group:gid_001');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith(
            'reaction_updated', { messageId: 'gmsg_001', reactions }
        );
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('groupHandler — broadcast_group_left', () => {

    beforeEach(() => jest.clearAllMocks());

    test('emit group_member_removed tới group room và socket.leave()', async () => {
        const io     = makeIo();
        const socket = makeSocket({ userId: 'uid_alice' });
        groupHandler(io, socket);

        await socket._trigger('broadcast_group_left', {
            groupId:     'gid_001',
            leavingName: 'alice',
        });

        expect(socket.to).toHaveBeenCalledWith('group:gid_001');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith(
            'group_member_removed',
            {
                groupId:       'gid_001',
                removedUserId: 'uid_alice',
                leavingName:   'alice',
            }
        );
        expect(socket.leave).toHaveBeenCalledWith('group:gid_001');
    });

    test('bỏ qua nếu socket.userId null', async () => {
        const io     = makeIo();
        const socket = makeSocket({ userId: null });
        groupHandler(io, socket);

        await socket._trigger('broadcast_group_left', { groupId: 'gid_001', leavingName: 'x' });

        expect(socket.to).not.toHaveBeenCalled();
        expect(socket.leave).not.toHaveBeenCalled();
    });
});
