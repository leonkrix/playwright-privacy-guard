fetch('http://localhost:4411/collect', { mode: 'no-cors' });
navigator.sendBeacon('http://localhost:4411/beacon', 'x');
try {
  new WebSocket('ws://localhost:4411/socket').onerror = () => {};
} catch {}
