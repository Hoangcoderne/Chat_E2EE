// public/js/ui/notificationUI.js
// Quản lý tab title animation và âm thanh thông báo.

const ORIGINAL_TITLE = 'SecureChat E2EE';
let unreadCount      = 0;
let lastSenderName   = '';
let titleInterval    = null;
let isTabVisible     = true;

// Theo dõi tab có đang được focus không
document.addEventListener('visibilitychange', () => {
    isTabVisible = !document.hidden;
    if (isTabVisible) {
        // User quay lại tab → dừng animation, reset title
        stopTitleAnimation();
    }
});

window.addEventListener('focus', () => {
    isTabVisible = true;
    stopTitleAnimation();
});

window.addEventListener('blur', () => {
    isTabVisible = false;
});

// Âm thanh thông báo (tạo bằng Web Audio API, không cần file)
function playNotificationSound() {
    try {
        const ctx        = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = ctx.createOscillator();
        const gainNode   = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type            = 'sine';
        oscillator.frequency.value = 880;          // La5
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.4);
    } catch (_) {
        // Browser chặn AudioContext nếu chưa có user interaction — bỏ qua
    }
}

// Bắt đầu animation title
function startTitleAnimation() {
    if (titleInterval) return; // đang chạy rồi

    let toggle = false;
    titleInterval = setInterval(() => {
        document.title = toggle
            ? `(${unreadCount}) SecureChat E2EE`
            : `${lastSenderName} đã nhắn tin cho bạn`;
        toggle = !toggle;
    }, 1500);
}

function stopTitleAnimation() {
    if (titleInterval) {
        clearInterval(titleInterval);
        titleInterval = null;
    }
    document.title = ORIGINAL_TITLE;
    unreadCount    = 0;
    lastSenderName = '';
}

// API công khai

/**
 * Gọi khi nhận tin nhắn mới (DM hoặc Group).
 * @param {string} senderName - Tên người gửi
 */
export function notifyNewMessage(senderName) {
    // Phát âm thanh trong mọi trường hợp
    playNotificationSound();

    // Chỉ animate title khi tab không được focus
    if (isTabVisible) return;

    unreadCount++;
    lastSenderName = senderName;
    startTitleAnimation();
}

/**
 * Gọi khi user mở chat → reset thông báo.
 */
export function clearNotification() {
    stopTitleAnimation();
}