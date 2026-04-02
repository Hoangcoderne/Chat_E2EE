// public/js/register.js
import {
    deriveKeysFromPassword,
    generateKeyPair,
    exportAndEncryptPrivateKey,
    exportPublicKey,
    generateSigningKeyPair,
    exportSigningPublicKey,
    generateRecoveryKey,
    importRecoveryKeyFromRaw,
    arrayBufferToBase64
} from './crypto/key-manager.js';

// ── DOM ──
const form       = document.getElementById('register-form');
const btnSubmit  = document.getElementById('btn-submit');
const errorMsg   = document.getElementById('error-msg');
const successMsg = document.getElementById('success-msg');

// ── Lưu payload giữa 2 phase (generate → confirm → call API) ──
// Không dùng sessionStorage vì chứa dữ liệu nhạy cảm (keys chưa mã hoá)
let pendingPayload = null;

// ============================================================
// HELPER: Kiểm tra độ mạnh mật khẩu
// Yêu cầu: ≥8 ký tự, ít nhất 1 hoa, 1 số, 1 ký tự đặc biệt
// ============================================================
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

// ── Strength bar cập nhật real-time ──
const passwordInput = document.getElementById('password');
passwordInput.addEventListener('input', () => {
    const val    = passwordInput.value;
    const errors = validatePasswordStrength(val);
    const score  = 4 - errors.length; // 0 → 4

    const bar      = document.getElementById('strength-bar-fill');
    const hint     = document.getElementById('strength-hint');
    if (!bar || !hint) return;

    const levels = [
        { label: '',            color: '#e0e0e0', width: '0%'  },
        { label: 'Rất yếu',    color: '#ef4444', width: '25%' },
        { label: 'Yếu',        color: '#f97316', width: '50%' },
        { label: 'Trung bình', color: '#eab308', width: '75%' },
        { label: 'Mạnh',       color: '#22c55e', width: '100%'},
    ];
    const lvl        = levels[score];
    bar.style.width      = lvl.width;
    bar.style.background = lvl.color;
    hint.textContent     = val.length === 0 ? '' : lvl.label;
    hint.style.color     = lvl.color;

    // Hiện gợi ý thiếu
    const tips = document.getElementById('password-tips');
    if (tips) {
        tips.innerHTML = errors.map(e => `<li>${e}</li>`).join('');
        tips.style.display = errors.length > 0 && val.length > 0 ? 'block' : 'none';
    }
});

// ============================================================
// ── Validate username format client-side ──
function validateUsernameFormat(username) {
    const errors = [];
    if (username.length < 3 || username.length > 20)
        errors.push('Từ 3–20 ký tự');
    if (/\s/.test(username))
        errors.push('Không được có dấu cách');
    if (/[àáảãạăắặẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(username))
        errors.push('Không được có dấu tiếng Việt');
    if (!/^[a-zA-Z0-9_-]+$/.test(username))
        errors.push('Chỉ dùng chữ (a-z), số (0-9), dấu _ hoặc -');
    return errors;
}

// Real-time username hint
document.getElementById('username')?.addEventListener('input', function () {
    const hint = document.getElementById('username-hint');
    if (!hint) return;
    const errors = validateUsernameFormat(this.value);
    if (this.value.length === 0) { hint.textContent = ''; return; }
    if (errors.length === 0) {
        hint.textContent = '✓ Hợp lệ';
        hint.style.color = '#22c55e';
    } else {
        hint.textContent = '✗ ' + errors[0];
        hint.style.color = '#ef4444';
    }
});

// ============================================================
// PHASE 1 — Form submit: validate + check username + generate keys
// ============================================================
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username        = document.getElementById('username').value.trim();
    const password        = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    // ── Validate username format ──
    const unErrors = validateUsernameFormat(username);
    if (unErrors.length > 0) {
        showError('Tên đăng nhập không hợp lệ:\n• ' + unErrors.join('\n• '));
        return;
    }

    // ── Validate password strength ──
    const pwErrors = validatePasswordStrength(password);
    if (pwErrors.length > 0) {
        showError('Mật khẩu chưa đủ mạnh:\n• ' + pwErrors.join('\n• '));
        return;
    }

    if (password !== confirmPassword) {
        showError('Mật khẩu xác nhận không khớp!');
        return;
    }

    // ── Kiểm tra username đã tồn tại chưa TRƯỚC khi generate keys ──
    setLoading(true, 'Đang kiểm tra tên đăng nhập...');
    try {
        const checkRes = await fetch(`/api/auth/salt?username=${encodeURIComponent(username)}`);
        if (checkRes.status === 200) {
            showError('Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.');
            setLoading(false, 'Đăng ký & Tạo Khóa');
            return;
        }
        // 404 = chưa tồn tại → tiếp tục
    } catch (err) {
        showError('Không thể kết nối server. Vui lòng thử lại.');
        setLoading(false, 'Đăng ký & Tạo Khóa');
        return;
    }

    setLoading(true, 'Đang tạo khoá bảo mật...');

    try {
        // 1. Salt + derive keys
        const salt       = window.crypto.getRandomValues(new Uint8Array(16));
        const saltBase64 = arrayBufferToBase64(salt);
        const keys       = await deriveKeysFromPassword(password, salt);

        // 2. ECDH keypair
        const keyPair          = await generateKeyPair();
        const encryptedData    = await exportAndEncryptPrivateKey(keyPair.privateKey, keys.encryptionKey);
        const publicKeyBase64  = await exportPublicKey(keyPair.publicKey);

        // 3. ECDSA signing keypair
        const signingKeyPair         = await generateSigningKeyPair();
        const encryptedSigningData   = await exportAndEncryptPrivateKey(signingKeyPair.privateKey, keys.encryptionKey);
        const signingPublicKeyBase64 = await exportSigningPublicKey(signingKeyPair.publicKey);

        // 4. Recovery Key
        const { raw: recoveryRaw, display: recoveryDisplay } = generateRecoveryKey();
        const recoveryKey = await importRecoveryKeyFromRaw(recoveryRaw);

        // 5. Mã hoá private keys bằng recovery key
        const recoveryEncryptedData        = await exportAndEncryptPrivateKey(keyPair.privateKey,        recoveryKey);
        const recoveryEncryptedSigningData = await exportAndEncryptPrivateKey(signingKeyPair.privateKey, recoveryKey);

        // 6. Lưu payload vào bộ nhớ — KHÔNG gọi API ngay
        pendingPayload = {
            username,
            salt: saltBase64,
            authKeyHash: keys.authKey,
            publicKey: publicKeyBase64,
            encryptedPrivateKey: encryptedData.data,
            iv: encryptedData.iv,
            signingPublicKey: signingPublicKeyBase64,
            encryptedSigningPrivateKey: encryptedSigningData.data,
            signingIv: encryptedSigningData.iv,
            recoveryKeyPlain: recoveryDisplay,
            encryptedPrivateKeyByRecovery: recoveryEncryptedData.data,
            recoveryIv: recoveryEncryptedData.iv,
            encryptedSigningPrivateKeyByRecovery: recoveryEncryptedSigningData.data,
            recoverySigningIv: recoveryEncryptedSigningData.iv
        };

        // 7. Hiện trang recovery key — tài khoản CHƯA được tạo
        showRecoveryStep(recoveryDisplay);

    } catch (err) {
        console.error(err);
        showError(err.message);
        setLoading(false, 'Đăng ký & Tạo Khóa');
    }
});

// ============================================================
// PHASE 2 — Sau khi user xác nhận đã lưu recovery key
// Lúc này MỚI gọi API để tạo tài khoản
// ============================================================
async function doRegister() {
    if (!pendingPayload) {
        showError('Phiên đăng ký đã hết hạn. Vui lòng thử lại.');
        return;
    }

    const btnCreate = document.getElementById('btn-create-account');
    if (btnCreate) {
        btnCreate.disabled = true;
        btnCreate.textContent = 'Đang tạo tài khoản...';
    }

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pendingPayload)
        });

        const result = await res.json();
        if (!res.ok) {
            // Hiện đúng lỗi từ server (validation error, duplicate username, v.v.)
            const msg = result.errors
                ? result.errors.map(e => e.message).join(', ')  // VALIDATION_ERROR
                : (result.message || 'Đăng ký thất bại');
            throw new Error(msg);
        }

        // Xoá payload khỏi bộ nhớ
        pendingPayload = null;

        // Hiện thông báo thành công + nút đến login
        showCreateSuccess();

    } catch (err) {
        console.error(err);
        if (btnCreate) {
            btnCreate.disabled = false;
            btnCreate.textContent = '✅ Hoàn thành & Tạo tài khoản';
        }
        // Hiện lỗi trong panel recovery key
        const errEl = document.getElementById('recovery-panel-error');
        if (errEl) {
            errEl.textContent = '❌ ' + err.message;
            errEl.style.display = 'block';
        }
    }
}

// ============================================================
// UI: Hiện trang recovery key (Phase 1 → Phase 2)
// ============================================================
function showRecoveryStep(recoveryDisplay) {
    // Ẩn form
    form.style.display    = 'none';
    btnSubmit.style.display = 'none';
    successMsg.style.display = 'none';
    errorMsg.style.display   = 'none';

    const panel = document.createElement('div');
    panel.id = 'recovery-panel';
    panel.style.cssText = `
        background: #fffbe6;
        border: 2px solid #f0a500;
        border-radius: 8px;
        padding: 20px;
        margin: 10px 0;
        text-align: center;
    `;

    panel.innerHTML = `
        <div style="font-size:2em; margin-bottom:8px">🔑</div>
        <h3 style="color:#b37400; margin:0 0 6px 0; font-size:1em">Recovery Key của bạn</h3>
        <p style="font-size:0.82em; color:#555; margin-bottom:14px; line-height:1.6">
            Đây là lần <strong>DUY NHẤT</strong> key được hiển thị.<br>
            Hãy lưu ở nơi an toàn — không thể khôi phục nếu mất.<br>
            <span style="color:#e03131; font-weight:600">Tài khoản chưa được tạo cho đến khi bạn xác nhận bên dưới.</span>
        </p>

        <!-- Recovery key display -->
        <div style="
            font-family: monospace; font-size: 0.9em; font-weight: bold;
            background: white; border: 1px solid #ddd; border-radius: 6px;
            padding: 12px; letter-spacing: 1px; word-break: break-all;
            color: #333; margin-bottom: 10px; text-align: left;
        ">${recoveryDisplay}</div>

        <!-- Nút copy -->
        <button id="btn-copy-recovery" style="
            background: #f0a500; color: white; border: none;
            padding: 7px 18px; border-radius: 4px; cursor: pointer;
            font-size: 0.88em; margin-bottom: 18px;
        ">📋 Sao chép Recovery Key</button>

        <!-- Checkbox xác nhận -->
        <div style="margin-bottom: 16px;">
            <label style="display:flex; align-items:flex-start; gap:8px; text-align:left; font-size:0.85em; cursor:pointer; line-height:1.5">
                <input type="checkbox" id="confirm-saved" style="margin-top:2px; flex-shrink:0">
                <span>Tôi đã sao chép và lưu Recovery Key ở nơi an toàn. Tôi hiểu rằng nếu mất key này, tôi không thể khôi phục tài khoản.</span>
            </label>
        </div>

        <!-- Lỗi từ API (nếu có) -->
        <div id="recovery-panel-error" style="
            display:none; color:#e03131; font-size:0.85em;
            background:#fff0f0; border:1px solid #ffcccc;
            border-radius:4px; padding:8px; margin-bottom:10px;
        "></div>

        <!-- Nút tạo tài khoản — bị khoá cho đến khi tick checkbox -->
        <button id="btn-create-account" disabled style="
            width:100%; padding:11px; background:#ccc; color:white;
            border:none; border-radius:4px; cursor:not-allowed;
            font-weight:bold; font-size:0.95em; transition: background .2s;
        ">✅ Hoàn thành & Tạo tài khoản</button>

        <!-- Nút quay lại form -->
        <button id="btn-back-to-form" style="
            width:100%; padding:8px; background:none; color:#888;
            border:1px solid #ddd; border-radius:4px; cursor:pointer;
            font-size:0.85em; margin-top:8px;
        ">← Quay lại chỉnh sửa thông tin</button>
    `;

    // Chèn panel vào container
    form.parentNode.insertBefore(panel, form);

    // ── Event listeners ──

    // Copy
    document.getElementById('btn-copy-recovery').addEventListener('click', () => {
        navigator.clipboard.writeText(recoveryDisplay).then(() => {
            document.getElementById('btn-copy-recovery').textContent = '✅ Đã sao chép';
        });
    });

    // Checkbox → mở khoá nút tạo tài khoản
    document.getElementById('confirm-saved').addEventListener('change', (e) => {
        const btn = document.getElementById('btn-create-account');
        if (e.target.checked) {
            btn.disabled = false;
            btn.style.background = '#28a745';
            btn.style.cursor     = 'pointer';
        } else {
            btn.disabled = true;
            btn.style.background = '#ccc';
            btn.style.cursor     = 'not-allowed';
        }
    });

    // Nút tạo tài khoản — gọi API
    document.getElementById('btn-create-account').addEventListener('click', doRegister);

    // Nút quay lại — xoá panel, hiện lại form
    document.getElementById('btn-back-to-form').addEventListener('click', () => {
        panel.remove();
        pendingPayload = null;
        form.style.display    = '';
        btnSubmit.style.display = '';
        setLoading(false, 'Đăng ký & Tạo Khóa');
    });
}

// ── Sau khi API tạo tài khoản thành công ──
function showCreateSuccess() {
    const panel = document.getElementById('recovery-panel');
    if (panel) {
        panel.innerHTML = `
            <div style="font-size:2.5em; margin-bottom:12px">🎉</div>
            <h3 style="color:#28a745; margin:0 0 8px 0">Tạo tài khoản thành công!</h3>
            <p style="font-size:0.88em; color:#555; margin-bottom:20px; line-height:1.6">
                Tài khoản của bạn đã được tạo.<br>
                Hãy đăng nhập để bắt đầu trò chuyện bảo mật.
            </p>
            <button id="btn-goto-login" style="
                width:100%; padding:11px; background:#0084ff; color:white;
                border:none; border-radius:4px; cursor:pointer;
                font-weight:bold; font-size:0.95em;
            ">Đăng nhập ngay →</button>
        `;
        panel.style.borderColor = '#22c55e';
        panel.style.background  = '#f0fff4';
        document.getElementById('btn-goto-login').addEventListener('click', () => {
            window.location.href = '/login.html';
        });
    }
}

// ── Helpers ──
function showError(msg) {
    errorMsg.innerText       = msg;
    errorMsg.style.display   = 'block';
    errorMsg.style.color     = 'red';
    successMsg.style.display = 'none';
}

function setLoading(isLoading, text) {
    btnSubmit.disabled   = isLoading;
    btnSubmit.innerText  = text;
}