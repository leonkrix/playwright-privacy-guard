const canvas = document.getElementById('c');
canvas.getContext('2d')?.fillRect(0, 0, 10, 10);
canvas.toDataURL();
const gl = document.createElement('canvas').getContext('webgl');
if (gl) {
  gl.getParameter(0x9245);
}
if (typeof OfflineAudioContext !== 'undefined') {
  new OfflineAudioContext(1, 100, 44100).startRendering().catch(() => {});
}
navigator.getBattery?.().catch(() => {});
for (let i = 0; i < 25; i += 1) {
  document.fonts.check(`12px font-${String(i)}`);
}
