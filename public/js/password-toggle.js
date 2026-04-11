// public/js/password-toggle.js
// Nhấn giữ icon con mắt → hiện mật khẩu, thả ra → ẩn lại.
// Hoạt động trên cả desktop (mousedown/mouseup) và mobile (touchstart/touchend).

const eyeOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const eyeOnSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

document.querySelectorAll('.toggle-password').forEach(btn => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;

    // Mặc định: hiện icon mắt bị gạch (mật khẩu đang ẩn)
    btn.innerHTML = eyeOffSVG;

    function show() {
        input.type = 'text';
        btn.innerHTML = eyeOnSVG;
    }

    function hide() {
        input.type = 'password';
        btn.innerHTML = eyeOffSVG;
    }

    // Desktop: giữ chuột → hiện, thả → ẩn
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); show(); });
    btn.addEventListener('mouseup', hide);
    btn.addEventListener('mouseleave', hide);

    // Mobile: giữ → hiện, thả → ẩn
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); show(); }, { passive: false });
    btn.addEventListener('touchend', hide);
    btn.addEventListener('touchcancel', hide);
});
