// src/utils/crypto.test.js
const cryptoUtil = require('./crypto');

describe('Tiện ích Crypto', () => {

    // ── hashToken ──────────────────────────────────
    describe('hashToken()', () => {
        test('hash cùng input → cùng output (deterministic)', () => {
            const token = 'my-test-token-123';
            expect(cryptoUtil.hashToken(token)).toBe(cryptoUtil.hashToken(token));
        });

        test('hash khác nhau cho input khác nhau', () => {
            expect(cryptoUtil.hashToken('tokenA')).not.toBe(cryptoUtil.hashToken('tokenB'));
        });

        test('output là chuỗi hex 64 ký tự (SHA-256)', () => {
            expect(cryptoUtil.hashToken('anything')).toMatch(/^[a-f0-9]{64}$/);
        });
    });

    // ── generateRefreshToken ───────────────────────
    describe('generateRefreshToken()', () => {
        test('tạo chuỗi hex 128 ký tự (64 bytes)', () => {
            const token = cryptoUtil.generateRefreshToken();
            expect(token).toMatch(/^[a-f0-9]{128}$/);
        });

        test('mỗi lần gọi tạo token khác nhau (random)', () => {
            const t1 = cryptoUtil.generateRefreshToken();
            const t2 = cryptoUtil.generateRefreshToken();
            expect(t1).not.toBe(t2);
        });
    });

    // ── hashPassword ───────────────────────────────
    describe('hashPassword()', () => {
        test('hash không giống plaintext', async () => {
            const pw = 'MyPassword123!';
            const hash = await cryptoUtil.hashPassword(pw);
            expect(hash).not.toBe(pw);
            expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix
        });

        test('cùng password → hash khác nhau (bcrypt salt khác nhau)', async () => {
            const pw = 'MyPassword123!';
            const h1 = await cryptoUtil.hashPassword(pw);
            const h2 = await cryptoUtil.hashPassword(pw);
            expect(h1).not.toBe(h2);
        });
    });

    // ── verifyPassword ─────────────────────────────
    describe('verifyPassword()', () => {
        test('xác minh đúng password → true', async () => {
            const pw = 'CorrectPassword!';
            const hash = await cryptoUtil.hashPassword(pw);
            expect(await cryptoUtil.verifyPassword(pw, hash)).toBe(true);
        });

        test('sai password → false', async () => {
            const hash = await cryptoUtil.hashPassword('CorrectPassword!');
            expect(await cryptoUtil.verifyPassword('WrongPassword!', hash)).toBe(false);
        });

        test('chuỗi rỗng → false', async () => {
            const hash = await cryptoUtil.hashPassword('SomePassword!');
            expect(await cryptoUtil.verifyPassword('', hash)).toBe(false);
        });
    });

    // ── verifyTokenHash ────────────────────────────
    describe('verifyTokenHash()', () => {
        test('token đúng → true', () => {
            const token = 'abc123def456';
            const hash = cryptoUtil.hashToken(token);
            expect(cryptoUtil.verifyTokenHash(token, hash)).toBe(true);
        });

        test('token sai → false', () => {
            const hash = cryptoUtil.hashToken('token-original');
            expect(cryptoUtil.verifyTokenHash('token-tampered', hash)).toBe(false);
        });

        test('hash rỗng → false', () => {
            expect(cryptoUtil.verifyTokenHash('sometoken', '')).toBe(false);
        });
    });
});
