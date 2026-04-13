// src/__tests__/unit/socket/messageHandler.test.js
// Unit tests cho src/socket/messageHandler.js
// socketValidator được dùng thật (pure logic, không cần DB).
// mongoose models và logger đều được mock.

process.env.SESSION_SECRET = 'test_secret';

jest.mock('../../models/Message');
jest.mock('../../models/User');
jest.mock('../../models/Friendship');
jest.mock('../../utils/logger', () => ({
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
}));

const mongoose       = require('mongoose');
const Message        = require('../../models/Message');
const User           = require('../../models/User');
const Friendship     = require('../../models/Friendship');
const messageHandler = require('../../socket/messageHandler');

// ── Mock factories ────────────────────────────────────────────────────────

function createIoWithCapture() {
    // Capture riêng emit theo room để assert chính xác
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
        userId:    'uid_alice',
        username:  'alice',
        id:        'socket_abc',
        emit:      jest.fn(),
        to:        jest.fn().mockReturnValue(toEmitter),
        on:        jest.fn((event, cb) => { handlers[event] = cb; }),
        _trigger:  async (event, data) => {
            const handler = handlers[event];
            if (!handler) throw new Error(`Không có handler: ${event}`);
            return handler(data);
        },
        _toEmitter: toEmitter,
        ...overrides,
    };
    return socket;
}

// MongoId hợp lệ để dùng trong payload
const VALID_RECIPIENT_ID = new mongoose.Types.ObjectId().toString();

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════
describe('messageHandler — request_public_key', () => {
    test('user tồn tại → emit response_public_key với đúng fields', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        User.findOne.mockReturnValue({
            select: jest.fn().mockResolvedValue({
                _id:            { toString: () => 'uid_bob' },
                username:       'bob',
                publicKey:      'pkBob==',
                signingPublicKey: 'spkBob==',
            }),
        });

        messageHandler(io, socket);
        await socket._trigger('request_public_key', { username: 'bob' });

        expect(socket.emit).toHaveBeenCalledWith('response_public_key', {
            userId:          'uid_bob',
            publicKey:       'pkBob==',
            signingPublicKey: 'spkBob==',
            username:        'bob',
        });
    });

    test('user không tồn tại → emit error', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        User.findOne.mockReturnValue({
            select: jest.fn().mockResolvedValue(null),
        });

        messageHandler(io, socket);
        await socket._trigger('request_public_key', { username: 'ghost' });

        expect(socket.emit).toHaveBeenCalledWith('error', 'User không tồn tại');
    });

    test('payload thiếu username → emit validation error, không gọi User.findOne', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        messageHandler(io, socket);
        await socket._trigger('request_public_key', {});

        expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
        expect(User.findOne).not.toHaveBeenCalled();
    });

    test('username quá dài (> 20 ký tự) → emit validation error', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        messageHandler(io, socket);
        await socket._trigger('request_public_key', { username: 'a'.repeat(21) });

        expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
        expect(User.findOne).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('messageHandler — send_message', () => {
    const VALID_PAYLOAD = {
        recipientId:      VALID_RECIPIENT_ID,
        encryptedContent: 'dGVzdEVuY3J5cHRlZENvbnRlbnQ=',
        iv:               'aXZCYXNlNjQ=',
        signature:        'c2lnQmFzZTY0==',
    };

    function setupFriendship(status = 'accepted') {
        Friendship.findOne.mockResolvedValue({ status });
    }

    function setupMessageSave() {
        const mockMsg = {
            _id:       { toString: () => 'msg_001' },
            timestamp: new Date('2026-01-01T10:00:00Z'),
            replyTo:   null,
            save:      jest.fn().mockResolvedValue(true),
        };
        Message.mockImplementation(() => mockMsg);
        return mockMsg;
    }

    test('bạn bè + payload hợp lệ → lưu DB, emit tới recipient, sync sender', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        setupFriendship('accepted');
        const mockMsg = setupMessageSave();

        messageHandler(io, socket);
        await socket._trigger('send_message', VALID_PAYLOAD);

        expect(mockMsg.save).toHaveBeenCalled();
        expect(io._emitters[VALID_RECIPIENT_ID].emit).toHaveBeenCalledWith(
            'receive_message',
            expect.objectContaining({
                senderId:         'uid_alice',
                encryptedContent: VALID_PAYLOAD.encryptedContent,
                iv:               VALID_PAYLOAD.iv,
            })
        );
        expect(io._emitters['uid_alice'].emit).toHaveBeenCalledWith(
            'message_sent_sync',
            expect.objectContaining({ senderSocketId: 'socket_abc', recipientId: VALID_RECIPIENT_ID })
        );
    });

    test('không có friendship → emit system_message cho cả hai bên', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        Friendship.findOne.mockResolvedValue(null);

        messageHandler(io, socket);
        await socket._trigger('send_message', VALID_PAYLOAD);

        expect(socket.emit).toHaveBeenCalledWith('system_message', expect.objectContaining({
            text: expect.stringContaining('bạn bè'),
        }));
        // Cũng notify recipient
        expect(io._emitters[VALID_RECIPIENT_ID].emit).toHaveBeenCalledWith(
            'system_message', expect.any(Object)
        );
        expect(Message).not.toHaveBeenCalled();
    });

    test('friendship pending → emit system_message (chưa chấp nhận)', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        setupFriendship('pending');

        messageHandler(io, socket);
        await socket._trigger('send_message', VALID_PAYLOAD);

        expect(socket.emit).toHaveBeenCalledWith('system_message', expect.any(Object));
        expect(Message).not.toHaveBeenCalled();
    });

    test('friendship blocked → emit error, không lưu tin', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        setupFriendship('blocked');

        messageHandler(io, socket);
        await socket._trigger('send_message', VALID_PAYLOAD);

        expect(socket.emit).toHaveBeenCalledWith('error', expect.stringContaining('chặn'));
        expect(Message).not.toHaveBeenCalled();
    });

    test('socket không có userId → emit error session expired', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        messageHandler(io, socket);
        await socket._trigger('send_message', VALID_PAYLOAD);

        expect(socket.emit).toHaveBeenCalledWith('error', expect.stringContaining('gián đoạn'));
        expect(Friendship.findOne).not.toHaveBeenCalled();
    });

    test('payload thiếu encryptedContent → emit validation error', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        messageHandler(io, socket);
        await socket._trigger('send_message', { recipientId: VALID_RECIPIENT_ID, iv: 'iv==' });

        expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
        expect(Friendship.findOne).not.toHaveBeenCalled();
    });

    test('payload thiếu recipientId → emit validation error', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        messageHandler(io, socket);
        await socket._trigger('send_message', {
            encryptedContent: 'enc==', iv: 'iv==',
        });

        expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
    });

    test('replyTo được truyền vào Message constructor nếu có', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        setupFriendship('accepted');
        setupMessageSave();

        const replyTo = {
            messageId: new mongoose.Types.ObjectId().toString(),
            senderName: 'bob',
            encryptedContent: 'enc==',
            iv: 'iv==',
        };

        let capturedData = null;
        Message.mockImplementation((data) => {
            capturedData = data;
            return { _id: { toString: () => 'm1' }, timestamp: new Date(), replyTo: data.replyTo, save: jest.fn().mockResolvedValue(true) };
        });

        messageHandler(io, socket);
        await socket._trigger('send_message', { ...VALID_PAYLOAD, replyTo });

        expect(capturedData.replyTo).toEqual(replyTo);
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('messageHandler — mark_read', () => {
    test('có tin chưa đọc → updateMany + emit messages_read tới partner', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        Message.updateMany.mockResolvedValue({ modifiedCount: 3 });

        messageHandler(io, socket);
        await socket._trigger('mark_read', { partnerId: 'uid_bob' });

        expect(Message.updateMany).toHaveBeenCalledWith(
            { sender: 'uid_bob', recipient: 'uid_alice', read: false },
            { read: true }
        );
        expect(io._emitters['uid_bob'].emit).toHaveBeenCalledWith('messages_read', {
            by: 'uid_alice',
        });
    });

    test('không có tin chưa đọc (modifiedCount=0) → không emit messages_read', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        Message.updateMany.mockResolvedValue({ modifiedCount: 0 });

        messageHandler(io, socket);
        await socket._trigger('mark_read', { partnerId: 'uid_bob' });

        expect(Message.updateMany).toHaveBeenCalled();
        // io.to('uid_bob') không được gọi nếu modifiedCount = 0
        expect(io._emitters['uid_bob']).toBeUndefined();
    });

    test('socket không có userId → bỏ qua, không gọi updateMany', async () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        messageHandler(io, socket);
        await socket._trigger('mark_read', { partnerId: 'uid_bob' });

        expect(Message.updateMany).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('messageHandler — broadcast_delete_message', () => {
    test('emit message_deleted tới recipient và sync sender', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        messageHandler(io, socket);
        socket._trigger('broadcast_delete_message', {
            messageId:   'msg_xyz',
            recipientId: 'uid_bob',
        });

        expect(io._emitters['uid_bob'].emit).toHaveBeenCalledWith(
            'message_deleted', { messageId: 'msg_xyz' }
        );
        // Sync tới thiết bị khác của sender
        expect(io._emitters['uid_alice'].emit).toHaveBeenCalledWith(
            'message_deleted', { messageId: 'msg_xyz' }
        );
    });

    test('socket không có userId → bỏ qua', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        messageHandler(io, socket);
        socket._trigger('broadcast_delete_message', { messageId: 'm1', recipientId: 'uid_bob' });

        expect(io.to).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('messageHandler — broadcast_reaction', () => {
    test('emit reaction_updated tới partner và sync sender', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();
        const reactions = [{ emoji: '👍', userId: 'uid_alice' }];

        messageHandler(io, socket);
        socket._trigger('broadcast_reaction', {
            messageId: 'msg_001',
            reactions,
            partnerId: 'uid_bob',
        });

        expect(io._emitters['uid_bob'].emit).toHaveBeenCalledWith('reaction_updated', {
            messageId: 'msg_001', reactions,
        });
        expect(io._emitters['uid_alice'].emit).toHaveBeenCalledWith('reaction_updated', {
            messageId: 'msg_001', reactions,
        });
    });

    test('socket không có userId → bỏ qua', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        messageHandler(io, socket);
        socket._trigger('broadcast_reaction', { messageId: 'm1', reactions: [], partnerId: 'uid_bob' });

        expect(io.to).not.toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════
describe('messageHandler — notify_block / notify_unblock / notify_unfriend', () => {
    test('notify_block: emit you_have_been_blocked tới target', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        messageHandler(io, socket);
        socket._trigger('notify_block', { targetId: 'uid_bob' });

        expect(socket.to).toHaveBeenCalledWith('uid_bob');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('you_have_been_blocked', {
            blockerId: 'uid_alice',
        });
    });

    test('notify_unblock: emit you_have_been_unblocked tới target', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        messageHandler(io, socket);
        socket._trigger('notify_unblock', { targetId: 'uid_bob' });

        expect(socket.to).toHaveBeenCalledWith('uid_bob');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('you_have_been_unblocked', {
            unblockerId: 'uid_alice',
        });
    });

    test('notify_unfriend: emit you_have_been_unfriended tới target', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket();

        messageHandler(io, socket);
        socket._trigger('notify_unfriend', { targetId: 'uid_bob' });

        expect(socket.to).toHaveBeenCalledWith('uid_bob');
        expect(socket._toEmitter.emit).toHaveBeenCalledWith('you_have_been_unfriended', {
            unfrienderId: 'uid_alice',
        });
    });

    test('notify_block: userId null → bỏ qua', () => {
        const io     = createIoWithCapture();
        const socket = createMockSocket({ userId: null });

        messageHandler(io, socket);
        socket._trigger('notify_block', { targetId: 'uid_bob' });

        expect(socket._toEmitter.emit).not.toHaveBeenCalled();
    });
});
