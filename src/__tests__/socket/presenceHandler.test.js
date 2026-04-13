// src/__tests__/unit/socket/presenceHandler.test.js
// Unit tests cho src/socket/presenceHandler.js
// Dùng jest.mock để mock onlineUsers module, test tất cả event handlers.

jest.mock('../../utils/onlineUsers');
jest.mock('../../utils/logger', () => ({
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
}));

const presenceHandler = require('../../socket/presenceHandler');
const onlineUsers     = require('../../utils/onlineUsers');

// ── Mock factory helpers ──────────────────────────────────────────────────

function createMockSocket(overrides = {}) {
    const handlers = {};
    const toEmitter = { emit: jest.fn() };
    const socket = {
        userId:    'uid_alice',
        username:  'alice',
        id:        'socket_001',
        broadcast: { emit: jest.fn() },
        join:      jest.fn(),
        emit:      jest.fn(),
        to:        jest.fn().mockReturnValue(toEmitter),
        on:        jest.fn((event, cb) => { handlers[event] = cb; }),
        // Helper: trigger event đã đăng ký
        _trigger:  async (event, data) => {
            const handler = handlers[event];
            if (!handler) throw new Error(`Không có handler cho event: ${event}`);
            return handler(data);
        },
        _toEmitter: toEmitter,
        ...overrides,
    };
    return socket;
}

function createMockIo() {
    return { to: jest.fn().mockReturnValue({ emit: jest.fn() }), emit: jest.fn() };
}

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════
describe('presenceHandler — join_user', () => {
    test('join_user: socket join room theo userId', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();
        onlineUsers.isFirstSocket.mockReturnValue(true);

        presenceHandler(io, socket);
        await socket._trigger('join_user');

        expect(socket.join).toHaveBeenCalledWith('uid_alice');
    });

    test('join_user: addSocket được gọi với đúng userId và socketId', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();
        onlineUsers.isFirstSocket.mockReturnValue(false);

        presenceHandler(io, socket);
        await socket._trigger('join_user');

        expect(onlineUsers.addSocket).toHaveBeenCalledWith('uid_alice', 'socket_001');
    });

    test('join_user: socket đầu tiên → broadcast user_status_change online', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();
        onlineUsers.isFirstSocket.mockReturnValue(true);

        presenceHandler(io, socket);
        await socket._trigger('join_user');

        expect(socket.broadcast.emit).toHaveBeenCalledWith('user_status_change', {
            userId: 'uid_alice',
            status: 'online',
        });
    });

    test('join_user: socket thứ 2 cùng user → không broadcast lại', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();
        onlineUsers.isFirstSocket.mockReturnValue(false); // đã có socket khác

        presenceHandler(io, socket);
        await socket._trigger('join_user');

        expect(socket.broadcast.emit).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('presenceHandler — disconnect', () => {
    test('disconnect: gọi removeSocket với đúng userId và socketId', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();
        onlineUsers.removeSocket.mockReturnValue(0);

        presenceHandler(io, socket);
        await socket._trigger('disconnect');

        expect(onlineUsers.removeSocket).toHaveBeenCalledWith('uid_alice', 'socket_001');
    });

    test('disconnect: socket cuối cùng (remaining=0) → broadcast offline', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();
        onlineUsers.removeSocket.mockReturnValue(0);

        presenceHandler(io, socket);
        await socket._trigger('disconnect');

        expect(socket.broadcast.emit).toHaveBeenCalledWith('user_status_change', {
            userId: 'uid_alice',
            status: 'offline',
        });
    });

    test('disconnect: vẫn còn socket khác (remaining > 0) → không broadcast offline', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();
        onlineUsers.removeSocket.mockReturnValue(1); // còn 1 socket

        presenceHandler(io, socket);
        await socket._trigger('disconnect');

        expect(socket.broadcast.emit).not.toHaveBeenCalled();
    });

    test('disconnect: socket không có userId → bỏ qua, không gọi removeSocket', async () => {
        const io     = createMockIo();
        const socket = createMockSocket({ userId: null });

        presenceHandler(io, socket);
        await socket._trigger('disconnect');

        expect(onlineUsers.removeSocket).not.toHaveBeenCalled();
        expect(socket.broadcast.emit).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('presenceHandler — typing / stop_typing (DM)', () => {
    test('typing: relay user_typing tới recipientId', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        presenceHandler(io, socket);
        await socket._trigger('typing', { recipientId: 'uid_bob' });

        expect(socket.to).toHaveBeenCalledWith('uid_bob');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('user_typing', { userId: 'uid_alice' });
    });

    test('typing: thiếu recipientId → không emit', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        presenceHandler(io, socket);
        await socket._trigger('typing', {});

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
    });

    test('typing: socket không có userId → không emit', async () => {
        const io     = createMockIo();
        const socket = createMockSocket({ userId: null });

        presenceHandler(io, socket);
        await socket._trigger('typing', { recipientId: 'uid_bob' });

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
    });

    test('stop_typing: relay user_stop_typing tới recipientId', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        presenceHandler(io, socket);
        await socket._trigger('stop_typing', { recipientId: 'uid_bob' });

        expect(socket.to).toHaveBeenCalledWith('uid_bob');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('user_stop_typing', { userId: 'uid_alice' });
    });

    test('stop_typing: thiếu recipientId → không emit', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        presenceHandler(io, socket);
        await socket._trigger('stop_typing', {});

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('presenceHandler — group_typing / stop_group_typing', () => {
    test('group_typing: relay group_user_typing với userId và username', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        presenceHandler(io, socket);
        await socket._trigger('group_typing', { groupId: 'gid_001' });

        expect(socket.to).toHaveBeenCalledWith('gid_001');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('group_user_typing', {
            userId:   'uid_alice',
            username: 'alice',
        });
    });

    test('group_typing: thiếu groupId → không emit', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        presenceHandler(io, socket);
        await socket._trigger('group_typing', {});

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
    });

    test('stop_group_typing: relay group_user_stop_typing', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        presenceHandler(io, socket);
        await socket._trigger('stop_group_typing', { groupId: 'gid_001' });

        expect(socket.to).toHaveBeenCalledWith('gid_001');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('group_user_stop_typing', {
            userId: 'uid_alice',
        });
    });

    test('stop_group_typing: thiếu groupId → không emit', async () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        presenceHandler(io, socket);
        await socket._trigger('stop_group_typing', {});

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('presenceHandler — đăng ký đủ các event', () => {
    test('đăng ký chính xác 6 event handlers', () => {
        const io     = createMockIo();
        const socket = createMockSocket();

        presenceHandler(io, socket);

        const registeredEvents = socket.on.mock.calls.map(([event]) => event);
        expect(registeredEvents).toEqual(expect.arrayContaining([
            'join_user', 'disconnect',
            'typing', 'stop_typing',
            'group_typing', 'stop_group_typing',
        ]));
        expect(registeredEvents).toHaveLength(6);
    });
});
