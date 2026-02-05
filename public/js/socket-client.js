// public/js/socket-client.js

// Khởi tạo kết nối tới Server
const socket = io();

// Lắng nghe sự kiện kết nối thành công
socket.on('connect', () => {
    console.log('Đã kết nối tới Server với ID:', socket.id);
    const statusDiv = document.getElementById('status');
    if(statusDiv) {
        statusDiv.innerText = "Online (Secure Connection)";
        statusDiv.style.color = "green";
    }
});

socket.on('disconnect', () => {
    console.log('Mất kết nối server');
    const statusDiv = document.getElementById('status');
    if(statusDiv) {
        statusDiv.innerText = "Offline";
        statusDiv.style.color = "red";
    }
});

// Export socket để các file khác sử dụng
export default socket;