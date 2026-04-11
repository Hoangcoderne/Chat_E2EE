// public/js/password-toggle.js
// Nhấn giữ con mắt → hiện mật khẩu, thả ra → ẩn lại.
// Hoạt động trên cả desktop (mousedown/mouseup) và mobile (touchstart/touchend).

document.querySelectorAll('.toggle-password').forEach(btn => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;

    function show() {
        input.type = 'text';
        btn.textContent = '🙈';
    }

    function hide() {
        input.type = 'password';
        btn.textContent = '👁';
    }

    // Desktop
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); show(); });
    btn.addEventListener('mouseup', hide);
    btn.addEventListener('mouseleave', hide);

    // Mobile
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); show(); }, { passive: false });
    btn.addEventListener('touchend', hide);
    btn.addEventListener('touchcancel', hide);
});
