// src/__tests__/helpers/browserGlobals.js
// Cung cấp browser globals cho Node.js test environment.
// Được load bởi Jest setupFiles trước mỗi test suite.
// Cần thiết vì public/js/crypto/key-manager.js dùng window.crypto, window.btoa, window.atob.

if (typeof window === 'undefined') {
    // Node.js 18+ có globalThis.crypto (Web Crypto API) và globalThis.btoa/atob sẵn có.
    // Chỉ cần tạo global window trỏ vào các API đó.
    global.window = {
        crypto:    globalThis.crypto,
        btoa:      globalThis.btoa,
        atob:      globalThis.atob,
    };
}
