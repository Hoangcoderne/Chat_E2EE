# SecureChat — End-to-End Encrypted Messaging System

> A web-based messaging application built on a **Zero-Knowledge Architecture**. The server acts only as a blind relay and never has access to user passwords, private keys, or plaintext message content. All cryptographic operations occur strictly on the client-side via the **Web Crypto API**.

---

## Demo
### Image Demo

| Register | Login |
|:---:|:---:|
|![Register Page](image/Register.png)|![Register Page](image/Login.png)|

| Save Recovery Key | Forgot Password |
|:---:|:---:|
|![Register Page](image/Save_RecoveryKey.png)|![Register Page](image/Forgot_Pass.png)|

| Home Page |
|:---:|
|![Home Page](image/HomePage.png)|

---

### Live Demo
```
https://chat-e2ee-sjvl.onrender.com/
```

## How It Works

![Register](image/Flow.png)

---

## Features

### Core Messaging
- **End-to-End Encryption (E2EE)** — AES-GCM 256-bit with a unique IV per message
- **ECDH Key Exchange** — Shared secret derived entirely on the client, invisible to the server
- **ECDSA Digital Signatures** — Every message is signed before encryption; recipients verify authenticity after decryption. Tampered messages are hidden with a visible warning
- **Real-time Messaging** — Socket.io with auto-reconnect and identity recovery after disconnection
- **Multi-device Sync** — Sending from one device instantly syncs to all other logged-in devices of the same account
- **Persistent Encrypted History** — MongoDB stores only ciphertext; history is decrypted locally on load

### Messaging UX
- **Message Timestamps** — Displayed below each bubble: time only (today), "Hôm qua HH:mm" (yesterday), or full date
- **Read Status** — `✓` (sent) upgrades to `✓✓` in blue when the recipient opens the conversation
- **Unread Badge** — Red count badge per contact in the sidebar, reset automatically when the chat is opened

### Authentication & Security
- **Zero-Knowledge Authentication** — Server stores only bcrypt hashes; never sees raw passwords or private keys
- **Recovery Key** — 32-byte random key generated at registration, shown once. Used to reset the password without losing the private key or chat history
- **JWT Access Token** — Short-lived (15 min), refreshed silently in the background
- **Refresh Token** — Long-lived (24h), stored in an **HttpOnly cookie** (not accessible by JavaScript) to prevent XSS theft
- **Session Revocation** — All active sessions are invalidated immediately upon password reset
- **Automatic Token Refresh** — `authFetch()` intercepts 401 responses, silently refreshes the token, and retries the original request without interrupting the user

### Social Features
- **Friend Management** — Send, accept, and cancel friend requests with real-time Socket.io notifications
- **Block / Unblock** — Real-time UI update for both parties; blocked users cannot send or receive messages
- **Live Online Status** — Presence tracking via Socket.io connection lifecycle

### Infrastructure
- **Rate Limiting** — 5 failed login attempts per 15 min; 3 password reset attempts per hour; 5 registrations per hour
- **Input Validation** — Server-side validation on all auth and chat endpoints via `express-validator`
- **Security Headers** — `helmet` enforces CSP, X-Frame-Options, HSTS, and more
- **Structured Logging** — Winston-based JSON logs with rotating files (`logs/combined.log`, `logs/error.log`)
- **Global Error Handling** — Unhandled promise rejections and uncaught exceptions are caught, logged, and handled gracefully

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6 Modules) |
| Cryptography | Web Crypto API — ECDH P-256, ECDSA P-256, AES-GCM, PBKDF2 |
| Backend | Node.js, Express.js |
| Real-time | Socket.io (WebSockets) |
| Database | MongoDB, Mongoose |
| Auth | JWT (jsonwebtoken), bcryptjs, HttpOnly Cookies |
| Security | helmet, express-rate-limit, express-validator |
| Logging | Winston |
| Testing | Jest |

---

## Security Architecture

### 1. Zero-Knowledge Registration & Login

```
[Register]
  password + random salt (16 bytes)
        │
        ▼
  PBKDF2 (100,000 iterations, SHA-256)
        │
        ├──▶ encryptionKey ──▶ AES-GCM encrypt ECDH private key    ──▶ stored (server cannot read)
        ├──▶ encryptionKey ──▶ AES-GCM encrypt ECDSA signing key   ──▶ stored (server cannot read)
        └──▶ authKey       ──▶ bcrypt hash                          ──▶ stored

  Recovery Key (32 random bytes)
        ├──▶ AES-GCM encrypt ECDH private key   (backup)           ──▶ stored
        ├──▶ AES-GCM encrypt ECDSA signing key  (backup)           ──▶ stored
        └──▶ bcrypt hash of display string                          ──▶ stored

[Login]
  Same password + salt fetched from server
        │
        ▼
  PBKDF2 re-derives both keys
        │
        ├──▶ authKey       ──▶ compare with server hash ──▶ issue JWT (15m) + set Refresh Cookie (24h)
        └──▶ encryptionKey ──▶ decrypt private key blob ──▶ stored in IndexedDB only
```

The Private Key is **decrypted client-side** and persisted exclusively in the browser's IndexedDB. It is never re-transmitted to the server after the initial registration.

---

### 2. ECDH Key Exchange

When User A opens a chat with User B:

1. Client A fetches Client B's **ECDH Public Key** and **ECDSA Signing Public Key** from the server
2. Client A computes: `SharedSecret = ECDH(A_privateKey, B_publicKey)`
3. Client B computes: `SharedSecret = ECDH(B_privateKey, A_publicKey)`
4. Both arrive at the **same AES-GCM key** — the server never sees it

---

### 3. Message Encryption & Signing

```
[Send]
  plaintext
     │
     ├──▶ ECDSA sign(plaintext, A_signingPrivateKey)  ──▶ signature (Base64)
     │
     ▼
  AES-GCM encrypt(plaintext, sharedSecret, freshIV)
     │
     ▼
  { encryptedContent, iv, signature } ──▶ server (blind relay) ──▶ recipient

[Receive]
  AES-GCM decrypt(encryptedContent, sharedSecret, iv)  ──▶ plaintext
     │
     ▼
  ECDSA verify(plaintext, signature, B_signingPublicKey)
     │
     ├── valid   ──▶ display message normally
     └── invalid ──▶ hide content, show red warning
```

---

### 4. Recovery Key Flow

```
[Password Reset — client-side only]

  1. User inputs Recovery Key display string
  2. Client imports it as AES-GCM key (high entropy, no PBKDF2 needed)
  3. Client decrypts ECDH & ECDSA private keys from recovery-encrypted bundles
  4. Client generates new salt + derives new encryptionKey from new password
  5. Client re-encrypts both private keys with the new encryptionKey
  6. Client sends new { salt, authKeyHash, encryptedKeys } to server
  7. Server verifies Recovery Key hash (bcrypt), updates credentials,
     and REVOKES ALL active refresh tokens (invalidates all sessions)

  Private keys are never regenerated — chat history remains fully decryptable.
```

---

### 5. Zero-Trust API

All protected endpoints extract user identity **exclusively from the verified JWT payload**, never from URL parameters or request body fields. This prevents **IDOR (Insecure Direct Object Reference)** attacks.

The Socket.io `send_message` handler uses `socket.userId` (set at connection time) rather than trusting any `senderId` field from the client, preventing **WebSocket identity spoofing**.

---

### 6. Token Security

| Property | Access Token | Refresh Token |
|---|---|---|
| Storage | `localStorage` | **HttpOnly Cookie** |
| Lifetime | 15 minutes | 24 hours |
| JS readable | Yes | **No** (XSS-safe) |
| Stored in DB | No | Yes (SHA-256 hash only) |
| Revocable | No (short TTL) | Yes (`revoked` flag) |
| Auto-cleanup | — | MongoDB TTL index |

---

## Database Schema

```
Users
├── username                              (unique)
├── salt                                  (Base64 — for PBKDF2 re-derivation)
├── authKeyHash                           (bcrypt — login verification)
├── publicKey                             (ECDH spki — shared openly)
├── encryptedPrivateKey + iv              (AES-GCM wrapped — server cannot read)
├── signingPublicKey                      (ECDSA spki — shared openly)
├── encryptedSigningPrivateKey + signingIv (AES-GCM wrapped)
├── recoveryKeyHash                       (bcrypt — for password reset verification)
├── encryptedPrivateKeyByRecovery + recoveryIv
├── encryptedSigningPrivateKeyByRecovery + recoverySigningIv
├── createdAt
└── notifications[]
      ├── content
      ├── type
      └── createdAt

Friendships
├── requester    (ObjectId → User)
├── recipient    (ObjectId → User)
├── status       ('pending' | 'accepted' | 'blocked')
└── createdAt
     [unique index on (requester, recipient)]

Messages
├── sender           (ObjectId → User)
├── recipient        (ObjectId → User)
├── encryptedContent (ciphertext only — never plaintext)
├── iv               (AES-GCM IV)
├── signature        (ECDSA Base64 — nullable for legacy messages)
├── read             (Boolean — false until recipient opens the chat)
└── timestamp
     [index on (sender, recipient, timestamp)]
     [index on (recipient, read) — for fast unread count queries]

RefreshTokens
├── userId       (ObjectId → User)
├── tokenHash    (SHA-256 hex — plaintext never stored)
├── expiresAt    (Date — TTL index auto-deletes expired documents)
├── revoked      (Boolean)
└── createdAt
```

---

## Project Structure

```
CHAT_E2EE/
├── .env
├── package.json
│
├── src/                          # Backend (Node.js / Express)
│   ├── server.js                 # Express app, Socket.io events, middleware
│   ├── config/
│   │   └── db.js
│   ├── models/
│   │   ├── User.js
│   │   ├── Message.js            # + read field, compound indexes
│   │   ├── Friendship.js
│   │   └── RefreshToken.js       # HttpOnly cookie session store
│   ├── controllers/
│   │   ├── authController.js     # Register, login, refresh, logout, password reset
│   │   └── chatController.js     # History, contacts (+ unreadCount), block, unfriend
│   ├── routes/
│   │   ├── authRoutes.js
│   │   └── chatRoutes.js
│   ├── middleware/
│   │   ├── authMiddleware.js     # JWT verify, TOKEN_EXPIRED code for auto-refresh
│   │   ├── rateLimiter.js        # Per-route rate limits (login / register / reset)
│   │   ├── validators.js         # express-validator schemas
│   │   └── requestLogger.js      # HTTP request logging middleware
│   └── utils/
│       ├── logger.js             # Winston structured logger
│       └── crypto.js             # hashToken, hashPassword, verifyPassword helpers
│
└── public/                       # Frontend (Vanilla JS ES Modules)
    ├── index.html
    ├── login.html
    ├── register.html
    ├── forgot-password.html
    ├── styles/
    │   └── main.css
    └── js/
        ├── app.js                # Main chat UI, socket events, multi-device sync
        ├── login.js
        ├── register.js
        ├── forgot-password.js
        └── crypto/
            └── key-manager.js    # All Web Crypto API operations
```

---

## Installation & Setup

### Prerequisites
- Node.js v16+
- MongoDB (local or Atlas)

---

## Running Tests

```bash
# Run all unit tests
npm test

# With coverage report
npm test -- --coverage
```

Tests cover the server-side crypto utility (`src/utils/crypto.js`): token hashing, password hashing, and verification.

---

## Known Limitations

- **No HTTPS out of the box** — A reverse proxy (Nginx + Let's Encrypt) is strongly recommended for production
- **No message deletion** — Messages persist in the database; a delete/unsend feature is not yet implemented
- **No media support** — Text messages only; file and image sharing are not supported
- **Single-group conversations** — Only 1-to-1 private chats are supported; group messaging is not implemented

---

## Author

**Nguyen Tran Minh Hoang** — Full-stack Developer