// src/__tests__/unit/socket/friendHandler.test.js
// Unit tests cho src/socket/friendHandler.js

jest.mock('../../models/User');
jest.mock('../../models/Friendship');
jest.mock('../../utils/logger', () => ({
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
}));

const User          = require('../../models/User');
const Friendship    = require('../../models/Friendship');
const friendHandler = require('../../socket/friendHandler');

// ── Mock factories ────────────────────────────────────────────────────────

function createMockSocket(overrides = {}) {
    const handlers = {};
    const toEmitter = { emit: jest.fn() };
    const socket = {
        userId:   'uid_alice',
        username: 'alice',
        id:       'socket_001',
        emit:     jest.fn(),
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

function createMockIo() {
    return { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
}

// Helper: mock User.findByIdAndUpdate trả về object có notifications array
function mockFindByIdAndUpdateWithNotif(content, type = 'info') {
    User.findByIdAndUpdate.mockResolvedValue({
        notifications: [{ _id: 'notif_abc', content, type }],
    });
}

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════
describe('friendHandler — send_friend_request', () => {
    test('thành công: lưu friendship + notify target + emit success cho sender', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        User.findOne.mockReturnValue({
            select: jest.fn().mockResolvedValue({
                _id:      { toString: () => 'uid_bob' },
                username: 'bob',
            }),
        });
        Friendship.findOne.mockResolvedValue(null);         // chưa có friendship
        const mockFriendship = { save: jest.fn().mockResolvedValue(true) };
        Friendship.mockImplementation(() => mockFriendship);
        mockFindByIdAndUpdateWithNotif('Đã gửi lời mời tới bob', 'friend_request_sent');

        friendHandler(io, socket);
        await socket._trigger('send_friend_request', { targetUsername: 'bob' });

        // Friendship được tạo
        expect(mockFriendship.save).toHaveBeenCalled();
        // Notify real-time tới bob
        expect(socket.to).toHaveBeenCalledWith('uid_bob');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('receive_friend_request', {
            fromUser: 'alice',
            fromId:   'uid_alice',
        });
        // Emit kết quả thành công cho sender
        expect(socket.emit).toHaveBeenCalledWith('request_sent_success', {
            _id:     'notif_abc',
            content: expect.stringContaining('bob'),
        });
    });

    test('socket không có userId → emit error session expired', async () => {
        const io     = createMockIo();
        const socket = createMockSocket({ userId: null });

        friendHandler(io, socket);
        await socket._trigger('send_friend_request', { targetUsername: 'bob' });

        expect(socket.emit).toHaveBeenCalledWith('error', expect.stringContaining('gián đoạn'));
        expect(User.findOne).not.toHaveBeenCalled();
    });

    test('target không tồn tại → emit error', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

        friendHandler(io, socket);
        await socket._trigger('send_friend_request', { targetUsername: 'ghost' });

        expect(socket.emit).toHaveBeenCalledWith('error', 'Người dùng không tồn tại');
        expect(Friendship).not.toHaveBeenCalled();
    });

    test('gửi lời mời cho chính mình → emit error', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        // targetUser._id.toString() === socket.userId
        User.findOne.mockReturnValue({
            select: jest.fn().mockResolvedValue({
                _id:      { toString: () => 'uid_alice' }, // cùng với socket.userId
                username: 'alice',
            }),
        });

        friendHandler(io, socket);
        await socket._trigger('send_friend_request', { targetUsername: 'alice' });

        expect(socket.emit).toHaveBeenCalledWith('error', expect.stringContaining('chính mình'));
        expect(Friendship).not.toHaveBeenCalled();
    });

    test('đã là bạn bè (accepted) → emit error', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        User.findOne.mockReturnValue({
            select: jest.fn().mockResolvedValue({ _id: { toString: () => 'uid_bob' }, username: 'bob' }),
        });
        Friendship.findOne.mockResolvedValue({ status: 'accepted' });

        friendHandler(io, socket);
        await socket._trigger('send_friend_request', { targetUsername: 'bob' });

        expect(socket.emit).toHaveBeenCalledWith('error', 'Hai bạn đã là bạn bè');
    });

    test('đang chờ chấp nhận (pending) → emit error', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        User.findOne.mockReturnValue({
            select: jest.fn().mockResolvedValue({ _id: { toString: () => 'uid_bob' }, username: 'bob' }),
        });
        Friendship.findOne.mockResolvedValue({ status: 'pending' });

        friendHandler(io, socket);
        await socket._trigger('send_friend_request', { targetUsername: 'bob' });

        expect(socket.emit).toHaveBeenCalledWith('error', 'Đang chờ chấp nhận');
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('friendHandler — accept_friend_request', () => {
    test('thành công: update friendship + notify requester + emit handshake', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        Friendship.findOneAndUpdate.mockResolvedValue({ status: 'accepted' });
        mockFindByIdAndUpdateWithNotif('alice đã chấp nhận lời mời kết bạn!', 'friend_accept');
        User.findById.mockReturnValue({
            select: jest.fn().mockResolvedValue({ username: 'bob' }),
        });

        friendHandler(io, socket);
        await socket._trigger('accept_friend_request', { requesterId: 'uid_bob' });

        // Notify requester
        expect(socket.to).toHaveBeenCalledWith('uid_bob');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('request_accepted', {
            accepterId:   'uid_alice',
            accepterName: 'alice',
            notification: { _id: 'notif_abc', content: expect.stringContaining('chấp nhận') },
        });
        // Kích hoạt ECDH handshake
        expect(socket.emit).toHaveBeenCalledWith('start_handshake_init', {
            targetId:       'uid_bob',
            targetUsername: 'bob',
        });
    });

    test('friendship không tồn tại → noop (không emit gì)', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        Friendship.findOneAndUpdate.mockResolvedValue(null);

        friendHandler(io, socket);
        await socket._trigger('accept_friend_request', { requesterId: 'uid_bob' });

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
        expect(socket.emit).not.toHaveBeenCalled();
    });

    test('socket không có userId → emit error', async () => {
        const io     = createMockIo();
        const socket = createMockSocket({ userId: null });

        friendHandler(io, socket);
        await socket._trigger('accept_friend_request', { requesterId: 'uid_bob' });

        expect(socket.emit).toHaveBeenCalledWith('error', expect.stringContaining('gián đoạn'));
        expect(Friendship.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('update Friendship với đúng query (requester, recipient, status pending)', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        Friendship.findOneAndUpdate.mockResolvedValue({ status: 'accepted' });
        mockFindByIdAndUpdateWithNotif('content');
        User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ username: 'bob' }) });

        friendHandler(io, socket);
        await socket._trigger('accept_friend_request', { requesterId: 'uid_bob' });

        expect(Friendship.findOneAndUpdate).toHaveBeenCalledWith(
            { requester: 'uid_bob', recipient: 'uid_alice', status: 'pending' },
            { status: 'accepted' },
            { new: true }
        );
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('friendHandler — clear_notification', () => {
    test('có notifId → gọi User.findByIdAndUpdate với $pull', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        User.findByIdAndUpdate.mockResolvedValue({});

        friendHandler(io, socket);
        await socket._trigger('clear_notification', { notifId: 'notif_xyz' });

        expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
            'uid_alice',
            { $pull: { notifications: { _id: 'notif_xyz' } } }
        );
    });

    test('thiếu notifId → bỏ qua, không gọi findByIdAndUpdate', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        friendHandler(io, socket);
        await socket._trigger('clear_notification', {});

        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    test('notifId là null → bỏ qua', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        friendHandler(io, socket);
        await socket._trigger('clear_notification', { notifId: null });

        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('friendHandler — đăng ký đủ các event', () => {
    test('đăng ký chính xác 3 event handlers', () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        friendHandler(io, socket);

        const events = socket.on.mock.calls.map(([e]) => e);
        expect(events).toEqual(expect.arrayContaining([
            'send_friend_request',
            'accept_friend_request',
            'clear_notification',
        ]));
        expect(events).toHaveLength(3);
    });
});
