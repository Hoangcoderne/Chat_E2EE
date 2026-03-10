# SecureChat — End-to-End Encrypted Messaging System

> A web-based messaging application built on a **Zero-Knowledge Architecture**. The server acts only as a blind relay and never has access to user passwords, private keys, or plaintext message content. All cryptographic operations occur strictly on the client-side via the **Web Crypto API**.

---

## Demo
### Image Demo
Regiser Page
![Register Page](image/Register.png)

Login Page
![Login Page](image/Login.png)

Home Page
![Home Page](image/HomePage.png)

---

## How It Works

```
[Client A]                      [Server]                       [Client B]
    │                              │                                │
    │── GET B's public key ───────>│                                │
    │<─ return B's public key ─────│                                │
    │                              │                                │
    │  derive SharedSecret         │            derive SharedSecret │
    │  (ECDH: A_priv × B_pub)      │          (ECDH: B_priv × A_pub)│
    │                              │                                │
    │── AES-GCM encrypt(msg) ─────>│─── relay ciphertext ──────────>│
    │                              │                                │
    │                 Server only sees ciphertext + IV              │
    │                 SharedSecret is NEVER transmitted             │
```

---

## Features

- **End-to-End Encryption (E2EE)** — AES-GCM 256-bit with unique IV per message
- **Zero-Knowledge Authentication** — Server stores only bcrypt-hashed derivatives; never sees raw passwords or private keys
- **ECDH Key Exchange** — Shared secret derived entirely on the client, invisible to the server
- **JWT Session Management** — Stateless auth with server-side identity extraction to prevent IDOR
- **Real-time Messaging** — Powered by Socket.io with auto-reconnect and identity recovery
- **Friend Management** — Send, accept, unfriend with real-time Socket.io events
- **Block / Unblock** — Real-time UI updates for both parties; blocked users cannot send or receive messages
- **Live Online Status** — Presence tracking via Socket.io connection lifecycle
- **Persistent Encrypted History** — MongoDB stores only ciphertext; history is decrypted locally on load

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6+) |
| Cryptography | Web Crypto API (SubtleCrypto) |
| Backend | Node.js, Express.js |
| Real-time | Socket.io (WebSockets) |
| Database | MongoDB, Mongoose |
| Auth | JWT (jsonwebtoken), bcryptjs |

---

## Security Architecture

### 1. Zero-Knowledge Registration & Login

```
[Register]
  password + random salt
       │
       ▼
  PBKDF2 (100,000 iterations)
       │
       ├──▶ encryptionKey  →  encrypt Private Key (AES-GCM)  →  stored on server (unreadable)
       └──▶ authKey        →  bcrypt hash                     →  stored on server

[Login]
  Same password + salt from server
       │
       ▼
  PBKDF2 re-derives both keys
       │
       ├──▶ authKey   →  compare with server hash  →  issue JWT
       └──▶ encryptionKey  →  decrypt Private Key blob  →  stored in IndexedDB only
```

The Private Key is **decrypted client-side** and persisted exclusively in the browser's IndexedDB. It is never re-transmitted to the server after the initial registration.

---

### 2. ECDH Handshake

When User A opens a chat with User B:

1. Client A fetches Client B's **Public Key** from the server
2. Client A computes: `SharedSecret = ECDH(A_privateKey, B_publicKey)`
3. Client B computes: `SharedSecret = ECDH(B_privateKey, A_publicKey)`
4. Both arrive at the **same secret** — the server never sees it

---

### 3. Message Encryption

- Algorithm: **AES-GCM 256-bit**
- A fresh **IV (12 bytes)** is generated for every single message
- DB stores only: `{ encryptedContent, iv, sender, recipient, timestamp }`

---

### 4. Zero-Trust API

All protected endpoints extract user identity **exclusively from the verified JWT payload**, never from URL parameters or request body fields provided by the client. This completely prevents **IDOR (Insecure Direct Object Reference)** attacks.

Additionally, the Socket.io `send_message` handler uses `socket.userId` (set at connection time) instead of trusting a `senderId` field from the client — preventing identity spoofing over WebSockets.

---

## Database Schema

```
Users
├── username         (unique)
├── salt             (for PBKDF2 re-derivation)
├── authKeyHash      (bcrypt hash — login verification)
├── publicKey        (ECDH public key — shared openly)
├── encryptedPrivateKey + iv  (AES-GCM wrapped — server cannot read)
└── notifications[]

Friendships          (separate collection for query performance)
├── requester        (ObjectId → User)
├── recipient        (ObjectId → User)
└── status           ('pending' | 'accepted' | 'blocked')

Messages
├── sender + recipient  (ObjectId → User)
├── encryptedContent    (ciphertext only)
├── iv
└── timestamp
```

---

## Installation & Setup

### Prerequisites
- Node.js v14+
- MongoDB (local instance or Atlas URI)

### Steps

1. Clone the repository:
    ```bash
    git clone https://github.com/Hoangcoderne/Chat_E2EE.git
    cd Chat_E2EE
    ```

2. Install dependencies:
    ```bash
    npm install
    ```

3. Create a `.env` file in the root directory:
    ```env
    PORT=3000
    MONGO_URI=mongodb://localhost:27017/securechat
    SESSION_SECRET=your_super_secret_key_here
    ```

4. Run the application:
    ```bash
    # Development
    npm run dev

    # Production
    npm start
    ```

5. Open your browser and navigate to `http://localhost:3000`

---

## Known Limitations

- **No HTTPS out of the box** — A reverse proxy (Nginx + Let's Encrypt) is recommended for production deployment
- **No message deletion** — Messages persist in the database; a delete/unsend feature is not yet implemented
- **No media support** — Text messages only; file/image sharing is not supported

---

## Author

**Nguyen Tran Minh Hoang** — Full-stack Developer