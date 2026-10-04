// A painted wooden board as a canvas texture (arch sign, bed signs). Text is clipped to fit; fillText never parses HTML.
import * as THREE from 'three';

export function paintSign(text: string, sub = '', o: { w?: number; h?: number } = {}): THREE.CanvasTexture {
  const w = o.w ?? 1024, h = o.h ?? 256, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const wood = g.createLinearGradient(0, 0, 0, h); wood.addColorStop(0, '#c99a62'); wood.addColorStop(1, '#a8743f');
  g.fillStyle = wood; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, h * 0.12); g.fill();
  g.strokeStyle = 'rgba(80,45,15,.18)'; g.lineWidth = 3;
  for (let y = h * 0.18; y < h; y += h * 0.22) { g.beginPath(); g.moveTo(16, y); g.bezierCurveTo(w * 0.3, y - 6, w * 0.7, y + 6, w - 16, y); g.stroke(); } // grain
  g.strokeStyle = '#6b4423'; g.lineWidth = h * 0.035; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, h * 0.12); g.stroke();
  const fit = (s: string, px: number, weight: number, maxW: number) => {
    let size = px; g.font = `${weight} ${size}px ui-rounded, "Avenir Next", system-ui, sans-serif`;
    while (g.measureText(s).width > maxW && size > 12) { size -= 2; g.font = `${weight} ${size}px ui-rounded, "Avenir Next", system-ui, sans-serif`; }
    return size;
  };
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const main = text.length > 32 ? `${text.slice(0, 31)}…` : text;
  fit(main, sub ? h * 0.42 : h * 0.55, 800, w * 0.88);
  g.fillStyle = 'rgba(60,30,8,.35)'; g.fillText(main, w / 2 + 3, (sub ? h * 0.4 : h / 2) + 4); // painted-in shadow
  g.fillStyle = '#fff8e6'; g.fillText(main, w / 2, sub ? h * 0.4 : h / 2);
  if (sub) { fit(sub, h * 0.17, 600, w * 0.85); g.fillStyle = '#ffeccc'; g.fillText(sub, w / 2, h * 0.76); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
