# SecureChat - End-to-End Encrypted Messaging System

SecureChat is a web-based messaging application built with a Zero-Knowledge Architecture. It ensures that the server acts only as a blind relay and never has access to user passwords, private keys, or raw message content. All encryption and decryption processes occur strictly on the client-side using the Web Crypto API.

## Project Overview

This project demonstrates the implementation of secure communication protocols within a modern web application architecture. It addresses common security vulnerabilities by ensuring data privacy through strong cryptography and secure authentication flows.

## Key Features

- **End-to-End Encryption (E2EE):** Messages are encrypted using AES-GCM with shared secrets derived via ECDH (Elliptic Curve Diffie-Hellman) key exchange.
- **Zero-Knowledge Authentication:** The server stores only salted hashes. Private keys are encrypted by the user's password and stored on the server but can only be decrypted by the client.
- **Real-time Communication:** Instant messaging, friend requests, and notifications powered by Socket.io.
- **Friendship Management:** Comprehensive relationship handling (Add, Accept, Decline, Block) using a dedicated database schema.
- **Live Status:** Real-time Online/Offline status tracking.
- **Persistent Encrypted History:** Chat history is stored in MongoDB in strictly ciphertext format.

## Technical Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+).
- **Cryptography:** Web Crypto API (SubtleCrypto) - Native browser standard.
- **Backend:** Node.js, Express.js.
- **Database:** MongoDB, Mongoose (NoSQL).
- **Real-time Engine:** Socket.io (WebSockets).

## Security Architecture

### 1. Zero-Knowledge Registration & Login
Instead of sending raw passwords, the client performs the following operations:
1.  **Key Generation:** Generates an ECDH Key Pair (Public/Private).
2.  **Key Wrapping:** The Private Key is encrypted using AES-GCM with a key derived from the user's password (PBKDF2).
3.  **Transmission:** Only the Public Key, Encrypted Private Key, Salt, and Auth Hash are sent to the server. The server never sees the plaintext password or private key.

### 2. The Handshake Protocol (ECDH)
When User A initiates a chat with User B:
1.  Client A fetches Client B's Public Key from the server.
2.  Client A uses its own Private Key and B's Public Key to mathematically derive a Shared Secret.
3.  This Shared Secret (unknown to the server) is used to encrypt messages.

### 3. Message Encryption
- Algorithm: AES-GCM (256-bit).
- Mechanism: Each message is encrypted with a unique Initialization Vector (IV).
- Storage: The database stores only the Ciphertext and IV.

## Database Schema

The project utilizes a normalized NoSQL structure to ensure scalability and performance:

- **Users:** Stores identity proofs (Salt, Verifier) and encrypted key bundles.
- **Friendships:** Manages relationships with status states (pending, accepted, blocked), separated from the User document to improve query performance.
- **Messages:** Stores sender, recipient, timestamp, iv, and the encryptedContent (Ciphertext).

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (Local instance or Atlas URI)

### Installation Steps

1.  Clone the repository:
    git clone https://github.com/Hoangcoderne/Chat_E2EE.git

2.  Install dependencies:
    npm install

3.  Environment Configuration:
    Create a .env file in the root directory with the following variables:
    PORT=3000
    MONGODB_URI=mongodb://localhost:27017/securechat
    SESSION_SECRET=your_super_secret_key_here

4.  Run the application:
    # For development
    npm run dev

    # For production
    npm start

5.  Access the application:
    Open a web browser and navigate to http://localhost:3000

## Author

Nguyen Tran Minh Hoang
- Role: Full-stack Developer & Security Researcher