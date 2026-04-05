// public/js/forgot-password.js
import {
    importRecoveryKey,
    decryptAndImportPrivateKey,
    deriveKeysFromPassword,
    exportAndEncryptPrivateKey,
    base64ToArrayBuffer,
    arrayBufferToBase64
} from './crypto/key-manager.js';

// ── DOM ──
const errorMsg   = document.getElementById('error-msg');
const successMsg = document.getElementById('success-msg');

let state = {
    username: '',
    recoveryKey: '',
    recoveryKeyObj: null,
    encryptedPrivateKeyByRecovery: null,
    recoveryIv: null,
    encryptedSigningPrivateKeyByRecovery: null,
    recoverySigningIv: null,
};

// HELPER: Kiểm tra độ mạnh mật khẩu (đồng bộ với register.js)
function validatePasswordStrength(password) {
    const errors = [];
    if (password.length < 8)
        errors.push('Ít nhất 8 ký tự');
    if (!/[A-Z]/.test(password))
        errors.push('Ít nhất 1 chữ hoa (A–Z)');
    if (!/[0-9]/.test(password))
        errors.push('Ít nhất 1 chữ số (0–9)');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password))
        errors.push('Ít nhất 1 ký tự đặc biệt (!@#$%...)');
    return errors;
}

// ── Strength bar cho trường new-password ──
document.getElementById('new-password')?.addEventListener('input', function () {
    const bar  = document.getElementById('strength-bar-fill');
    const hint = document.getElementById('strength-hint');
    if (!bar || !hint) return;

    const errors = validatePasswordStrength(this.value);
    const score  = 4 - errors.length;
    const levels = [
        { label: '',            color: '#e0e0e0', width: '0%'   },
        { label: 'Rất yếu',    color: '#ef4444', width: '25%'  },
        { label: 'Yếu',        color: '#f97316', width: '50%'  },
        { label: 'Trung bình', color: '#eab308', width: '75%'  },
        { label: 'Mạnh',       color: '#22c55e', width: '100%' },
    ];
    const lvl = levels[score];
    bar.style.width      = lvl.width;
    bar.style.background = lvl.color;
    hint.textContent     = this.value.length === 0 ? '' : lvl.label;
    hint.style.color     = lvl.color;

    const tips = document.getElementById('password-tips');
    if (tips) {
        tips.innerHTML     = errors.map(e => `<li>${e}</li>`).join('');
        tips.style.display = errors.length > 0 && this.value.length > 0 ? 'block' : 'none';
    }
});

// ── UI helpers ──
function showError(msg) {
    errorMsg.innerText       = msg;
    errorMsg.style.display   = 'block';
    successMsg.style.display = 'none';
}
function clearMessages() {
    errorMsg.style.display   = 'none';
    successMsg.style.display = 'none';
}
function goToStep(n) {
    document.querySelectorAll('.step').forEach((el, i) => {
        el.classList.toggle('active', i === n - 1);
    });
    [1, 2, 3].forEach(i => {
        const dot = document.getElementById(`dot-${i}`);
        if (i < n)        dot.className = 'step-dot done';
        else if (i === n) dot.className = 'step-dot active';
        else              dot.className = 'step-dot';
    });
    clearMessages();
}

// BƯỚC 1 — Verify Recovery Key
document.getElementById('btn-verify').addEventListener('click', async () => {
    const username    = document.getElementById('username').value.trim();
    const recoveryKey = document.getElementById('recovery-key').value.trim().toUpperCase();

    if (!username || !recoveryKey) return showError('Vui lòng nhập đầy đủ thông tin');

    const btn = document.getElementById('btn-verify');
    btn.disabled  = true;
    btn.innerText = 'Đang xác minh...';

    try {
        const recoveryKeyObj = await importRecoveryKey(recoveryKey);

        const res  = await fetch('/api/auth/verify-recovery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, recoveryKey })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Xác minh thất bại');

        state = {
            username,
            recoveryKey,
            recoveryKeyObj,
            encryptedPrivateKeyByRecovery:        data.encryptedPrivateKeyByRecovery,
            recoveryIv:                           data.recoveryIv,
            encryptedSigningPrivateKeyByRecovery: data.encryptedSigningPrivateKeyByRecovery,
            recoverySigningIv:                    data.recoverySigningIv,
        };

        goToStep(2);

    } catch (err) {
        showError(err.message);
        btn.disabled  = false;
        btn.innerText = 'Xác minh Recovery Key';
    }
});

// BƯỚC 2 — Đặt mật khẩu mới + Re-encrypt keys
document.getElementById('btn-reset').addEventListener('click', async () => {
    const newPassword     = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    // Validate strength
    const pwErrors = validatePasswordStrength(newPassword);
    if (pwErrors.length > 0) {
        return showError('Mật khẩu chưa đủ mạnh:\n• ' + pwErrors.join('\n• '));
    }
    if (newPassword !== confirmPassword) {
        return showError('Mật khẩu xác nhận không khớp');
    }

    const btn = document.getElementById('btn-reset');
    btn.disabled  = true;
    btn.innerText = 'Đang xử lý...';

    try {
        // 1. Giải mã ECDH private key (extractable:true để re-export)
        const privateKey = await decryptAndImportPrivateKey(
            state.encryptedPrivateKeyByRecovery,
            state.recoveryIv,
            state.recoveryKeyObj,
            true
        );

        // 2. Giải mã Signing private key
        const signingPrivateKey = await decryptAndImportSigningKey(
            state.encryptedSigningPrivateKeyByRecovery,
            state.recoverySigningIv,
            state.recoveryKeyObj
        );

        // 3. Salt mới + derive keys từ password mới
        const newSalt    = window.crypto.getRandomValues(new Uint8Array(16));
        const newSaltB64 = arrayBufferToBase64(newSalt);
        const newKeys    = await deriveKeysFromPassword(newPassword, newSalt);

        // 4. Re-encrypt bằng encryptionKey mới
        const newEncrypted        = await exportAndEncryptPrivateKey(privateKey,        newKeys.encryptionKey);
        const newEncryptedSigning = await exportAndEncryptPrivateKey(signingPrivateKey, newKeys.encryptionKey);

        // 5. Gửi server
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username:                      state.username,
                recoveryKey:                   state.recoveryKey,
                newSalt:                       newSaltB64,
                newAuthKeyHash:                newKeys.authKey,
                newEncryptedPrivateKey:        newEncrypted.data,
                newIv:                         newEncrypted.iv,
                newEncryptedSigningPrivateKey: newEncryptedSigning.data,
                newSigningIv:                  newEncryptedSigning.iv,
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Đặt lại thất bại');

        goToStep(3);

    } catch (err) {
        showError(err.message);
        btn.disabled  = false;
        btn.innerText = 'Đặt lại mật khẩu';
    }
});

// ── Giải mã Signing Private Key (ECDSA, extractable:true) ──
async function decryptAndImportSigningKey(encryptedBase64, ivBase64, encryptionKey) {
    const iv   = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(encryptedBase64);

    const decryptedKeyData = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        encryptionKey,
        data
    );

    return await window.crypto.subtle.importKey(
        'pkcs8',
        decryptedKeyData,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign']
    );
}

// Nút đến login ở bước 3 — không dùng onclick inline (CSP violation)
document.getElementById('btn-to-login')?.addEventListener('click', () => {
    window.location.href = '/login.html';
});