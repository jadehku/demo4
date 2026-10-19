'use strict';

// =====================================================================
//  Paw-Paw Punch!  —  a tiny plushy fighting game (no libraries needed)
// =====================================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 960, H = 540, GROUND = 455, GRAV = 0.9;
const INK = '#4a2b1c';
const FONT = 'Fredoka, system-ui, sans-serif';
const ROUND_SECONDS = 60;

// body = main fur, light = belly / face patch, feet = foot colour, voice = squeak pitch when hit
const CHARS = [
  { id: 'otter', name: 'Pebble', desc: 'Slippery river otter', body: '#7a5340', light: '#f1e2c8',
    speed: 4.8, power: 1.0, jump: -16.5, proj: '🐚', spd: 2, pow: 2, voice: 720 },
  { id: 'cat', name: 'Marmalade', desc: 'Grumpy, heavy paws', body: '#f0983c', light: '#ffe3b5',
    speed: 3.9, power: 1.2, jump: -15.5, proj: '🐟', spd: 1, pow: 3, voice: 520 },
  { id: 'cow', name: 'Moomoo', desc: 'Big fluffy tank', body: '#f2d3bd', light: '#f4ad9f',
    speed: 3.6, power: 1.3, jump: -15, proj: '🥛', spd: 1, pow: 3, voice: 360 },
  { id: 'corgi', name: 'Biscuit', desc: 'Rootin\' tootin\' sheriff', body: '#e3893d', light: '#fff4e4',
    speed: 4.6, power: 1.05, jump: -16.5, proj: '⭐', spd: 2, pow: 2, voice: 620 },
  { id: 'bunny', name: 'Mochi', desc: 'Speedy & bouncy', body: '#e6e1de', light: '#ffffff',
    speed: 5.4, power: 0.88, jump: -17.5, proj: '🥕', spd: 3, pow: 1, voice: 900 },
  { id: 'duck', name: 'Waddles', desc: 'Flaps super high', body: '#fbf7ee', light: '#fff1d6', feet: '#f39a2b',
    speed: 4.4, power: 0.98, jump: -19.5, proj: '🍞', spd: 2, pow: 2, voice: 420, quack: true },
];

// startup / active / recovery are in frames (60 per second)
const MOVES = {
  punch:   { startup: 4,  active: 4,  recovery: 9,  dmg: 6,  reach: [17, 87], yr: [-101, -50], knock: 3.5, stun: 17 },
  kick:    { startup: 8,  active: 5,  recovery: 15, dmg: 10, reach: [17, 108], yr: [-58, -6],  knock: 7,   stun: 22 },
  airkick: { startup: 4,  active: 10, recovery: 4,  dmg: 8,  reach: [6, 90],  yr: [-52, 10],  knock: 5,   stun: 19 },
  special: { startup: 14, active: 1,  recovery: 24, dmg: 12, knock: 9, stun: 26 },
};
const SPECIAL_COOLDOWN = 110;
const FIGHTER_SCALE = 1.15;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
  return `rgb(${f(n >> 16 & 255)},${f(n >> 8 & 255)},${f(n & 255)})`;
}
for (const ch of CHARS) {
  ch.dark = shade(ch.body, -0.22);
  ch.darker = shade(ch.body, -0.42);
  ch.feetCol = ch.feet || shade(ch.body, -0.15);
}

// ---------------------------------------------------------------------
//  Audio: synthesised music + sound effects (no audio files)
// ---------------------------------------------------------------------
let actx = null, musicBus = null, sfxBus = null, noiseBuf = null;
let sfxOn = true, musicOn = true;
try {
  const saved = JSON.parse(localStorage.getItem('ppp-audio') || '{}');
  if (saved.sfx === false) sfxOn = false;
  if (saved.music === false) musicOn = false;
} catch (e) { /* storage unavailable */ }
function saveAudioPrefs() {
  try { localStorage.setItem('ppp-audio', JSON.stringify({ sfx: sfxOn, music: musicOn })); } catch (e) { /* ignore */ }
}

function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const comp = actx.createDynamicsCompressor();
  comp.connect(actx.destination);
  musicBus = actx.createGain(); musicBus.connect(comp);
  sfxBus = actx.createGain(); sfxBus.gain.value = sfxOn ? 0.9 : 0; sfxBus.connect(comp);
  noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  updateMusicVolume();
}

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function tone(t, freq, dur, o = {}) {
  const { type = 'sine', vol = 0.2, to = null, attack = 0.005, bus = sfxBus, lp = 0 } = o;
  const osc = actx.createOscillator(), g = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = osc;
  if (lp) { const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; osc.connect(f); node = f; }
  node.connect(g).connect(bus);
  osc.start(t); osc.stop(t + dur + 0.05);
}

function noise(t, dur, o = {}) {
  const { vol = 0.2, type = 'bandpass', freq = 1000, to = null, q = 1, bus = sfxBus, attack = 0.002 } = o;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const f = actx.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
}

const SFX = {
  punch:   t => { noise(t, 0.07, { vol: 0.35, freq: 1300, q: 0.8 }); tone(t, 210, 0.09, { to: 70, vol: 0.35 }); },
  kick:    t => { noise(t, 0.11, { vol: 0.35, type: 'lowpass', freq: 1600, to: 300 }); tone(t, 150, 0.17, { to: 45, vol: 0.5 }); },
  block:   t => { tone(t, 1200, 0.08, { type: 'triangle', to: 800, vol: 0.15 }); noise(t, 0.04, { vol: 0.12, type: 'highpass', freq: 3000 }); },
  whoosh:  t => noise(t, 0.13, { vol: 0.1, freq: 500, to: 2200, q: 2 }),
  jump:    t => tone(t, 230, 0.2, { to: 560, vol: 0.16 }),
  land:    t => { tone(t, 110, 0.09, { to: 50, vol: 0.22 }); noise(t, 0.06, { vol: 0.08, type: 'lowpass', freq: 600 }); },
  special: t => { [0, 4, 7, 12].forEach((n, i) => tone(t + i * 0.045, mtof(76 + n), 0.2, { type: 'triangle', vol: 0.14 })); noise(t, 0.35, { vol: 0.05, type: 'highpass', freq: 5000 }); },
  ko:      t => { tone(t, 950, 0.9, { to: 140, vol: 0.2 }); noise(t + 0.25, 1.8, { vol: 0.14, freq: 1400, q: 0.5, attack: 0.5 }); },
  bell:    t => { tone(t, 880, 0.8, { type: 'triangle', vol: 0.18 }); tone(t, 1320, 0.5, { vol: 0.07 }); },
  fight:   t => { [60, 64, 67, 72].forEach(m => tone(t, mtof(m), 0.4, { type: 'square', vol: 0.05, lp: 2500 })); tone(t, mtof(48), 0.4, { type: 'sawtooth', vol: 0.08, lp: 900 }); },
  select:  t => { tone(t, 660, 0.06, { type: 'triangle', vol: 0.15 }); tone(t + 0.06, 990, 0.1, { type: 'triangle', vol: 0.15 }); },
  hover:   t => tone(t, 880, 0.04, { type: 'triangle', vol: 0.06 }),
  tick:    t => tone(t, 1500, 0.05, { type: 'square', vol: 0.05 }),
  victory: t => [72, 76, 79, 84, 79, 84].forEach((m, i) => tone(t + i * 0.12, mtof(m), i === 5 ? 0.6 : 0.15, { type: 'square', vol: 0.07, lp: 3000 })),
};

function sfx(name) {
  if (!actx || !sfxOn) return;
  try { SFX[name](actx.currentTime); } catch (e) { /* ignore */ }
}

// plush squeak (or quack) when a fighter gets bonked
function squeak(ch) {
  if (!actx || !sfxOn) return;
  const t = actx.currentTime, f = ch.voice * rand(0.92, 1.08);
  if (ch.quack) {
    tone(t, f, 0.16, { type: 'sawtooth', to: f * 0.7, vol: 0.14, lp: 1400 });
  } else {
    tone(t, f, 0.06, { to: f * 1.7, vol: 0.12 });
    tone(t + 0.06, f * 1.7, 0.1, { to: f * 1.1, vol: 0.1 });
  }
}

// --- music sequencer: 4 bars x 16 steps, melody as MIDI numbers (0 = rest)
const SONGS = {
  menu: {
    bpm: 108, swing: 0.12,
    chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
    bass: [48, 45, 41, 43],
    melody: [
      76, 0, 79, 0, 84, 0, 79, 0, 81, 0, 79, 0, 76, 0, 0, 0,
      72, 0, 76, 0, 81, 0, 79, 0, 76, 0, 72, 0, 74, 0, 0, 0,
      77, 0, 81, 0, 84, 0, 81, 0, 79, 0, 77, 0, 76, 0, 74, 0,
      74, 0, 79, 0, 83, 0, 86, 0, 84, 0, 83, 0, 79, 0, 0, 0,
    ],
  },
  fight: {
    bpm: 146, swing: 0,
    chords: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]],
    bass: [45, 41, 43, 40],
    melody: [
      69, 0, 72, 76, 81, 0, 76, 72, 71, 0, 72, 0, 76, 0, 74, 0,
      77, 0, 76, 77, 81, 0, 77, 76, 74, 0, 72, 0, 74, 0, 76, 0,
      79, 0, 74, 79, 83, 0, 79, 74, 76, 0, 74, 0, 71, 0, 74, 0,
      76, 0, 71, 76, 80, 0, 76, 71, 80, 0, 83, 0, 81, 0, 0, 0,
    ],
  },
};
let song = null, wantSong = null, songStep = 0, nextNote = 0;

function setMusic(name) {
  wantSong = name;
  const next = name ? SONGS[name] : null;
  if (next === song) return;
  song = next; songStep = 0;
  if (actx) nextNote = actx.currentTime + 0.1;
}
function updateMusicVolume() {
  if (!actx) return;
  const target = musicOn ? (game.paused ? 0.07 : 0.3) : 0;
  musicBus.gain.setTargetAtTime(target, actx.currentTime, 0.08);
}

function playStep(sg, s, t, spb) {
  const bar = s >> 4, st = s & 15;
  const M = { bus: musicBus };
  const chord = sg.chords[bar], root = sg.bass[bar];
  const mel = sg.melody[s];
  if (sg === SONGS.menu) {
    if (mel) {
      tone(t, mtof(mel), spb * 1.8, { ...M, type: 'square', vol: 0.045, lp: 2600 });
      tone(t, mtof(mel - 12), spb * 1.8, { ...M, type: 'triangle', vol: 0.05 });
    }
    if (st % 4 === 2) chord.forEach(m => tone(t, mtof(m), spb * 0.9, { ...M, type: 'triangle', vol: 0.03 }));
    if (st === 0 || st === 6) tone(t, mtof(root), spb * 1.6, { ...M, type: 'triangle', vol: 0.16 });
    if (st === 8) tone(t, mtof(root + 7), spb * 1.6, { ...M, type: 'triangle', vol: 0.14 });
    if (st === 12) tone(t, mtof(root + 12), spb * 1.6, { ...M, type: 'triangle', vol: 0.12 });
    if (st === 0 || st === 8) tone(t, 140, 0.12, { ...M, to: 50, vol: 0.32 });
    if (st === 4 || st === 12) noise(t, 0.1, { ...M, vol: 0.1, freq: 1800, q: 0.7 });
    if (st % 4 === 2) noise(t, 0.03, { ...M, vol: 0.04, type: 'highpass', freq: 7000 });
  } else {
    if (mel) tone(t, mtof(mel), spb * 1.1, { ...M, type: 'square', vol: 0.045, lp: 3200 });
    if (st === 0 || st === 8) chord.forEach(m => tone(t, mtof(m), spb * 6, { ...M, type: 'sawtooth', vol: 0.018, lp: 1400, attack: 0.03 }));
    if (st % 2 === 0) tone(t, mtof(root + (st % 4 === 2 ? 12 : 0) - 12), spb * 1.4, { ...M, type: 'sawtooth', vol: 0.09, lp: 700 });
    if (st % 4 === 0 || st === 10) tone(t, 150, 0.12, { ...M, to: 45, vol: 0.4 });
    if (st === 4 || st === 12) { noise(t, 0.12, { ...M, vol: 0.16, freq: 1800, q: 0.7 }); tone(t, 220, 0.06, { ...M, type: 'triangle', vol: 0.06 }); }
    noise(t, 0.025, { ...M, vol: st % 2 ? 0.025 : 0.045, type: 'highpass', freq: 7500 });
  }
}

setInterval(() => {
  if (!actx || !song || !musicOn || actx.state !== 'running') return;
  const spb = 60 / song.bpm / 4;
  if (nextNote < actx.currentTime) nextNote = actx.currentTime + 0.05;
  while (nextNote < actx.currentTime + 0.15) {
    const swing = (songStep % 2 ? song.swing * spb : 0);
    try { playStep(song, songStep, nextNote + swing, spb); } catch (e) { /* ignore */ }
    songStep = (songStep + 1) % 64;
    nextNote += spb;
  }
}, 30);

// browsers only allow audio after the first click / key press
function unlockAudio() {
  initAudio();
  if (actx && wantSong && !song) setMusic(wantSong);
}
addEventListener('pointerdown', unlockAudio, { passive: true });
addEventListener('keydown', unlockAudio, { passive: true });

// ---------------------------------------------------------------------
//  Input
// ---------------------------------------------------------------------
const keysDown = new Set(), keysPressed = new Set();
const touchHeld = new Set(), touchPressed = new Set();
const BIND = [
  { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], block: ['KeyS'], punch: ['KeyF'], kick: ['KeyG'], special: ['KeyH'] },
  { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], block: ['ArrowDown'],
    punch: ['Comma', 'Numpad1'], kick: ['Period', 'Numpad2'], special: ['Slash', 'Numpad3'] },
];
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Slash']);

addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (!e.repeat) keysPressed.add(e.code);
  keysDown.add(e.code);
  onMenuKey(e);
});
addEventListener('keyup', e => keysDown.delete(e.code));
addEventListener('blur', () => { keysDown.clear(); touchHeld.clear(); });

function readInput(side) {
  const binds = [BIND[side]];
  if (side === 0 && game.vsCPU) binds.push(BIND[1]); // solo player may use either side's keys
  const inp = { held: {}, pressed: {} };
  for (const act of Object.keys(BIND[0])) {
    for (const b of binds) {
      if (b[act].some(c => keysDown.has(c))) inp.held[act] = true;
      if (b[act].some(c => keysPressed.has(c))) inp.pressed[act] = true;
    }
    if (side === 0) {
      if (touchHeld.has(act)) inp.held[act] = true;
      if (touchPressed.has(act)) inp.pressed[act] = true;
    }
  }
  return inp;
}

// ---------------------------------------------------------------------
//  Fighter
// ---------------------------------------------------------------------
class Fighter {
  constructor(ch, side) {
    this.ch = ch;
    this.side = side;
    this.reset();
  }
  reset() {
    this.x = this.side === 0 ? 270 : W - 270;
    this.y = GROUND; this.vx = 0; this.vy = 0;
    this.facing = this.side === 0 ? 1 : -1;
    this.hp = 100; this.dmgHp = 100;
    this.state = 'idle'; this.t = 0; this.attack = null; this.hitDone = false;
    this.stun = 0; this.specialCd = 0; this.combo = 0; this.comboTimer = 0;
    this.anim = Math.random() * 100; this.blink = rand(100, 250); this.flash = 0;
    this.ai = { wait: 30, plan: null, fresh: false };
  }
  get onGround() { return this.y >= GROUND - 0.01; }

  startAttack(name) {
    this.state = 'attack'; this.attack = name; this.t = 0; this.hitDone = false;
    if (this.onGround) this.vx = 0;
    sfx('whoosh');
  }

  update(inp, opp) {
    this.anim++;
    if (this.specialCd > 0) this.specialCd--;
    if (this.flash > 0) this.flash--;
    if (--this.blink < 0) this.blink = rand(150, 300);
    if (this.dmgHp > this.hp) this.dmgHp = Math.max(this.hp, this.dmgHp - 0.6);
    if (this.comboTimer > 0) this.comboTimer--;

    const free = this.state === 'idle' || this.state === 'walk' || this.state === 'jump' || this.state === 'block';
    if (free && this.onGround) this.facing = opp.x >= this.x ? 1 : -1;

    switch (this.state) {
      case 'ko':
        break;
      case 'hit':
      case 'blockstun':
        if (--this.stun <= 0 && this.onGround) this.state = 'idle';
        break;
      case 'attack': {
        const m = MOVES[this.attack];
        this.t++;
        if (this.attack === 'special' && this.t === m.startup) spawnProjectile(this);
        if (this.t >= m.startup + m.active + m.recovery) this.state = this.onGround ? 'idle' : 'jump';
        break;
      }
      default: {
        const g = this.onGround;
        if (inp.pressed.punch || inp.pressed.kick) {
          this.startAttack(g ? (inp.pressed.punch ? 'punch' : 'kick') : 'airkick');
          break;
        }
        if (inp.pressed.special && g && this.specialCd === 0) {
          this.startAttack('special');
          this.specialCd = SPECIAL_COOLDOWN;
          break;
        }
        if (g && inp.held.block) { this.state = 'block'; this.vx = 0; break; }
        const dir = (inp.held.right ? 1 : 0) - (inp.held.left ? 1 : 0);
        if (g) {
          this.vx = dir * this.ch.speed * (dir === this.facing ? 1 : 0.8);
          if (inp.held.up) { this.vy = this.ch.jump; this.y -= 1; sfx('jump'); dust(this.x); }
          this.state = !this.onGround ? 'jump' : (dir ? 'walk' : 'idle');
        } else {
          this.vx = clamp(this.vx + dir * 0.4, -this.ch.speed, this.ch.speed);
          this.state = 'jump';
        }
      }
    }

    // physics
    if (!this.onGround || this.vy < 0) { this.vy += GRAV; this.y += this.vy; }
    if (this.y >= GROUND) {
      if (this.vy > 6) { dust(this.x); sfx('land'); }
      this.y = GROUND; this.vy = 0;
      if (this.state === 'jump') this.state = 'idle';
      if (this.state === 'attack' && this.attack === 'airkick') this.state = 'idle';
    }
    if (this.onGround && (this.state === 'hit' || this.state === 'blockstun' || this.state === 'ko' || this.state === 'attack')) {
      this.vx *= 0.82;
    }
    this.x = clamp(this.x + this.vx, 40, W - 40);
  }
}

// ---------------------------------------------------------------------
//  Combat
// ---------------------------------------------------------------------
let projectiles = [], particles = [];
let hitstop = 0, shake = 0;

function spawnProjectile(f) {
  projectiles.push({ x: f.x + f.facing * 58, y: f.y - 80, vx: f.facing * 8, owner: f, emoji: f.ch.proj, t: 0 });
  sfx('special');
  burst(f.x + f.facing * 58, f.y - 80, '#fff6a8', 8);
}

function checkMelee(a, d) {
  if (a.state !== 'attack' || a.hitDone) return;
  const m = MOVES[a.attack];
  if (!m.reach || a.t < m.startup || a.t >= m.startup + m.active) return;
  const x1 = a.x + a.facing * m.reach[0], x2 = a.x + a.facing * m.reach[1];
  const hx1 = Math.min(x1, x2), hx2 = Math.max(x1, x2);
  const hy1 = a.y + m.yr[0], hy2 = a.y + m.yr[1];
  if (hx2 > d.x - 37 && hx1 < d.x + 37 && hy2 > d.y - 148 && hy1 < d.y) {
    a.hitDone = true;
    applyHit(a, d, m, a.x, (hx1 + hx2) / 2 + (d.x > a.x ? -10 : 10), (hy1 + hy2) / 2);
  }
}

function applyHit(a, d, m, fromX, px, py) {
  if (d.state === 'ko' || game.phase !== 'fight') return;
  const dir = d.x >= fromX ? 1 : -1;

  if ((d.state === 'block' || d.state === 'blockstun') && d.facing === -dir) {
    d.hp = Math.max(1, d.hp - Math.ceil(m.dmg * 0.12)); // chip damage can't KO
    d.state = 'blockstun'; d.stun = 12; d.vx = dir * m.knock * 0.7;
    burst(px, py, '#9ad7ff', 8);
    popText('block', px, py - 20, '#5fb0ff', 22);
    hitstop = 3;
    sfx('block');
    return;
  }

  const dmg = Math.round(m.dmg * a.ch.power);
  a.combo = d.state === 'hit' ? a.combo + 1 : 1;
  a.comboTimer = 80;
  d.hp = Math.max(0, d.hp - dmg);
  d.state = 'hit'; d.attack = null; d.stun = m.stun; d.vx = dir * m.knock; d.flash = 14;
  if (!d.onGround || m.dmg >= 10) { d.vy = Math.min(d.vy, -4); d.y -= 1; }

  const big = m.dmg >= 10;
  hitstop = big ? 8 : 5;
  shake = big ? 9 : 5;
  burst(px, py, '#ffd166', big ? 16 : 10);
  fluff(px, py, d.ch.body, big ? 10 : 6);
  popText(['POW!', 'BAM!', 'BOOP!', 'PAF!', 'BONK!'][Math.floor(Math.random() * 5)], px, py - 30, '#fff', big ? 34 : 28);
  sfx(m === MOVES.punch ? 'punch' : 'kick');
  squeak(d.ch);

  if (d.hp <= 0) {
    d.state = 'ko'; d.vy = -11; d.vx = dir * 7; d.y -= 1;
    hitstop = 20; shake = 16;
    sfx('ko');
    endRound(a, 'ko');
  }
}

function updateProjectiles() {
  for (const p of projectiles) {
    p.x += p.vx; p.t++;
    const d = game.fighters[1 - p.owner.side];
    if (!p.dead && d.state !== 'ko' && Math.abs(p.x - d.x) < 48 && p.y > d.y - 148 && p.y < d.y) {
      p.dead = true;
      applyHit(p.owner, d, MOVES.special, p.x - p.vx * 10, p.x, p.y);
    }
    if (p.x < -50 || p.x > W + 50) p.dead = true;
  }
  // two projectiles cancel each other out
  for (let i = 0; i < projectiles.length; i++) for (let j = i + 1; j < projectiles.length; j++) {
    const a = projectiles[i], b = projectiles[j];
    if (!a.dead && !b.dead && a.owner !== b.owner && Math.abs(a.x - b.x) < 40) {
      a.dead = b.dead = true;
      burst((a.x + b.x) / 2, a.y, '#fff6a8', 14);
      sfx('block');
    }
  }
  projectiles = projectiles.filter(p => !p.dead);
}

// ---------------------------------------------------------------------
//  Particles
// ---------------------------------------------------------------------
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(2, 7);
    particles.push({ type: Math.random() < 0.5 ? 'star' : 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1,
      life: rand(18, 32), max: 32, color, size: rand(4, 9), rot: rand(0, 6) });
  }
}
// little tufts of fur knocked loose
function fluff(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    particles.push({ type: 'fluff', x, y, vx: rand(-4, 4), vy: rand(-5, -1), life: rand(30, 50), max: 50,
      color, size: rand(4, 7), rot: rand(0, 6) });
  }
}
function dust(x) {
  for (let i = 0; i < 6; i++) {
    particles.push({ type: 'dot', x: x + rand(-15, 15), y: GROUND - 3, vx: rand(-2, 2), vy: rand(-1.5, -0.3),
      life: rand(15, 25), max: 25, color: '#fff3dd', size: rand(4, 8), rot: 0 });
  }
}
function popText(text, x, y, color, size) {
  particles.push({ type: 'text', text, x, y, vx: 0, vy: -1.4, life: 40, max: 40, color, size, rot: rand(-0.2, 0.2) });
}
function updateParticles() {
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.life--;
    if (p.type === 'fluff') { p.vy = Math.min(p.vy + 0.12, 1.2); p.vx *= 0.95; p.rot += 0.05; }
    else if (p.type !== 'text') { p.vy += 0.2; p.vx *= 0.96; p.rot += 0.2; }
  }
  particles = particles.filter(p => p.life > 0);
}

// ---------------------------------------------------------------------
//  CPU opponent
// ---------------------------------------------------------------------
function cpuInput(f, o) {
  const inp = { held: {}, pressed: {} };
  const ai = f.ai;
  const dist = Math.abs(o.x - f.x);
  const toward = o.x > f.x ? 'right' : 'left';
  const away = toward === 'right' ? 'left' : 'right';

  for (const p of projectiles) {
    const incoming = p.owner !== f && Math.sign(f.x - p.x) === Math.sign(p.vx) && Math.abs(f.x - p.x) < 170;
    if (incoming && ai.plan !== 'block' && ai.plan !== 'jumpin' && Math.random() < 0.06) {
      ai.plan = Math.random() < 0.5 ? 'block' : 'jumpin';
      ai.wait = 20; ai.fresh = true;
    }
  }

  if (--ai.wait <= 0) {
    const r = Math.random();
    ai.wait = 8 + Math.floor(Math.random() * 16);
    if (o.state === 'attack' && dist < 150 && r < 0.4) { ai.plan = 'block'; ai.wait = 22; }
    else if (dist > 280) ai.plan = (r < 0.3 && f.specialCd === 0) ? 'special' : r < 0.4 ? 'jumpin' : 'approach';
    else if (dist > 100) ai.plan = r < 0.55 ? 'approach' : r < 0.7 ? 'jumpin' : (r < 0.8 && f.specialCd === 0) ? 'special' : r < 0.9 ? 'kick' : 'back';
    else ai.plan = r < 0.38 ? 'punch' : r < 0.66 ? 'kick' : r < 0.78 ? 'block' : r < 0.9 ? 'back' : 'jumpin';
    ai.fresh = true;
  }

  switch (ai.plan) {
    case 'approach': inp.held[toward] = true; break;
    case 'back': inp.held[away] = true; break;
    case 'block': inp.held.block = true; break;
    case 'jumpin':
      if (ai.fresh) inp.held.up = true;
      inp.held[toward] = true;
      if (!f.onGround && dist < 110 && f.vy > 0) inp.pressed.kick = true;
      break;
    case 'punch': case 'kick': case 'special':
      if (ai.fresh) inp.pressed[ai.plan] = true;
      break;
  }
  ai.fresh = false;
  return inp;
}

// ---------------------------------------------------------------------
//  Game flow
// ---------------------------------------------------------------------
const game = {
  mode: 'title',          // title | howto | select | fight | result
  vsCPU: true,
  picks: [0, 1],
  selecting: 0,
  hover: 0,
  fighters: [],
  wins: [0, 0],
  round: 1,
  timer: 0,
  phase: 'intro',         // intro | fight | end
  phaseT: 0,
  roundWinner: null,
  matchWinner: null,
  paused: false,
  announce: null,
};
let clock = 0;

function announce(text, dur = 60, color = '#ff8a3d') {
  game.announce = { text, t: 0, dur, color };
}

function startMatch() {
  game.fighters = [new Fighter(CHARS[game.picks[0]], 0), new Fighter(CHARS[game.picks[1]], 1)];
  game.wins = [0, 0];
  game.round = 1;
  game.matchWinner = null;
  showScreen(null);
  game.mode = 'fight';
  updateHint();
  setMusic('fight');
  startRound();
}

function startRound() {
  game.fighters.forEach(f => f.reset());
  projectiles = []; particles = [];
  game.timer = ROUND_SECONDS * 60;
  game.phase = 'intro'; game.phaseT = 0;
  game.roundWinner = null;
  announce(game.round >= 3 && game.wins[0] === 1 && game.wins[1] === 1 ? 'FINAL ROUND' : `ROUND ${game.round}`, 70);
  sfx('bell');
}

function endRound(winner, reason) {
  if (game.phase !== 'fight') return;
  game.phase = 'end'; game.phaseT = 0;
  game.roundWinner = winner;
  if (winner) game.wins[winner.side]++;
  announce(reason === 'ko' ? 'K.O.!' : 'TIME!', 80, '#ff5e5e');
  if (reason !== 'ko') sfx('bell');
}

function updateFight() {
  const [a, b] = game.fighters;
  game.phaseT++;

  if (game.phase === 'intro' && game.phaseT === 75) { announce('FIGHT!', 45, '#ff6b5b'); sfx('fight'); }
  if (game.phase === 'intro' && game.phaseT >= 95) { game.phase = 'fight'; game.phaseT = 0; }

  const none = { held: {}, pressed: {} };
  const live = game.phase === 'fight';
  const in0 = live ? readInput(0) : none;
  const in1 = live ? (game.vsCPU ? cpuInput(b, a) : readInput(1)) : none;

  a.update(in0, b);
  b.update(in1, a);

  // little victory hops
  if (game.phase === 'end' && game.roundWinner) {
    const w = game.roundWinner;
    if (w.onGround && (w.state === 'idle' || w.state === 'walk') && game.phaseT > 60 && game.phaseT % 36 === 0) {
      w.vy = -9; w.y -= 1;
    }
  }

  // keep fighters from overlapping
  const dx = b.x - a.x;
  if (Math.abs(dx) < 68 && Math.abs(a.y - b.y) < 100 && a.state !== 'ko' && b.state !== 'ko') {
    const push = (68 - Math.abs(dx)) / 2, s = dx >= 0 ? 1 : -1;
    a.x = clamp(a.x - s * push, 40, W - 40);
    b.x = clamp(b.x + s * push, 40, W - 40);
  }

  checkMelee(a, b);
  checkMelee(b, a);
  updateProjectiles();
  updateParticles();

  if (live) {
    game.timer--;
    if (game.timer > 0 && game.timer <= 5 * 60 && game.timer % 60 === 0) sfx('tick');
    if (game.timer <= 0) {
      game.timer = 0;
      endRound(a.hp === b.hp ? null : (a.hp > b.hp ? a : b), 'time');
    }
  }

  if (game.phase === 'end') {
    if (game.phaseT === 85) {
      announce(game.roundWinner ? `${game.roundWinner.ch.name} wins!` : 'DRAW!', 90, game.roundWinner ? (game.roundWinner.side ? '#4aa3ff' : '#ff6b5b') : '#b48cff');
    }
    if (game.phaseT >= 200) {
      const champ = game.wins.findIndex(w => w >= 2);
      if (champ >= 0 || game.round >= 5) {
        game.matchWinner = champ >= 0 ? champ : (game.wins[0] === game.wins[1] ? -1 : (game.wins[0] > game.wins[1] ? 0 : 1));
        showResult();
      } else {
        game.round++;
        startRound();
      }
    }
  }

  if (game.announce && ++game.announce.t > game.announce.dur) game.announce = null;
}

function step() {
  clock++;
  if (game.mode === 'fight') {
    if (keysPressed.has('KeyP') || keysPressed.has('Escape')) togglePause();
    if (!game.paused) {
      if (hitstop > 0) hitstop--;
      else updateFight();
      if (shake > 0) shake *= 0.85;
      if (shake < 0.5) shake = 0;
    }
  }
  keysPressed.clear();
  touchPressed.clear();
}

// ---------------------------------------------------------------------
//  Drawing helpers
// ---------------------------------------------------------------------
function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function fillEll(c, x, y, rx, ry, color, rot = 0) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
}
function starPath(c, x, y, r, rot) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  c.closePath();
}
function heartPath(c, x, y, s) {
  c.beginPath();
  c.moveTo(x, y + s * 0.35);
  c.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.45, y - s, x, y - s * 0.45);
  c.bezierCurveTo(x + s * 0.45, y - s, x + s, y - s * 0.3, x, y + s * 0.35);
  c.closePath();
}
function outlinedText(c, text, x, y, size, fill, align = 'center', lw = 0) {
  c.font = `700 ${size}px ${FONT}`;
  c.textAlign = align; c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = lw || size * 0.16;
  c.strokeStyle = INK;
  c.strokeText(text, x, y);
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

// ---------------------------------------------------------------------
//  Plush character art — fuzzy, rounded, softly shaded (all procedural)
// ---------------------------------------------------------------------
const EYE = '#21160f';

// short fur strokes poking out around an ellipse, which makes edges look fuzzy
function furRing(c, cx, cy, rx, ry, color, n, seed, len, skip) {
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i + hash(seed + i) * 0.6) / n * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = cx + ca * rx, py = cy + sa * ry;
    if (skip && skip(px, py)) continue;
    let nx = ca / rx, ny = sa / ry;
    const l = Math.hypot(nx, ny); nx /= l; ny /= l;
    const tw = (hash(seed * 3 + i) - 0.5) * 0.5, L = len * (0.6 + hash(seed * 7 + i) * 0.6);
    const dx = nx * Math.cos(tw) - ny * Math.sin(tw), dy = nx * Math.sin(tw) + ny * Math.cos(tw);
    c.moveTo(px - nx * 4, py - ny * 4);
    c.lineTo(px + dx * L, py + dy * L);
  }
  c.strokeStyle = color;
  c.stroke();
}

// soft fuzzy patch (belly, muzzle, spots)
function softBlob(c, x, y, rx, ry, color, seed = 1) {
  fillEll(c, x, y, rx, ry, color);
  c.lineWidth = 2.6;
  furRing(c, x, y, rx, ry, color, Math.round((rx + ry) * 1.1), seed, 2.6);
}

function fuzzyEll(c, x, y, rx, ry, color, seed, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot);
  fillEll(c, 0, 0, rx, ry, color);
  c.lineWidth = 3;
  furRing(c, 0, 0, rx, ry, color, Math.round((rx + ry) * 1.0), seed, 3);
  c.restore();
}

function limb(c, x1, y1, x2, y2, color, seed, r = 11) {
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
  c.lineWidth = r * 1.75; c.strokeStyle = color; c.stroke();
  fillEll(c, x2, y2, r, r, color);
  c.lineWidth = 3;
  furRing(c, x2, y2, r, r, color, 16, seed, 3);
  fillEll(c, x2 - r * 0.3, y2 - r * 0.35, r * 0.4, r * 0.3, 'rgba(255,255,255,.18)');
}

function eyes(k, pts, r = 4.6, opts = {}) {
  const { c, face, s, ch } = k;
  c.lineCap = 'round'; c.lineJoin = 'round';
  pts.forEach(([ex, ey], idx) => {
    const i = idx ? 1 : -1;
    c.lineWidth = 2.8; c.strokeStyle = EYE; c.fillStyle = EYE;
    if (face === 'ko') {
      c.beginPath(); c.moveTo(ex - 4.5, ey - 4.5); c.lineTo(ex + 4.5, ey + 4.5); c.moveTo(ex + 4.5, ey - 4.5); c.lineTo(ex - 4.5, ey + 4.5); c.stroke();
    } else if (face === 'hurt') {
      c.beginPath(); c.moveTo(ex - i * 5, ey - 5); c.lineTo(ex + i * 4, ey); c.lineTo(ex - i * 5, ey + 5); c.stroke();
    } else if (face === 'happy' || face === 'squint') {
      c.beginPath(); c.arc(ex, ey + 3, 5, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    } else if (s.blink !== undefined && s.blink < 6) {
      c.beginPath(); c.moveTo(ex - 5, ey); c.lineTo(ex + 5, ey); c.stroke();
    } else {
      fillEll(c, ex, ey, r, r * 1.08, EYE);
      fillEll(c, ex - r * 0.35, ey - r * 0.4, r * 0.38, r * 0.38, '#ffffff');
      if (opts.lid) { // sleepy / grumpy half-closed lids
        c.beginPath();
        c.ellipse(ex, ey - r * 0.55, r + 2, r * 0.75, 0, Math.PI, Math.PI * 2);
        c.fillStyle = opts.lid; c.fill();
        c.beginPath(); c.moveTo(ex - r - 1, ey - r * 0.5); c.lineTo(ex + r + 1, ey - r * 0.5);
        c.lineWidth = 2; c.strokeStyle = ch.darker; c.stroke();
      }
      if (face === 'fierce') {
        c.lineWidth = 3.5; c.strokeStyle = ch.darker;
        c.beginPath();
        c.moveTo(ex - 6, ey - r - (i < 0 ? 6 : 2)); c.lineTo(ex + 6, ey - r - (i < 0 ? 2 : 6));
        c.stroke();
      }
    }
  });
}

function mouth(k, x, y, w = 3.6) {
  const { c, face } = k;
  c.lineWidth = 2.2; c.strokeStyle = EYE; c.lineCap = 'round';
  if (face === 'hurt' || face === 'ko') {
    fillEll(c, x, y + 3, 3.2, 4.2, EYE);
  } else if (face === 'happy') {
    c.beginPath(); c.arc(x, y, 6, 0.15, Math.PI - 0.15); c.closePath();
    c.fillStyle = '#8a2b2b'; c.fill();
  } else if (face === 'fierce') {
    c.beginPath(); c.arc(x, y + 7, 5, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
  } else {
    c.beginPath(); c.arc(x - w, y, w, 0.2, Math.PI - 0.2); c.moveTo(x + w * 2 - 0.5, y); c.arc(x + w, y, w, 0.2, Math.PI - 0.2); c.stroke();
  }
}

function pointyEars(k, inner, spread = 1) {
  const { c, ch, hx, hy } = k;
  c.lineJoin = 'round';
  for (const i of [-1, 1]) {
    c.beginPath();
    c.moveTo(hx + i * 10, hy - 24);
    c.lineTo(hx + i * (28 + 6 * spread), hy - 52 - 4 * spread);
    c.lineTo(hx + i * (36 + 2 * spread), hy - 8);
    c.closePath();
    c.fillStyle = ch.body; c.fill();
    c.lineWidth = 7; c.strokeStyle = ch.body; c.stroke();
    c.lineWidth = 2.5; c.strokeStyle = ch.dark; c.stroke();
    c.beginPath();
    c.moveTo(hx + i * 18, hy - 26);
    c.lineTo(hx + i * (28 + 6 * spread), hy - 44 - 4 * spread);
    c.lineTo(hx + i * (32 + 2 * spread), hy - 18);
    c.closePath();
    c.fillStyle = inner; c.fill();
  }
}

// per-character details: back (behind body), mark (on fur, clipped), face, acc (accessories), top (hats)
const ART = {
  otter: {
    back(k) { for (const i of [-1, 1]) fuzzyEll(k.c, k.hx + i * 29, k.hy - 20, 9, 8, k.ch.dark, 30 + i); },
    mark(k) {
      softBlob(k.c, k.fo, k.hy + 4, 31, 25, k.ch.light, 5);
      softBlob(k.c, 4, -36 + k.bob * 0.4, 25, 32, k.ch.light, 6);
    },
    face(k) {
      eyes(k, [[k.fo - 15, k.hy - 6], [k.fo + 15, k.hy - 6]]);
      fillEll(k.c, k.fo, k.hy + 6, 12, 8.5, '#3b2720');
      fillEll(k.c, k.fo - 3, k.hy + 3, 4.5, 2.2, 'rgba(255,255,255,.45)');
      mouth(k, k.fo, k.hy + 18);
    },
  },
  cat: {
    back(k) { pointyEars(k, '#f6b49c', 0); },
    mark(k) {
      const { c, ch, hx, hy, bob } = k;
      c.lineCap = 'round'; c.lineWidth = 5; c.strokeStyle = ch.dark;
      c.beginPath();
      for (const dx of [-11, 1, 13]) { c.moveTo(hx + dx - 2, hy - 31); c.quadraticCurveTo(hx + dx + 1, hy - 23, hx + dx, hy - 15); }
      for (const i of [-1, 1]) for (const yy of [-66, -52, -38]) {
        c.moveTo(i * 38, yy + bob * 0.5); c.quadraticCurveTo(i * 30, yy - 3 + bob * 0.5, i * 24, yy + 4 + bob * 0.5);
      }
      c.stroke();
      softBlob(c, 4, -34 + bob * 0.4, 24, 29, ch.light, 7);
    },
    face(k) {
      const { c, ch, fo, hy } = k;
      softBlob(c, fo - 8, hy + 12, 12, 9, ch.light, 8);
      softBlob(c, fo + 8, hy + 12, 12, 9, ch.light, 9);
      softBlob(c, fo, hy + 19, 8, 5, ch.light, 10);
      eyes(k, [[fo - 15, hy - 4], [fo + 15, hy - 4]], 5, { lid: ch.body });
      c.beginPath(); c.moveTo(fo - 4.5, hy + 4); c.lineTo(fo + 4.5, hy + 4); c.lineTo(fo, hy + 9); c.closePath();
      c.fillStyle = '#e46f78'; c.fill();
      mouth(k, fo, hy + 12, 3.4);
      c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,.75)';
      c.beginPath();
      for (const i of [-1, 1]) for (const dy of [-2, 2]) { c.moveTo(fo + i * 15, hy + 12 + dy); c.lineTo(fo + i * 34, hy + 9 + dy * 2.5); }
      c.stroke();
    },
    acc(k) {
      const { c, fo, bob } = k, x = fo - 2, y = -70 + bob * 0.7;
      c.fillStyle = '#6f56c2';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 15, y - 9); c.quadraticCurveTo(x - 18, y, x - 15, y + 9); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 15, y - 9); c.quadraticCurveTo(x + 18, y, x + 15, y + 9); c.closePath(); c.fill();
      fillEll(c, x, y, 5, 5, '#55409f');
      fillEll(c, x - 9, y - 3, 3, 1.6, 'rgba(255,255,255,.3)');
    },
  },
  cow: {
    back(k) {
      const { c, ch, hx, hy } = k;
      for (const i of [-1, 1]) {
        c.beginPath();
        c.moveTo(hx + i * 12, hy - 22);
        c.quadraticCurveTo(hx + i * 26, hy - 34, hx + i * 22, hy - 46);
        c.quadraticCurveTo(hx + i * 16, hy - 34, hx + i * 4, hy - 26);
        c.closePath(); c.fillStyle = '#fff2d6'; c.fill();
        fuzzyEll(c, hx + i * 38, hy - 12, 15, 8, ch.body, 40 + i, i * 0.35);
        fillEll(c, hx + i * 39, hy - 11, 8, 4, '#f1a99b', i * 0.35);
      }
    },
    mark(k) {
      const { c, hy, bob } = k, sp = '#b98468';
      softBlob(c, -16, hy - 14, 13, 10, sp, 11);
      softBlob(c, -26, -42 + bob * 0.4, 14, 18, sp, 12);
      softBlob(c, 24, -24 + bob * 0.4, 12, 10, sp, 13);
      softBlob(c, 4, -34 + bob * 0.4, 22, 26, '#fbe8d8', 14);
    },
    face(k) {
      const { c, ch, fo, hy, face } = k;
      eyes(k, [[fo - 16, hy - 10], [fo + 17, hy - 10]], 4.4);
      softBlob(c, fo + 2, hy + 12, 25, 16, ch.light, 15);
      fillEll(c, fo - 6, hy + 11, 3, 4.5, '#8a4b45');
      fillEll(c, fo + 10, hy + 11, 3, 4.5, '#8a4b45');
      if (face !== 'normal') mouth(k, fo + 2, hy + 22);
    },
    acc(k) {
      const { c, fo, bob } = k, y = -72 + bob * 0.7;
      c.lineWidth = 6; c.strokeStyle = '#9c3a2f'; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-30, y - 2); c.quadraticCurveTo(4, y + 10, 34, y - 2); c.stroke();
      const x = fo, by = y + 8;
      c.beginPath(); c.moveTo(x - 9, by + 14); c.quadraticCurveTo(x - 9, by - 2, x, by - 2); c.quadraticCurveTo(x + 9, by - 2, x + 9, by + 14); c.closePath();
      c.fillStyle = '#e6b53a'; c.fill();
      fillEll(c, x, by + 15, 3, 3, '#7a5a1a');
      fillEll(c, x - 3, by + 3, 2, 4, 'rgba(255,255,255,.5)');
    },
  },
  corgi: {
    back(k) { pointyEars(k, '#ffd2bd', 1.6); },
    mark(k) {
      const { c, ch, fo, hy, bob } = k;
      softBlob(c, fo, hy + 10, 22, 15, ch.light, 16);
      softBlob(c, fo, hy - 8, 5, 11, ch.light, 17);
      softBlob(c, 4, -38 + bob * 0.4, 26, 30, ch.light, 18);
      const by = -24 + bob * 0.3;
      c.fillStyle = '#6b3f2a'; c.fillRect(-40, by, 80, 9);
      starPath(c, fo - 2, by + 4.5, 7, -Math.PI / 2); c.fillStyle = '#f2c13d'; c.fill();
    },
    face(k) {
      const { c, fo, hy } = k;
      eyes(k, [[fo - 14, hy - 6], [fo + 14, hy - 6]]);
      fillEll(c, fo, hy + 4, 8.5, 6, '#2a1c17');
      fillEll(c, fo - 2.5, hy + 2, 3, 1.6, 'rgba(255,255,255,.45)');
      mouth(k, fo, hy + 13);
    },
    acc(k) {
      const { c, fo, bob } = k, y = -74 + bob * 0.7;
      c.beginPath(); c.moveTo(-30, y); c.quadraticCurveTo(4, y + 6, 36, y); c.lineTo(fo + 2, y + 26); c.closePath();
      c.fillStyle = '#c44a3a'; c.fill();
      c.fillStyle = 'rgba(255,255,255,.55)';
      for (const [dx, dy] of [[-12, 4], [6, 6], [20, 4], [2, 15]]) { c.beginPath(); c.arc(fo + dx, y + dy, 1.6, 0, Math.PI * 2); c.fill(); }
    },
    top(k) {
      const { c, hx, hy } = k;
      fillEll(c, hx + 2, hy - 25, 52, 10, '#7c3326');
      fillEll(c, hx + 2, hy - 27, 46, 6, '#94402f');
      c.beginPath();
      c.moveTo(hx - 24, hy - 26);
      c.bezierCurveTo(hx - 26, hy - 50, hx - 18, hy - 62, hx + 2, hy - 56);
      c.bezierCurveTo(hx + 22, hy - 62, hx + 30, hy - 50, hx + 28, hy - 26);
      c.closePath(); c.fillStyle = '#8a3a2b'; c.fill();
      c.fillStyle = '#4f1f17'; c.fillRect(hx - 25, hy - 36, 54, 7);
      starPath(c, hx + 2, hy - 46, 6.5, -Math.PI / 2); c.fillStyle = '#f2c13d'; c.fill();
      fillEll(c, hx - 12, hy - 50, 4, 7, 'rgba(255,255,255,.12)', -0.3);
    },
  },
  bunny: {
    back(k) {
      const { c, ch, hx, hy, anim } = k;
      const sway = Math.sin(anim * 0.08) * 0.06;
      for (const i of [-1, 1]) {
        c.save(); c.translate(hx + i * 13, hy - 22); c.rotate(i * 0.14 + sway);
        fillEll(c, 0, -30, 11, 32, ch.body);
        c.lineWidth = 3; furRing(c, 0, -30, 11, 32, ch.body, 44, 50 + i, 3);
        fillEll(c, 0, -28, 5.5, 23, '#f4b5bf');
        c.restore();
      }
    },
    mark(k) {
      const { c, ch, fo, hy, bob } = k;
      softBlob(c, fo - 12, hy + 11, 13, 10, ch.light, 19);
      softBlob(c, fo + 12, hy + 11, 13, 10, ch.light, 20);
      softBlob(c, 4, -36 + bob * 0.4, 24, 30, ch.light, 21);
    },
    face(k) {
      const { c, fo, hy } = k;
      eyes(k, [[fo - 18, hy - 4], [fo + 18, hy - 4]]);
      c.beginPath(); c.moveTo(fo - 4, hy + 4); c.lineTo(fo + 4, hy + 4); c.lineTo(fo, hy + 8); c.closePath();
      c.fillStyle = '#e98f9c'; c.fill();
      mouth(k, fo, hy + 11, 3);
    },
    acc(k) {
      const { c, bob } = k, y = -72 + bob * 0.7;
      c.lineCap = 'round'; c.strokeStyle = '#3aa39b'; c.lineWidth = 10;
      c.beginPath(); c.moveTo(-28, y); c.quadraticCurveTo(4, y + 12, 34, y); c.stroke();
      c.lineWidth = 9;
      c.beginPath(); c.moveTo(-18, y + 4); c.lineTo(-24, y + 24); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(-20, y + 2); c.quadraticCurveTo(4, y + 10, 26, y + 1); c.stroke();
    },
  },
  duck: {
    back(k) {
      const { c, ch, hx, hy } = k;
      c.lineCap = 'round'; c.lineWidth = 5; c.strokeStyle = ch.body;
      c.beginPath();
      for (const [dx, tx] of [[-4, -10], [0, 2], [4, 12]]) { c.moveTo(hx + dx, hy - 26); c.quadraticCurveTo(hx + dx, hy - 40, hx + tx, hy - 42); }
      c.stroke();
    },
    mark(k) { softBlob(k.c, 4, -36 + k.bob * 0.4, 24, 30, k.ch.light, 22); },
    face(k) {
      const { c, fo, hy, face } = k;
      eyes(k, [[fo - 11, hy - 12], [fo + 15, hy - 12]], 4.4);
      const open = face === 'hurt' || face === 'ko' || face === 'happy';
      fillEll(c, fo + 15, open ? hy + 15 : hy + 10, 21, 6, '#de841c');
      if (open) fillEll(c, fo + 12, hy + 10, 14, 4, '#7a2b1a');
      fillEll(c, fo + 18, hy + 3, 25, 10, '#f6a531');
      fillEll(c, fo + 13, hy, 12, 3, 'rgba(255,255,255,.35)');
      fillEll(c, fo + 27, hy + 1, 2, 1.3, '#a85d14');
    },
  },
};

function drawChar(c, ch, x, y, facing, s, scale = 1) {
  const anim = s.anim || 0;
  const st = s.state || 'idle';
  c.save();
  c.translate(x, y);
  c.scale(facing * scale, scale);
  c.lineJoin = 'round'; c.lineCap = 'round';

  let bob = Math.sin(anim * 0.1) * 2;
  let tilt = 0;
  let fx = 15, fy = 0, bx = -15, by = 0;              // front / back foot
  let pf = { x: 30, y: -44 }, pb = { x: -30, y: -46 }; // front / back paw
  let face = 'normal';

  if (st === 'walk') {
    const w = Math.sin(anim * 0.35);
    fx += w * 7; bx -= w * 7;
    fy = -Math.max(0, w) * 5; by = -Math.max(0, -w) * 5;
    bob = -Math.abs(w) * 3; tilt = w * 0.04;
  } else if (st === 'jump') {
    fy = -10; by = -6; pf = { x: 36, y: -70 }; pb = { x: -36, y: -70 };
  } else if (st === 'block' || st === 'blockstun') {
    pf = { x: 34, y: -92 }; pb = { x: 26, y: -74 }; face = 'squint'; tilt = -0.05;
  } else if (st === 'hit') {
    face = 'hurt'; tilt = -0.2; pf = { x: 26, y: -74 }; pb = { x: -38, y: -72 };
  } else if (st === 'ko') {
    face = 'ko';
    if (s.onGround) { c.translate(-12, -34); tilt = -1.45; } else tilt = -0.6;
  } else if (st === 'victory') {
    face = 'happy'; pf = { x: 46, y: -96 + Math.sin(anim * 0.3) * 5 }; pb = { x: -44, y: -96 - Math.sin(anim * 0.3) * 5 };
  } else if (st === 'attack') {
    const m = MOVES[s.attack], t = s.t;
    const ph = t < m.startup ? 'wind' : t < m.startup + m.active ? 'hit' : 'rec';
    face = 'fierce';
    if (s.attack === 'punch') {
      if (ph === 'wind') { pf = { x: 10, y: -52 }; tilt = -0.06; }
      else if (ph === 'hit') { pf = { x: 74, y: -68 }; tilt = 0.12; fx += 6; }
      else { pf = { x: 46, y: -58 }; tilt = 0.05; }
    } else if (s.attack === 'kick') {
      if (ph === 'wind') { fy = -14; fx = 6; tilt = -0.1; }
      else if (ph === 'hit') { fx = 78; fy = -30; tilt = -0.25; }
      else { fx = 36; fy = -10; tilt = -0.1; }
    } else if (s.attack === 'airkick') {
      fx = ph === 'hit' ? 66 : 32; fy = ph === 'hit' ? -14 : -22; by = -8; tilt = -0.2;
    } else if (s.attack === 'special') {
      if (ph === 'wind') { pf = { x: -12, y: -60 }; pb = { x: -36, y: -54 }; tilt = -0.1; }
      else { pf = { x: 58, y: -68 }; pb = { x: 50, y: -54 }; tilt = 0.1; face = 'happy'; }
    }
  }
  c.rotate(tilt);

  // squishy jiggle when hit + gentle breathing
  const jig = s.flash ? Math.sin(s.flash * 1.6) * 0.1 * (s.flash / 14) : 0;
  const br = Math.sin(anim * 0.1) * 0.015;
  c.scale(1 + jig - br * 0.5, 1 - jig + br);

  const art = ART[ch.id];
  const hx = 2, hy = -101 + bob, fo = hx + 7;
  const k = { c, ch, hx, hy, fo, bob, face, s, anim };
  const kicking = fx > 34 || fy < -12;

  // feet + back arm
  fuzzyEll(c, bx, -7 + by, 14, 9, ch.feetCol, 60);
  if (!kicking) fuzzyEll(c, fx, -7 + fy, 14, 9, ch.feetCol, 61);
  limb(c, -20, -62 + bob * 0.7, pb.x, pb.y + bob, ch.dark, 62);

  if (art.back) art.back(k);

  // one bean-shaped body: belly + neck + head blended together
  const parts = [
    { x: 0, y: -44 + bob * 0.4, rx: 37, ry: 42 },
    { x: 1, y: -80 + bob * 0.7, rx: 35, ry: 22 },
    { x: hx, y: hy, rx: 34, ry: 31 },
  ];
  const silhouette = () => {
    c.beginPath();
    for (const p of parts) { c.moveTo(p.x + p.rx, p.y); c.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2); }
  };
  const skipFor = self => (px, py) => parts.some(p => p !== self && ((px - p.x) / p.rx) ** 2 + ((py - p.y) / p.ry) ** 2 < 0.97);
  c.lineWidth = 3.6;
  parts.forEach((p, i) => { if (i !== 1) furRing(c, p.x, p.y, p.rx, p.ry, ch.dark, 90, 70 + i, 4.5, skipFor(p)); });
  silhouette(); c.fillStyle = ch.body; c.fill();
  c.lineWidth = 3.4;
  parts.forEach((p, i) => { if (i !== 1) furRing(c, p.x, p.y, p.rx, p.ry, ch.body, 90, 80 + i, 3, skipFor(p)); });

  // markings + fur texture + soft 3D shading, clipped to the body
  c.save();
  silhouette(); c.clip();
  if (art.mark) art.mark(k);
  c.lineWidth = 2; c.lineCap = 'round';
  c.beginPath();
  for (let i = 0; i < 34; i++) {
    const tx = -32 + hash(i) * 64, ty = -132 + hash(i + 50) * 128 + bob * 0.5;
    c.moveTo(tx, ty); c.lineTo(tx + (hash(i + 9) - 0.5) * 4, ty + 4);
  }
  c.strokeStyle = 'rgba(255,255,255,.16)'; c.stroke();
  const g1 = c.createRadialGradient(-16, hy - 14, 4, -16, hy - 14, 75);
  g1.addColorStop(0, 'rgba(255,255,255,.32)'); g1.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g1; c.fillRect(-60, -150, 120, 160);
  const g2 = c.createRadialGradient(4, -66, 34, 4, -66, 92);
  g2.addColorStop(0, 'rgba(80,35,10,0)'); g2.addColorStop(1, 'rgba(80,35,10,.38)');
  c.fillStyle = g2; c.fillRect(-60, -150, 120, 160);
  c.restore();

  if (art.face) art.face(k);
  // rosy cheeks
  fillEll(c, fo - 24, hy + 9, 6.5, 4, 'rgba(255,110,110,.22)');
  fillEll(c, fo + 24, hy + 9, 6.5, 4, 'rgba(255,110,110,.22)');
  if (art.acc) art.acc(k);
  if (art.top) art.top(k);

  if (kicking) limb(c, 10, -26, fx, -7 + fy, ch.feetCol, 63, 12);
  limb(c, 20, -62 + bob * 0.7, pf.x, pf.y + bob, ch.body, 64);

  c.restore();
}

function drawProjectile(p) {
  ctx.save();
  ctx.translate(p.x, p.y + Math.sin(p.t * 0.3) * 4);
  for (let i = 1; i <= 3; i++) {
    ctx.globalAlpha = 0.5 / i;
    starPath(ctx, -p.vx * i * 3, Math.sin((p.t - i * 3) * 0.3) * 4, 8 - i, p.t * 0.2);
    ctx.fillStyle = '#fff6a8'; ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.rotate(Math.sin(p.t * 0.25) * 0.3);
  ctx.font = `40px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.scale(p.vx < 0 ? -1 : 1, 1);
  ctx.fillText(p.emoji, 0, 0);
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    const a = Math.min(1, p.life / (p.max * 0.5));
    ctx.save();
    ctx.globalAlpha = a;
    if (p.type === 'text') {
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      const sc = Math.min(1, (p.max - p.life + 4) / 8);
      ctx.scale(sc, sc);
      outlinedText(ctx, p.text, 0, 0, p.size, p.color);
    } else if (p.type === 'star') {
      starPath(ctx, p.x, p.y, p.size, p.rot);
      ctx.fillStyle = p.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    } else if (p.type === 'fluff') {
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      furRing(ctx, 0, 0, p.size * 0.5, p.size * 0.5, p.color, 7, 3, p.size * 0.8);
      fillEll(ctx, 0, 0, p.size * 0.5, p.size * 0.5, p.color);
    } else {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------
//  Background: warm golden party stage (static part cached once)
// ---------------------------------------------------------------------
const bgCanvas = document.createElement('canvas');
bgCanvas.width = W; bgCanvas.height = H;
(function paintBackground() {
  const c = bgCanvas.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ffc46b'); g.addColorStop(0.55, '#ffa94d'); g.addColorStop(1, '#f58b3a');
  c.fillStyle = g; c.fillRect(0, 0, W, H);

  // light beams
  for (const [x, w] of [[180, 90], [470, 130], [760, 100]]) {
    const lg = c.createLinearGradient(0, 0, 0, 430);
    lg.addColorStop(0, 'rgba(255,245,210,.45)'); lg.addColorStop(1, 'rgba(255,245,210,0)');
    c.fillStyle = lg;
    c.beginPath(); c.moveTo(x - w * 0.3, 0); c.lineTo(x + w * 0.3, 0); c.lineTo(x + w, 430); c.lineTo(x - w, 430); c.closePath(); c.fill();
  }

  // soft bokeh dots
  for (let i = 0; i < 18; i++) {
    c.fillStyle = `rgba(255,240,200,${0.08 + hash(i) * 0.12})`;
    c.beginPath(); c.arc(hash(i + 3) * W, 60 + hash(i + 7) * 300, 10 + hash(i + 11) * 30, 0, Math.PI * 2); c.fill();
  }

  // hanging golden lamps
  for (const x of [180, 470, 760]) {
    c.fillStyle = '#c9751f'; c.fillRect(x - 2, 0, 4, 18);
    const lg = c.createLinearGradient(x - 40, 0, x + 40, 0);
    lg.addColorStop(0, '#d9822a'); lg.addColorStop(0.4, '#ffd27a'); lg.addColorStop(1, '#c46c1f');
    c.fillStyle = lg; rr(c, x - 40, 14, 80, 26, 6); c.fill();
    c.fillStyle = '#fff2b8'; c.beginPath(); c.ellipse(x, 40, 38, 6, 0, 0, Math.PI * 2); c.fill();
  }

  // stage floor
  const fg = c.createLinearGradient(0, 425, 0, H);
  fg.addColorStop(0, '#f7a457'); fg.addColorStop(1, '#e8833a');
  c.fillStyle = fg; c.fillRect(0, 425, W, H - 425);
  const sp = c.createRadialGradient(W / 2, 470, 20, W / 2, 470, 420);
  sp.addColorStop(0, 'rgba(255,240,200,.5)'); sp.addColorStop(1, 'rgba(255,240,200,0)');
  c.fillStyle = sp; c.fillRect(0, 425, W, H - 425);
  c.fillStyle = '#e07a2e'; c.fillRect(0, 420, W, 7);
  c.fillStyle = 'rgba(255,240,200,.6)'; c.fillRect(0, 420, W, 2);

  // a few gold coins resting on the floor
  for (const [x, y] of [[70, 505], [110, 520], [880, 500], [905, 518], [850, 525]]) {
    c.fillStyle = '#c98a1f'; c.beginPath(); c.ellipse(x, y + 2, 13, 6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffd34d'; c.beginPath(); c.ellipse(x, y, 13, 6, 0, 0, Math.PI * 2); c.fill();
  }
})();

// falling cash + coins confetti
const confetti = Array.from({ length: 22 }, (_, i) => ({
  x: rand(0, W), y: rand(-H, H), vy: rand(0.4, 1.1), rot: rand(0, 6), vr: rand(-0.04, 0.04),
  sway: rand(0, 6), coin: i % 3 === 0,
}));
function drawBackground() {
  ctx.drawImage(bgCanvas, 0, 0);
  for (const p of confetti) {
    p.y += p.vy; p.rot += p.vr; p.sway += 0.02;
    if (p.y > 430) { p.y = -20; p.x = rand(0, W); }
    ctx.save();
    ctx.translate(p.x + Math.sin(p.sway) * 14, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = 0.85;
    if (p.coin) {
      const sx = Math.abs(Math.cos(p.sway * 2));
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.ellipse(0, 0, 7 * sx + 1, 7, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#9fd36a'; ctx.fillRect(-10, -5, 20, 10);
      ctx.fillStyle = '#6fae3f'; ctx.fillRect(-3, -3, 6, 6);
    }
    ctx.restore();
  }
}

function drawShadow(f) {
  const h = clamp((GROUND - f.y) / 200, 0, 0.7);
  ctx.fillStyle = `rgba(90,40,10,${0.25 * (1 - h)})`;
  ctx.beginPath(); ctx.ellipse(f.x, GROUND + 2, 48 * (1 - h * 0.5), 10 * (1 - h * 0.5), 0, 0, Math.PI * 2); ctx.fill();
}

// ---------------------------------------------------------------------
//  HUD
// ---------------------------------------------------------------------
function drawBar(x, y, w, f, flip) {
  const h = 26, col = f.side ? '#4aa3ff' : '#ff6b5b';
  rr(ctx, x, y, w, h, 13); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.save(); rr(ctx, x, y, w, h, 13); ctx.clip();
  const dw = w * f.dmgHp / 100, hw = w * f.hp / 100;
  ctx.fillStyle = '#ffb3b3';
  ctx.fillRect(flip ? x : x + w - dw, y, dw, h);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  const low = f.hp < 30;
  g.addColorStop(0, low ? '#ffd166' : '#b6f5a8'); g.addColorStop(1, low ? '#ff7f43' : '#4fbf62');
  ctx.fillStyle = g;
  ctx.fillRect(flip ? x : x + w - hw, y, hw, h);
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(x, y + 3, w, 6);
  ctx.restore();
  rr(ctx, x, y, w, h, 13); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();

  // special meter: thin strip under the health bar, on the centre side
  const ready = f.specialCd === 0;
  const sw = 160, sx = flip ? x : x + w - sw, sy = y + 31;
  rr(ctx, sx, sy, sw, 10, 5); ctx.fillStyle = '#fff'; ctx.fill();
  const fill = sw * (1 - f.specialCd / SPECIAL_COOLDOWN);
  if (fill > 0) {
    rr(ctx, flip ? sx : sx + sw - fill, sy, fill, 10, 5);
    ctx.fillStyle = ready ? `hsl(${(clock * 6) % 360},90%,72%)` : '#ffe08a'; ctx.fill();
  }
  rr(ctx, sx, sy, sw, 10, 5); ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
  ctx.font = `600 13px ${FONT}`; ctx.fillStyle = INK; ctx.textBaseline = 'middle';
  ctx.textAlign = flip ? 'left' : 'right';
  ctx.fillText(ready ? '✨ special ready!' : '✨', flip ? sx + sw + 6 : sx - 6, sy + 5);

  // name on the outer side, round-win hearts on the centre side
  outlinedText(ctx, `${f.ch.name}${game.vsCPU && f.side === 1 ? ' (CPU)' : ''}`, flip ? x + w - 4 : x + 4, y + 60, 22, col, flip ? 'right' : 'left', 5);
  for (let i = 0; i < 2; i++) {
    const hx = flip ? x + 14 + i * 30 : x + w - 14 - i * 30;
    heartPath(ctx, hx, y + 62, 13);
    ctx.fillStyle = game.wins[f.side] > i ? '#ff5e7a' : '#fff';
    ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  }

  if (f.combo >= 2 && f.comboTimer > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.comboTimer / 20);
    outlinedText(ctx, `${f.combo} HIT COMBO!`, flip ? W - 40 : 40, 170, 30, '#ffe066', flip ? 'right' : 'left');
    ctx.restore();
  }
}

function drawHUD() {
  const [a, b] = game.fighters;
  drawBar(26, 20, 370, a, false);
  drawBar(W - 26 - 370, 20, 370, b, true);

  ctx.beginPath(); ctx.arc(W / 2, 40, 36, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
  const secs = Math.ceil(game.timer / 60);
  outlinedText(ctx, String(secs), W / 2, 42, 34, secs <= 10 ? '#ff6f6f' : '#fff', 'center', 6);
  ctx.font = `600 13px ${FONT}`; ctx.fillStyle = INK; ctx.textAlign = 'center';
  ctx.fillText(`ROUND ${game.round}`, W / 2, 90);
}

function drawAnnounce() {
  const an = game.announce;
  if (!an) return;
  const t = an.t;
  const s = t < 10 ? 0.3 + (t / 10) * 0.9 : t < 16 ? 1.2 - (t - 10) / 6 * 0.2 : 1;
  const alpha = an.dur - t < 10 ? (an.dur - t) / 10 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H / 2 - 30);
  ctx.scale(s, s);
  ctx.rotate(-0.04);
  outlinedText(ctx, an.text, 4, 8, 84, an.color, 'center', 16);
  outlinedText(ctx, an.text, 0, 0, 84, '#fff', 'center', 12);
  ctx.restore();
}

// ---------------------------------------------------------------------
//  Render
// ---------------------------------------------------------------------
function poseOf(f) {
  let state = f.state;
  if (game.phase === 'end' && f === game.roundWinner && (state === 'idle' || state === 'jump' || state === 'walk')) state = 'victory';
  return { state, attack: f.attack, t: f.t, anim: f.anim, blink: f.blink, flash: f.flash, onGround: f.onGround };
}

function render() {
  ctx.save();
  if (shake) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  drawBackground();

  if (game.mode === 'fight' || game.mode === 'result') {
    const fs = game.fighters;
    fs.forEach(drawShadow);
    const order = fs[0].state === 'attack' ? [fs[1], fs[0]] : [fs[0], fs[1]];
    for (const f of order) drawChar(ctx, f.ch, f.x, f.y, f.facing, poseOf(f), FIGHTER_SCALE);
    projectiles.forEach(drawProjectile);
    drawParticles();
    ctx.restore();
    if (game.mode === 'fight') { drawHUD(); drawAnnounce(); }
  } else {
    // menu line-up
    CHARS.forEach((ch, i) => {
      const x = 100 + i * 152, hop = Math.max(0, Math.sin(clock * 0.05 + i * 1.3)) * 24;
      ctx.fillStyle = 'rgba(90,40,10,.2)';
      ctx.beginPath(); ctx.ellipse(x, GROUND + 2, 38 - hop * 0.3, 9, 0, 0, Math.PI * 2); ctx.fill();
      drawChar(ctx, ch, x, GROUND - hop, i < 3 ? 1 : -1, { state: hop > 14 ? 'victory' : 'idle', anim: clock + i * 40, blink: (clock + i * 50) % 200 }, 0.92);
    });
    ctx.restore();
  }

  if (game.mode === 'select') drawCards();
  if (game.mode === 'result') drawWinnerPreview();
}

// ---------------------------------------------------------------------
//  Menus / DOM
// ---------------------------------------------------------------------
const $ = id => document.getElementById(id);
const screens = ['title', 'howto', 'select', 'pause', 'result'];
function showScreen(name) {
  screens.forEach(s => $(s).classList.toggle('hidden', s !== name));
}
// keyboard instructions under the game only show once a match has started
function updateHint() {
  $('hint').classList.toggle('invisible', game.mode !== 'fight');
}

const cardEls = [];
CHARS.forEach((ch, i) => {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<canvas width="140" height="160"></canvas><div class="nm">${ch.name}</div><div class="ds">${ch.desc}</div>
    <div class="st">Speed ${'★'.repeat(ch.spd)}${'☆'.repeat(3 - ch.spd)}<br>Power ${'★'.repeat(ch.pow)}${'☆'.repeat(3 - ch.pow)}</div>`;
  el.addEventListener('click', () => pick(i));
  el.addEventListener('mouseenter', () => { if (game.hover !== i) sfx('hover'); game.hover = i; });
  $('cards').appendChild(el);
  cardEls.push({ el, c: el.querySelector('canvas').getContext('2d') });
});

function drawCards() {
  cardEls.forEach(({ el, c }, i) => {
    c.clearRect(0, 0, 140, 160);
    const hovered = game.hover === i;
    c.fillStyle = hovered ? '#ffe2c2' : '#fff1e0';
    c.beginPath(); c.arc(70, 100, 58, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(90,40,10,.15)';
    c.beginPath(); c.ellipse(70, 152, 34, 6, 0, 0, Math.PI * 2); c.fill();
    drawChar(c, CHARS[i], 70, 151, 1, { state: hovered ? 'victory' : 'idle', anim: clock + i * 30, blink: (clock + i * 70) % 220 }, 0.74);
    el.classList.toggle('hover', hovered);
  });
}

function updateBadges() {
  cardEls.forEach(({ el }, i) => {
    el.querySelectorAll('.badge').forEach(b => b.remove());
    if (game.selecting === 1 && game.picks[0] === i) {
      const b = document.createElement('div'); b.className = 'badge'; b.textContent = 'P1'; el.appendChild(b);
    }
  });
}

function openSelect() {
  game.mode = 'select';
  updateHint();
  game.selecting = 0;
  game.hover = game.picks[0] || 0;
  $('selectPrompt').textContent = 'Player 1, pick your fighter!';
  updateBadges();
  showScreen('select');
  setMusic('menu');
}

function pick(i) {
  sfx('select');
  game.picks[game.selecting] = i;
  if (game.selecting === 0 && !game.vsCPU) {
    game.selecting = 1;
    $('selectPrompt').textContent = 'Player 2, pick your fighter!';
    updateBadges();
    return;
  }
  if (game.vsCPU) {
    const others = CHARS.map((_, k) => k).filter(k => k !== i);
    game.picks[1] = others[Math.floor(Math.random() * others.length)];
  }
  startMatch();
}

function showResult() {
  game.mode = 'result';
  updateHint();
  const w = game.matchWinner;
  $('resultText').textContent = w < 0 ? "It's a draw!" :
    game.vsCPU ? (w === 0 ? `You win! ${game.fighters[0].ch.name} is the champ!` : `${game.fighters[1].ch.name} (CPU) wins!`) :
    `Player ${w + 1} (${game.fighters[w].ch.name}) wins!`;
  showScreen('result');
  setMusic(null);
  sfx('victory');
  setTimeout(() => { if (game.mode === 'result') setMusic('menu'); }, 2000);
}

const winCtx = $('winnerCanvas').getContext('2d');
function drawWinnerPreview() {
  winCtx.clearRect(0, 0, 220, 230);
  const w = game.matchWinner;
  const chs = w < 0 ? game.fighters.map(f => f.ch) : [game.fighters[w].ch];
  chs.forEach((ch, i) => {
    const x = chs.length === 1 ? 110 : 60 + i * 100;
    const hop = Math.abs(Math.sin(clock * 0.08 + i)) * 22;
    winCtx.fillStyle = 'rgba(90,40,10,.2)';
    winCtx.beginPath(); winCtx.ellipse(x, 220, 34, 7, 0, 0, Math.PI * 2); winCtx.fill();
    drawChar(winCtx, ch, x, 218 - hop, i ? -1 : 1, { state: 'victory', anim: clock }, chs.length === 1 ? 1.0 : 0.75);
  });
}

function togglePause() {
  if (game.mode !== 'fight') return;
  game.paused = !game.paused;
  showScreen(game.paused ? 'pause' : null);
  updateMusicVolume();
}

function toMenu() {
  game.mode = 'title';
  updateHint();
  game.paused = false;
  shake = 0;
  showScreen('title');
  setMusic('menu');
  updateMusicVolume();
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  initAudio();
  sfx('select');
  switch (btn.dataset.action) {
    case 'cpu': game.vsCPU = true; openSelect(); break;
    case 'pvp': game.vsCPU = false; openSelect(); break;
    case 'howto': game.mode = 'howto'; showScreen('howto'); break;
    case 'menu': toMenu(); break;
    case 'resume': togglePause(); break;
    case 'rematch': startMatch(); break;
    case 'reselect': openSelect(); break;
  }
});

function onMenuKey(e) {
  if (game.mode !== 'select') return;
  const k = e.code;
  if (k === 'ArrowLeft' || k === 'KeyA') { game.hover = (game.hover + CHARS.length - 1) % CHARS.length; sfx('hover'); }
  if (k === 'ArrowRight' || k === 'KeyD') { game.hover = (game.hover + 1) % CHARS.length; sfx('hover'); }
  if (k === 'Enter' || k === 'Space' || k === 'KeyF' || k === 'Comma') pick(game.hover);
  if (k === 'Escape') toMenu();
}

function refreshAudioButtons() {
  $('musicBtn').textContent = musicOn ? '🎵 Music on' : '🎵 Music off';
  $('muteBtn').textContent = sfxOn ? '🔊 Sound on' : '🔇 Sound off';
  $('musicBtn').classList.toggle('off', !musicOn);
  $('muteBtn').classList.toggle('off', !sfxOn);
}
$('musicBtn').addEventListener('click', () => {
  initAudio();
  musicOn = !musicOn;
  if (musicOn && actx) nextNote = actx.currentTime + 0.05;
  updateMusicVolume(); saveAudioPrefs(); refreshAudioButtons();
});
$('muteBtn').addEventListener('click', () => {
  initAudio();
  sfxOn = !sfxOn;
  if (sfxBus) sfxBus.gain.value = sfxOn ? 0.9 : 0;
  saveAudioPrefs(); refreshAudioButtons();
});
refreshAudioButtons();
setMusic('menu');

// touch controls (shown on phones / tablets)
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
  $('touch').classList.remove('hidden');
}
document.querySelectorAll('#touch button').forEach(b => {
  const act = b.dataset.act;
  const down = e => { e.preventDefault(); touchHeld.add(act); touchPressed.add(act); b.classList.add('on'); };
  const up = e => { e.preventDefault(); touchHeld.delete(act); b.classList.remove('on'); };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointerleave', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'fight' && !game.paused) togglePause();
});

// ---------------------------------------------------------------------
//  Main loop (fixed 60 updates per second)
// ---------------------------------------------------------------------
const STEP = 1000 / 60;
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(100, now - last);
  last = now;
  while (acc >= STEP) { step(); acc -= STEP; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
