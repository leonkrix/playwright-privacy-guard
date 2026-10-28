navigator.geolocation.getCurrentPosition(
  () => {},
  () => {},
);
navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => {});
Notification.requestPermission().catch?.(() => {});
try {
  new RTCPeerConnection();
} catch {}
