import { duration, shotAt, type Campaign, type Mission } from './campaign';
import { webmDuration } from './webm-duration';

const palettes = { dusk: ['#0b171d', '#263b42', '#bc8060', '#edc89a'], dawn: ['#192e37', '#617e84', '#cda887', '#f7dcc0'], night: ['#081218', '#192d3d', '#5e7285', '#e3c18c'] };
function lines(ctx: CanvasRenderingContext2D, value: string, width: number, max: number) {
  const result: string[] = []; let line = '';
  for (const word of value.split(/\s+/)) { const next = line ? line + ' ' + word : word; if (ctx.measureText(next).width > width && line) { result.push(line); line = word; } else line = next; }
  if (line) result.push(line);
  if (result.length > max) { result.length = max; result[max - 1] = result[max - 1].replace(/\s+\S*$/, '') + '…'; }
  return result;
}
function polygon(ctx: CanvasRenderingContext2D, points: number[][], color: string) { ctx.fillStyle = color; ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); }

/** Original vector scenery, titles and dialogue; no game images or model API. */
export function drawCampaignFrame(canvas: HTMLCanvasElement, c: Campaign, m: Mission, time: number) {
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas rendering is unavailable.');
  const { shot, index, elapsed } = shotAt(m, time), colors = palettes[c.tone], w = 1280, h = 720;
  ctx.save(); ctx.scale(canvas.width / w, canvas.height / h);
  const sky = ctx.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, colors[0]); sky.addColorStop(.6, colors[1]); sky.addColorStop(1, colors[2]); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  const lightX = shot.look === 'coast' ? 960 : 840;
  const glow = ctx.createRadialGradient(lightX, 300, 10, lightX, 300, 400); glow.addColorStop(0, colors[3] + '44'); glow.addColorStop(1, colors[3] + '00'); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.translate(-elapsed * 2.4, elapsed * .6);
  polygon(ctx, [[0, 315], [175, 225], [340, 305], [560, 230], [800, 335], [1090, 235], [1330, 330], [1330, 720], [0, 720]], '#32454a');
  polygon(ctx, [[0, 425], [210, 345], [455, 390], [790, 322], [1030, 402], [1330, 335], [1330, 720], [0, 720]], '#24363b');
  if (shot.look === 'coast') { ctx.fillStyle = '#31505c'; ctx.fillRect(0, 414, 1330, 310); ctx.strokeStyle = '#abc8bf22'; ctx.lineWidth = 2; for (let i = 0; i < 18; i++) { const y = 433 + i * 13; ctx.beginPath(); ctx.moveTo(450 + Math.sin(i + time * .3) * 30, y); ctx.lineTo(1240 - i * 20, y); ctx.stroke(); } }
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 15; i++) {
    const n = (m.seed * 17 + i * 113 + layer * 71) % 997;
    const x = i * 93 - 35 + (layer % 2) * 28, base = 370 + layer * 95 + Math.sin(i * 1.2 + m.seed) * 21;
    if (shot.look === 'coast' && x > 780 - layer * 160) continue;
    const bw = 48 + n % 35, bh = 34 + n % (45 + layer * 25);
    ctx.fillStyle = layer === 0 ? '#425459' : layer === 1 ? '#58625b' : '#5c6154'; ctx.fillRect(x, base - bh, bw, bh);
    polygon(ctx, [[x + bw, base - bh], [x + bw + 11, base - bh + 8], [x + bw + 11, base + 8], [x + bw, base]], '#253a39');
    polygon(ctx, [[x - 3, base - bh], [x + bw / 2, base - bh - 12], [x + bw + 4, base - bh], [x + bw, base - bh + 4], [x, base - bh + 4]], layer === 2 ? '#8b6755' : '#4e5753');
    for (let k = 0; k < 3; k++) { ctx.fillStyle = ((n + k) % 3 === 0) ? colors[3] + 'b8' : '#263638'; ctx.fillRect(x + 9 + k * 14, base - bh + 12, 6, 9); }
    ctx.fillStyle = '#182c2c'; ctx.fillRect(x + bw * .65, base - 20, 10, 20);
  }
  polygon(ctx, [[360, 720], [670, 444], [704, 444], [830, 720]], '#a9987644');
  if (shot.look === 'clinic') { ctx.fillStyle = '#72766a'; ctx.fillRect(832, 378, 220, 120); ctx.fillStyle = '#344842'; ctx.fillRect(923, 421, 48, 77); ctx.fillStyle = '#e2d2ad'; ctx.fillRect(867, 391, 32, 8); ctx.fillRect(879, 379, 8, 32); }
  if (shot.look === 'relay') { ctx.strokeStyle = '#9baa9f'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(1000, 418); ctx.lineTo(1016, 202); ctx.lineTo(1032, 418); ctx.stroke(); for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.moveTo(1008 - j * 2, 238 + j * 35); ctx.lineTo(1022 + j * 2, 265 + j * 35); ctx.stroke(); } ctx.fillStyle = '#edbc82'; ctx.beginPath(); ctx.arc(1016, 199, 3, 0, Math.PI * 2); ctx.fill(); }
  if (shot.look === 'crossing') { ctx.strokeStyle = '#b9aa8066'; ctx.lineWidth = 3; ctx.setLineDash([6, 9]); ctx.beginPath(); ctx.moveTo(370, 700); ctx.lineTo(679, 471); ctx.lineTo(1000, 514); ctx.stroke(); ctx.setLineDash([]); const p = Math.min(1, elapsed / shot.seconds), x = 370 + p * 309, y = 700 - p * 229; ctx.fillStyle = '#f1cf94'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  const shadow = ctx.createLinearGradient(0, 200, 0, h); shadow.addColorStop(0, '#07101100'); shadow.addColorStop(.55, '#07101188'); shadow.addColorStop(1, '#071011ed'); ctx.fillStyle = shadow; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#07101188'; ctx.fillRect(0, 0, w, 88); ctx.fillRect(0, h - 48, w, 48);
  ctx.font = '600 16px Arial, sans-serif'; ctx.fillStyle = '#cbb58e'; ctx.fillText('RTS AI  /  CAMPAIGN STUDIO', 54, 51);
  ctx.textAlign = 'right'; ctx.fillStyle = '#bdc7c6'; ctx.font = '14px Arial, sans-serif'; ctx.fillText('FICTIONAL SCENARIO  ·  CIVILIAN ACCOUNTS', w - 54, 51); ctx.textAlign = 'left';
  const fade = Math.min(1, elapsed / .4); ctx.globalAlpha = fade;
  ctx.font = '600 16px Arial, sans-serif'; ctx.fillStyle = '#cbb58e'; ctx.fillText(`${c.title.toUpperCase()}  /  CHAPTER ${c.missions.findIndex(n => n.id === m.id) + 1}`, 58, 393);
  ctx.font = '600 46px Arial, sans-serif'; ctx.fillStyle = '#f3eddf'; lines(ctx, shot.caption, 1110, 2).forEach((line, i) => ctx.fillText(line, 54, 457 + i * 52));
  const speaker = c.characters.find(a => a.id === shot.speaker);
  ctx.font = '600 15px Arial, sans-serif'; ctx.fillStyle = '#d7bf96'; ctx.fillText(speaker ? `${speaker.name.toUpperCase()} · ${speaker.role}` : m.location, 58, 552);
  ctx.font = '22px Arial, sans-serif'; ctx.fillStyle = '#d9dfd9'; lines(ctx, shot.dialogue, 1080, 3).forEach((line, i) => ctx.fillText(line, 58, 588 + i * 29));
  ctx.globalAlpha = 1; ctx.fillStyle = '#8a968f'; ctx.font = '12px Arial, sans-serif'; ctx.fillText('ORIGINAL MOTION ILLUSTRATION  /  SILENT PREVISUALIZATION', 54, h - 18);
  ctx.textAlign = 'right'; ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${String(m.shots.length).padStart(2, '0')}   ·   ${time.toFixed(1)}s`, w - 54, h - 18); ctx.textAlign = 'left';
  ctx.restore();
}

export function videoMime() { if (typeof MediaRecorder === 'undefined') return null; return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type)) ?? null; }
export function introVtt(c: Campaign, m: Mission) {
  const stamp = (seconds: number) => { const ms = Math.round(seconds * 1000); return `00:${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
  const plain = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, ' ');
  let start = 0;
  return 'WEBVTT\n\n' + m.shots.map((shot, i) => { const end = start + shot.seconds, speaker = c.characters.find(a => a.id === shot.speaker)?.name; const cue = `${i + 1}\n${stamp(start)} --> ${stamp(end)}\n${plain(shot.caption)}\n${speaker ? plain(speaker) + ': ' : ''}${plain(shot.dialogue)}\n`; start = end; return cue; }).join('\n');
}
export function generateIntro(c: Campaign, m: Mission, signal: AbortSignal, progress: (value: number) => void): Promise<Blob> {
  const mime = videoMime(); if (!mime) return Promise.reject(new Error('This browser cannot record video. Export the storyboard and campaign instead.'));
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    if (!canvas.captureStream) { reject(new Error('Canvas video capture is unavailable.')); return; }
    drawCampaignFrame(canvas, c, m, .4);
    const stream = canvas.captureStream(30), chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 }); } catch (e) { stream.getTracks().forEach(t => t.stop()); reject(e); return; }
    let timer: ReturnType<typeof setInterval> | undefined, finished = false;
    const cleanup = () => { if (timer) clearInterval(timer); stream.getTracks().forEach(t => t.stop()); signal.removeEventListener('abort', cancel); };
    const fail = (error: Error) => { if (finished) return; finished = true; if (recorder.state !== 'inactive') recorder.stop(); cleanup(); reject(error); };
    const cancel = () => fail(new Error('Video generation cancelled.'));
    signal.addEventListener('abort', cancel, { once: true });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = () => fail(new Error('The browser could not finish the video recording.'));
    recorder.onstop = async () => { if (finished) return; finished = true; cleanup(); try { const blob = new Blob(chunks, { type: mime }); if (blob.size < 1000) throw new Error('The recording is empty. Try another browser.'); if (mime.includes('webm')) { const finalized = webmDuration(new Uint8Array(await blob.arrayBuffer()), duration(m)); resolve(new Blob([finalized as Uint8Array<ArrayBuffer>], { type: mime })); } else resolve(blob); } catch (e) { reject(e); } };
    if (signal.aborted) { cancel(); return; }
    try {
      recorder.start(1000); const start = performance.now(), length = duration(m);
      timer = setInterval(() => { try { const time = Math.min(length, (performance.now() - start) / 1000); drawCampaignFrame(canvas, c, m, time); progress(time / length); if (time >= length) { if (timer) clearInterval(timer); recorder.stop(); } } catch (e) { fail(e instanceof Error ? e : new Error('Video render failed.')); } }, 1000 / 30);
    } catch (e) { fail(e instanceof Error ? e : new Error('Video capture failed.')); }
  });
}
