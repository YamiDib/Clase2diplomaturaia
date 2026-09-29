// =====================================================
//  ENTORNO 360° ABSTRACTO - v4
//  - Clic sobre objeto: pulso, onda expansiva, partículas y mutación de forma.
//  - Doble clic en espacio vacío: crea un objeto nuevo.
//  - Arrastrar (izq. o botón central): órbita 360°.  Rueda: zoom.
//  - M: micrófono ON/OFF.   D: modo demo (simula voz, sin micrófono).
//  - E: nivel de caos.      1-6: fuerza un patrón de movimiento.   A: automático.
//
//  LA VOZ ACTIVA:
//   · patrones de movimiento (según lo grave/agudo del sonido)
//   · halo espectral 3D (anillos que dibujan tu voz)
//   · constelación: líneas entre objetos cercanos
//   · chispas que salen de los objetos
//   · halos orbitales en los objetos
//   · mutación automática de formas al ritmo de la voz
//   · nacimiento de objetos nuevos si hablás fuerte y sostenido
//   · deriva suave de la cámara
// =====================================================

let camYaw = 0, camPitch = 0;
let targetCamYaw = 0, targetCamPitch = 0;
let zoomDistance = 500, targetZoom = 500;

let dragging = false, dragMoved = 0;
let lastMouseX = 0, lastMouseY = 0;

let floatingObjects = [];
let particles = [];
let ripples = [];
let sparks = [];
let linkPairs = [];  // parejas de objetos unidas por líneas (se recalculan cada 3 frames)

const INITIAL_OBJECTS = 130;
const MAX_OBJECTS = 320;
const NUM_TYPES = 7;
const DUST_N = 1800;
let SPIKES = [];
let RIPPLE_DIRS = [];
let dustBase;

let lastEmptyClickTime = 0, lastEmptyClickX = 0, lastEmptyClickY = 0;

// --- Movimiento ---
let noiseT = 0;
let patT = 0;
let vortexAngle = 0;
const CHAOS_LEVELS = [0.4, 1.0, 2.2];
const CHAOS_NAMES = ['calmo', 'normal', 'errático'];
let chaosIdx = 1;

// --- Patrones ---
const PATTERN_NAMES = [
  'Ondas', 'Vórtice', 'Respiración radial',
  'Espiral helicoidal', 'Órbitas', 'Dispersión errática'
];
const PATTERN_GROUPS = [[2, 0], [1, 3], [5, 4]]; // [graves, medios/voz, agudos]
let currentPattern = 0;
let patternW = [1, 0, 0, 0, 0, 0];
let autoMode = true;
let patGroup = 1, patVariant = 0;
let lastPatEval = 0, lastAutoCycle = 0;

// --- Audio ---
let audioCtx = null, analyser = null, freqData = null, micStream = null;
let micOn = false;
let demoMode = false;
let audioLevel = 0;
let bassLevel = 0;
let centroid = 12;
let lastBeat = 0;
let loudSince = 0, lastBirth = 0;

// --- UI ---
let micButton, hudDiv, meterBar;
let visibleCount = 0;

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight, WEBGL);
  angleMode(DEGREES);
  SPIKES = fibonacciSphere(14);
  RIPPLE_DIRS = fibonacciSphere(240);

  // Polvo cósmico: puntos base fijos
  dustBase = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N; i++) {
    let d = p5.Vector.random3D();
    let r = random(200, 1700);
    dustBase[i * 3] = d.x * r;
    dustBase[i * 3 + 1] = d.y * r;
    dustBase[i * 3 + 2] = d.z * r;
  }

  canvas.elt.addEventListener('wheel', (e) => {
    targetZoom = constrain(targetZoom + e.deltaY * 0.8, 100, 1800);
    e.preventDefault();
  }, { passive: false });

  canvas.elt.addEventListener('mousedown', (e) => {
    if (e.button === 0 || e.button === 1) {
      dragging = true;
      dragMoved = 0;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let dx = e.clientX - lastMouseX;
    let dy = e.clientY - lastMouseY;
    dragMoved += abs(dx) + abs(dy);
    targetCamYaw += dx * 0.5;
    targetCamPitch = constrain(targetCamPitch - dy * 0.5, -89, 89);
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  window.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (e.button === 0 && dragMoved < 6 && e.target === canvas.elt) {
      let r = canvas.elt.getBoundingClientRect();
      handleClick(e.clientX - r.left, e.clientY - r.top);
    }
  });

  canvas.elt.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    let k = e.key.toLowerCase();
    if (k === 'm') toggleMic();
    if (k === 'd') demoMode = !demoMode;
    if (k === 'e') chaosIdx = (chaosIdx + 1) % CHAOS_LEVELS.length;
    if (k === 'a') { autoMode = true; lastAutoCycle = millis(); }
    if (k >= '1' && k <= '6') {
      currentPattern = int(k) - 1;
      autoMode = false;
    }
  });

  micButton = createButton('🎤 Activar micrófono');
  micButton.position(16, 16);
  micButton.style('padding', '8px 14px');
  micButton.style('border-radius', '8px');
  micButton.style('border', '1px solid #6a6f9a');
  micButton.style('background', '#151830');
  micButton.style('color', '#fff');
  micButton.style('cursor', 'pointer');
  micButton.mousePressed(toggleMic);

  meterBar = createDiv('');
  meterBar.position(16, 56);
  meterBar.style('height', '4px');
  meterBar.style('width', '0px');
  meterBar.style('background', '#7fe0ff');
  meterBar.style('border-radius', '2px');
  meterBar.style('pointer-events', 'none');

  hudDiv = createDiv('');
  hudDiv.position(16, 70);
  hudDiv.style('color', '#aab');
  hudDiv.style('font', '12px monospace');
  hudDiv.style('pointer-events', 'none');
  hudDiv.style('line-height', '1.5');

  for (let i = 0; i < INITIAL_OBJECTS; i++) {
    let a = random(0, 360), b = random(-60, 60), d = random(300, 1400);
    floatingObjects.push(makeObject(
      d * cos(a) * cos(b),
      d * sin(b),
      d * sin(a) * cos(b)
    ));
  }
}

function makeObject(x, y, z) {
  let o = {
    x, y, z,
    px: x, py: y, pz: z,
    sx: 0, sy: 0, depth: -1, sc: 1,
    seed: random(1000),
    size: random(28, 55),
    rotSpeed: random(0.3, 1.2),
    rotX: random(360), rotY: random(360),
    type: floor(random(NUM_TYPES)),
    hover: false,
    color: color(random(100, 255), random(100, 255), 255),
    activeColor: color(255),
    pulseEnergy: 0, shockwave: 0,
    morph: 1, spin: 0
  };
  refreshProjection(o);
  return o;
}

function refreshProjection(o) {
  let p = project(o.px, o.py, o.pz);
  o.sx = p.x; o.sy = p.y; o.depth = p.depth; o.sc = p.scale;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// =====================================================
//  AUDIO
// =====================================================
async function toggleMic() {
  if (micOn) {
    micStream.getTracks().forEach(t => t.stop());
    if (audioCtx) audioCtx.close();
    micOn = false;
    audioLevel = 0; bassLevel = 0;
    micButton.html('🎤 Activar micrófono');
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume();
    let src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    micOn = true;
    micButton.html('🎤 Micrófono ON (clic para apagar)');
  } catch (err) {
    alert('No se pudo acceder al micrófono. Revisá el permiso del navegador ' +
          '(hace falta https o localhost).');
  }
}

// Espectro falso para probar todo sin micrófono (tecla D)
function fakeSpectrum() {
  if (!freqData || freqData.length !== 256) freqData = new Uint8Array(256);
  let t = frameCount * 0.03;
  let env = constrain(noise(t * 0.7) * 2.0 - 0.3, 0, 1);
  let s = 10 + 60 * noise(t * 0.3 + 80);
  for (let i = 0; i < 256; i++) {
    freqData[i] = constrain(noise(i * 0.09, t) * 255 * env * exp(-i / s) * 2.6, 0, 255);
  }
}

function voiceActive() {
  return micOn || demoMode;
}

function updateAudio() {
  if (micOn && analyser) {
    analyser.getByteFrequencyData(freqData);
  } else if (demoMode) {
    fakeSpectrum();
  } else {
    audioLevel = lerp(audioLevel, 0, 0.1);
    bassLevel = lerp(bassLevel, 0, 0.1);
    meterBar.style('width', '0px');
    loudSince = 0;
    return;
  }

  let sum = 0;
  for (let i = 1; i < 64; i++) sum += freqData[i];
  let avg = sum / 63;

  let bsum = 0;
  for (let i = 1; i < 8; i++) bsum += freqData[i];
  let bavg = bsum / 7;

  let num = 0, den = 0;
  for (let i = 1; i < 128; i++) { num += i * freqData[i]; den += freqData[i]; }

  audioLevel = lerp(audioLevel, constrain(map(avg, 15, 130, 0, 1), 0, 1), 0.35);
  bassLevel = lerp(bassLevel, constrain(map(bavg, 40, 200, 0, 1), 0, 1), 0.35);
  if (audioLevel > 0.1 && den > 0) centroid = lerp(centroid, num / den, 0.1);

  meterBar.style('width', (audioLevel * 160) + 'px');

  // Golpe de sonido: onda + variante de patrón + mutación de objetos al azar
  if (audioLevel > 0.3 && millis() - lastBeat > 380) {
    lastBeat = millis();
    addRipple(0, 0, 0, 0.6 + audioLevel);
    patVariant = 1 - patVariant;
    if (autoMode) currentPattern = PATTERN_GROUPS[patGroup][patVariant];

    let n = 1 + floor(audioLevel * 5);
    for (let k = 0; k < n; k++) mutateLight(random(floatingObjects));
  }

  // Voz fuerte y sostenida: nace un objeto nuevo
  if (audioLevel > 0.4) {
    if (loudSince === 0) loudSince = millis();
    if (millis() - loudSince > 350 && millis() - lastBirth > 700) {
      lastBirth = millis();
      spawnRandomObject();
    }
  } else {
    loudSince = 0;
  }

  // Grupo de patrones según el tono
  if (autoMode && audioLevel > 0.12 && millis() - lastPatEval > 500) {
    lastPatEval = millis();
    patGroup = centroid < 9 ? 0 : (centroid < 22 ? 1 : 2);
    currentPattern = PATTERN_GROUPS[patGroup][patVariant];
  }
}

// =====================================================
//  ONDAS EXPANSIVAS (procedurales, fragmentadas)
// =====================================================
function addRipple(x, y, z, strength) {
  ripples.push({ x, y, z, r: 20, str: strength, seed: random(1000) });
  if (ripples.length > 6) ripples.shift();
}

function updateRipples() {
  for (let i = ripples.length - 1; i >= 0; i--) {
    let r = ripples[i];
    r.r += 14;
    r.str *= 0.985;
    if (r.r > 1800 || r.str < 0.03) ripples.splice(i, 1);
  }
}

function drawRipples() {
  blendMode(ADD);
  noFill();
  for (let rp of ripples) {
    let fade = constrain(rp.str, 0, 1);

    strokeWeight(1.6);
    stroke(120, 200, 255, 190 * fade);
    beginShape(LINES);
    for (let d of RIPPLE_DIRS) {
      let n = noise(d.x * 1.6 + rp.seed, d.y * 1.6 + rp.seed, d.z * 1.6 + rp.r * 0.005);
      if (n < 0.42) continue;
      let k = (n - 0.42) / 0.58;
      let rr = rp.r * (0.82 + 0.36 * n);
      let len = 8 + 50 * k * fade;
      vertex(rp.x + d.x * rr, rp.y + d.y * rr, rp.z + d.z * rr);
      vertex(rp.x + d.x * (rr + len), rp.y + d.y * (rr + len), rp.z + d.z * (rr + len));
    }
    endShape();

    strokeWeight(4);
    stroke(255, 225, 255, 220 * fade);
    beginShape(POINTS);
    for (let d of RIPPLE_DIRS) {
      let n = noise(d.x * 1.6 + rp.seed, d.y * 1.6 + rp.seed, d.z * 1.6 + rp.r * 0.005);
      if (n < 0.68) continue;
      let k = (n - 0.42) / 0.58;
      let rr = rp.r * (0.82 + 0.36 * n) + 8 + 50 * k * fade;
      vertex(rp.x + d.x * rr, rp.y + d.y * rr, rp.z + d.z * rr);
    }
    endShape();
  }
  blendMode(BLEND);
}

// =====================================================
//  EFECTOS PROCEDURALES DE LA VOZ
// =====================================================

// Polvo cósmico que ondula con los patrones y brilla con la voz
function drawDust() {
  blendMode(ADD);
  noFill();
  strokeWeight(2 + audioLevel * 2);
  stroke(170, 200, 255, 60 + 110 * audioLevel);
  let th = vortexAngle * 0.12;
  let c = cos(th), s = sin(th);
  let k = 1 + bassLevel * 0.15;
  let amp = (15 + 120 * audioLevel) * CHAOS_LEVELS[chaosIdx];
  beginShape(POINTS);
  for (let i = 0; i < DUST_N; i++) {
    let bx = dustBase[i * 3], by = dustBase[i * 3 + 1], bz = dustBase[i * 3 + 2];
    let x = (bx * c + bz * s) * k;
    let z = (-bx * s + bz * c) * k;
    let y = by + sin(bx * 0.012 + patT * 1.5) * amp;
    vertex(x, y, z);
  }
  endShape();
  blendMode(BLEND);
}

// Constelación: cada objeto se une con sus 3 vecinos más cercanos.
// Solo aparece con voz; con más volumen las líneas llegan más lejos y brillan más.
function drawLinks(list) {
  if (!voiceActive() || audioLevel < 0.04) return;

  const K = 3;
  let maxD = 200 + audioLevel * 450;
  let maxD2 = maxD * maxD;

  // Elegimos las parejas cada 3 frames (barato); las líneas se dibujan
  // siempre con las posiciones actuales, así siguen a los objetos en movimiento.
  if (frameCount % 3 === 0 || linkPairs.length === 0) {
    linkPairs = [];
    let seen = new Set();
    let n = list.length;
    for (let i = 0; i < n; i++) {
      let a = list[i];
      let best = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        let b = list[j];
        let dx = a.px - b.px, dy = a.py - b.py, dz = a.pz - b.pz;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= maxD2) continue;
        if (best.length < K) {
          best.push({ j: j, d2: d2 });
          best.sort((u, v) => u.d2 - v.d2);
        } else if (d2 < best[K - 1].d2) {
          best[K - 1] = { j: j, d2: d2 };
          best.sort((u, v) => u.d2 - v.d2);
        }
      }
      for (let item of best) {
        let key = min(i, item.j) * 10000 + max(i, item.j);
        if (seen.has(key)) continue;
        seen.add(key);
        linkPairs.push({ a: a, b: list[item.j], near: item.d2 < maxD2 * 0.25 });
      }
    }
  }

  blendMode(ADD);
  noFill();

  // Líneas lejanas: más tenues
  strokeWeight(1);
  stroke(110, 210, 255, 40 + 110 * audioLevel);
  beginShape(LINES);
  for (let pr of linkPairs) {
    if (pr.near) continue;
    vertex(pr.a.px, pr.a.py, pr.a.pz);
    vertex(pr.b.px, pr.b.py, pr.b.pz);
  }
  endShape();

  // Líneas cercanas: más brillantes y gruesas
  strokeWeight(1.8);
  stroke(170, 235, 255, 90 + 140 * audioLevel);
  beginShape(LINES);
  for (let pr of linkPairs) {
    if (!pr.near) continue;
    vertex(pr.a.px, pr.a.py, pr.a.pz);
    vertex(pr.b.px, pr.b.py, pr.b.pz);
  }
  endShape();

  blendMode(BLEND);
}

// Halo espectral: dos anillos 3D cuyos trazos dibujan el espectro de la voz
function drawSpectrumHalo() {
  if (!voiceActive() || !freqData || audioLevel < 0.03) return;
  const N = 96;
  let rot = frameCount * 0.3;

  blendMode(ADD);
  noFill();
  strokeWeight(2);
  for (let ring = 0; ring < 2; ring++) {
    push();
    if (ring === 1) rotateX(90);
    rotateY(rot * (ring ? -1 : 1));
    if (ring === 0) stroke(255, 150, 200, 210); else stroke(120, 220, 255, 210);
    let R = ring ? 300 : 380;
    beginShape(LINES);
    for (let i = 0; i < N; i++) {
      let a = i * 360 / N;
      let idx = i < N / 2 ? i : N - 1 - i; // espejo
      let bin = 1 + floor(idx * 2.2);
      let h = pow(freqData[bin] / 255, 1.5) * 260 * (0.4 + audioLevel);
      vertex(cos(a) * R, 0, sin(a) * R);
      vertex(cos(a) * (R + h), -h * 0.35, sin(a) * (R + h));
    }
    endShape();
    pop();
  }
  blendMode(BLEND);
}

// Chispas que salen disparadas de objetos al azar
function emitSparks() {
  if (!voiceActive() || audioLevel < 0.15) return;
  let n = floor(audioLevel * 7);
  for (let k = 0; k < n; k++) {
    let o = random(floatingObjects);
    let d = p5.Vector.random3D();
    let sp = random(6, 15);
    sparks.push({
      x: o.px, y: o.py, z: o.pz,
      vx: d.x * sp, vy: d.y * sp, vz: d.z * sp,
      life: 1
    });
  }
  while (sparks.length > 500) sparks.shift();
}

function drawSparks() {
  for (let i = sparks.length - 1; i >= 0; i--) {
    let s = sparks[i];
    s.x += s.vx; s.y += s.vy; s.z += s.vz;
    s.vx *= 0.95; s.vy *= 0.95; s.vz *= 0.95;
    s.life -= 0.04;
    if (s.life <= 0) sparks.splice(i, 1);
  }
  if (sparks.length === 0) return;

  blendMode(ADD);
  noFill();
  strokeWeight(1.5);
  stroke(255, 230, 150, 210);
  beginShape(LINES);
  for (let s of sparks) {
    vertex(s.x, s.y, s.z);
    vertex(s.x - s.vx * 2, s.y - s.vy * 2, s.z - s.vz * 2);
  }
  endShape();
  blendMode(BLEND);
}

// =====================================================
//  MOVIMIENTO: patrones guiados por el sonido
// =====================================================
function patternOffset(i, o, r0, ang, A) {
  let dx = o.x / r0, dy = o.y / r0, dz = o.z / r0;

  switch (i) {
    case 0: { // Ondas
      let w = sin(r0 * 0.35 - patT * 1.5);
      return [dx * w * 60 * A, w * 130 * A, dz * w * 60 * A];
    }
    case 1: { // Vórtice
      let th = vortexAngle * (500 / (r0 + 250));
      let c = cos(th), s = sin(th);
      return [
        o.x * c + o.z * s - o.x,
        sin(r0 * 0.2 + patT) * 40 * A,
        -o.x * s + o.z * c - o.z
      ];
    }
    case 2: { // Respiración radial
      let k = bassLevel * 300 + (sin(patT * 0.9) * 0.5 + 0.5) * 120 * A;
      return [dx * k, dy * k, dz * k];
    }
    case 3: { // Espiral helicoidal
      let a = ang * 3 + patT * 1.2;
      return [dx * cos(a) * 80 * A, sin(a) * 170 * A, dz * cos(a) * 80 * A];
    }
    case 4: { // Órbitas individuales
      let ph = patT * (1 + (floor(o.seed) % 3) * 0.5) + o.seed * 37;
      let rad = 50 + 170 * A;
      return [cos(ph) * rad, sin(ph * 0.8) * rad * 0.6, sin(ph) * rad];
    }
    default: { // Dispersión errática
      let amp = 280 * A;
      return [
        (noise(o.seed + 200, noiseT * 2) - 0.5) * 2 * amp,
        (noise(o.seed + 300, noiseT * 2) - 0.5) * 2 * amp,
        (noise(o.seed + 400, noiseT * 2) - 0.5) * 2 * amp
      ];
    }
  }
}

function updateMotion() {
  let chaos = CHAOS_LEVELS[chaosIdx];

  if (!voiceActive() && autoMode && millis() - lastAutoCycle > 9000) {
    lastAutoCycle = millis();
    currentPattern = (currentPattern + 1) % PATTERN_NAMES.length;
  }

  noiseT += 0.006 * (1 + audioLevel * 3) * chaos;
  patT += (2 + audioLevel * 10) * chaos;
  vortexAngle += (0.15 + audioLevel * 2.5) * chaos;

  for (let i = 0; i < patternW.length; i++) {
    patternW[i] = lerp(patternW[i], i === currentPattern ? 1 : 0, 0.03);
  }

  let A = (0.4 + audioLevel * 1.8) * chaos;
  let drift = (20 + audioLevel * 70) * chaos;

  for (let o of floatingObjects) {
    let r0 = max(1, sqrt(o.x * o.x + o.y * o.y + o.z * o.z));
    let ang = atan2(o.z, o.x);

    let ox = (noise(o.seed, noiseT) - 0.5) * 2 * drift;
    let oy = (noise(o.seed + 50, noiseT) - 0.5) * 2 * drift;
    let oz = (noise(o.seed + 100, noiseT) - 0.5) * 2 * drift;

    for (let i = 0; i < patternW.length; i++) {
      let w = patternW[i];
      if (w < 0.01) continue;
      let off = patternOffset(i, o, r0, ang, A);
      ox += off[0] * w;
      oy += off[1] * w;
      oz += off[2] * w;
    }

    for (let rp of ripples) {
      let dd = dist(o.x, o.y, o.z, rp.x, rp.y, rp.z);
      let band = abs(dd - rp.r);
      if (band < 140 && dd > 1) {
        let f = (1 - band / 140) * rp.str * 110;
        ox += ((o.x - rp.x) / dd) * f;
        oy += ((o.y - rp.y) / dd) * f;
        oz += ((o.z - rp.z) / dd) * f;
      }
    }

    o.px = o.x + ox;
    o.py = o.y + oy;
    o.pz = o.z + oz;
    refreshProjection(o);
  }
}

// =====================================================
//  CLIC / DOBLE CLIC / CREACIÓN
// =====================================================
function pickObject(px, py) {
  let mx = px - width / 2, my = py - height / 2;
  let best = null, bestDepth = Infinity;
  for (let o of floatingObjects) {
    if (o.depth <= 0) continue;
    let hitR = o.size * o.sc * 1.6;
    if (dist(mx, my, o.sx, o.sy) < hitR && o.depth < bestDepth) {
      best = o;
      bestDepth = o.depth;
    }
  }
  return best;
}

function handleClick(px, py) {
  let hit = pickObject(px, py);
  if (hit) {
    triggerObject(hit);
    lastEmptyClickTime = 0;
    return;
  }

  let now = millis();
  let near = dist(px, py, lastEmptyClickX, lastEmptyClickY) < 30;
  if (now - lastEmptyClickTime < 350 && near) {
    spawnObjectAt(px, py);
    lastEmptyClickTime = 0;
  } else {
    lastEmptyClickTime = now;
    lastEmptyClickX = px;
    lastEmptyClickY = py;
  }
}

function addObject(o) {
  floatingObjects.push(o);
  if (floatingObjects.length > MAX_OBJECTS) floatingObjects.shift();
}

function spawnObjectAt(px, py) {
  let w = unproject(px - width / 2, py - height / 2, 600);
  let o = makeObject(w.x, w.y, w.z);
  o.size = random(38, 60);
  addObject(o);
  triggerObject(o, true);
}

function spawnRandomObject() {
  let a = random(0, 360), b = random(-60, 60), d = random(300, 1300);
  let o = makeObject(
    d * cos(a) * cos(b),
    d * sin(b),
    d * sin(a) * cos(b)
  );
  addObject(o);
  triggerObject(o, true, 0.5);
}

// Mutación suave (sin onda ni partículas): la usa la voz
function mutateLight(o) {
  let t = floor(random(NUM_TYPES));
  if (t === o.type) t = (t + 1) % NUM_TYPES;
  o.type = t;
  o.morph = 0;
  o.pulseEnergy = 0.6;
  o.shockwave = 0;
  o.spin = 0.8;
  o.activeColor = color(random(150, 255), random(100, 255), random(150, 255));
  o.color = color(random(100, 255), random(100, 255), random(150, 255));
}

function triggerObject(obj, isNew = false, rippleStrength = 1.0) {
  if (!isNew) obj.type = (obj.type + 1) % NUM_TYPES;
  obj.morph = 0;
  obj.pulseEnergy = 1.0;
  obj.shockwave = 0;
  obj.spin = 1.0;
  obj.activeColor = color(random(150, 255), random(100, 255), random(150, 255));
  obj.color = color(random(100, 255), random(100, 255), random(150, 255));

  addRipple(obj.px, obj.py, obj.pz, rippleStrength);

  for (let i = 0; i < 36; i++) {
    let d = p5.Vector.random3D();
    let sp = random(3, 9);
    particles.push({
      x: obj.px, y: obj.py, z: obj.pz,
      vx: d.x * sp, vy: d.y * sp, vz: d.z * sp,
      life: 1, decay: random(0.012, 0.03),
      s: random(2, 5), col: obj.activeColor
    });
  }
}

// =====================================================
//  DRAW
// =====================================================
function draw() {
  background(6, 7, 12);

  updateAudio();
  updateRipples();

  // Deriva de cámara con la voz (solo si no estás arrastrando)
  if (voiceActive() && !dragging) {
    targetCamYaw += audioLevel * 0.35 * CHAOS_LEVELS[chaosIdx];
  }

  camYaw = lerp(camYaw, targetCamYaw, 0.1);
  camPitch = lerp(camPitch, targetCamPitch, 0.1);
  zoomDistance = lerp(zoomDistance, targetZoom, 0.08);

  let shake = audioLevel * 6;
  translate(random(-shake, shake), random(-shake, shake), -zoomDistance + 500);
  rotateX(camPitch);
  rotateY(camYaw);

  ambientLight(40, 45, 65);
  pointLight(255, 230, 250, 0, 0, 0);
  directionalLight(120, 200, 255, 0.5, 1, -1);

  updateMotion();

  for (let o of floatingObjects) o.hover = false;
  let hovered = pickObject(mouseX, mouseY);
  if (hovered) hovered.hover = true;

  emitSparks();

  let visible = [];

  for (let obj of floatingObjects) {
    // --- estado (siempre se actualiza, aunque no se dibuje) ---
    if (obj.pulseEnergy > 0.01) {
      obj.pulseEnergy = lerp(obj.pulseEnergy, 0, 0.05);
      obj.shockwave += 4;
    } else {
      obj.pulseEnergy = 0;
    }
    obj.spin = lerp(obj.spin, 0, 0.04);
    if (obj.morph < 1) obj.morph = min(1, obj.morph + 0.025);

    let speed = obj.rotSpeed + (obj.hover ? 1.5 : 0) + obj.spin * 14
              + audioLevel * 10 * CHAOS_LEVELS[chaosIdx];
    obj.rotX += speed;
    obj.rotY += speed * 0.8;

    // --- culling: fuera de cámara o de pantalla ---
    let rpx = obj.size * obj.sc * 2.2;
    if (obj.depth <= 0 || abs(obj.sx) > width / 2 + rpx || abs(obj.sy) > height / 2 + rpx) continue;
    visible.push(obj);

    let m = obj.morph < 1 ? easeOutElastic(obj.morph) : 1;
    let s = (1.0 + (obj.hover ? 0.3 : 0) + obj.pulseEnergy * 0.25 + bassLevel * 0.35) * m;

    push();
    translate(obj.px, obj.py, obj.pz);
    scale(max(s, 0.001));

    // --- LOD: los objetos lejanos/chicos se dibujan simples ---
    if (rpx < 26 && obj.pulseEnergy < 0.05 && !obj.hover) {
      noStroke();
      fill(lerpColor(obj.color, color(255, 190, 220), audioLevel * 0.6));
      sphere(obj.size * 0.55, 5, 4);
      pop();
      continue;
    }

    // Anillos de pulso (miran a la cámara)
    if (obj.pulseEnergy > 0.03) {
      push();
      rotateY(-camYaw);
      rotateX(-camPitch);
      noStroke();
      let c = obj.activeColor;
      fill(red(c), green(c), blue(c), 220 * obj.pulseEnergy);
      torus(obj.size * (0.9 + obj.shockwave * 0.05), 1.5 + 3 * obj.pulseEnergy, 40, 6);
      fill(255, 255, 255, 160 * obj.pulseEnergy);
      torus(obj.size * (0.5 + obj.shockwave * 0.03), 1 + 2 * obj.pulseEnergy, 32, 6);
      pop();
    }

    // Halo orbital activado por la voz: más objetos lo tienen si hablás más fuerte
    if (voiceActive() && fract(obj.seed * 0.618) < audioLevel * 1.3) {
      push();
      rotateX(obj.seed * 10 + frameCount * 2);
      rotateZ(obj.seed * 7);
      noStroke();
      fill(255, 220, 120, 170);
      torus(obj.size * (1.3 + 0.25 * sin(frameCount * 4 + obj.seed) + bassLevel * 0.4), 1.2, 28, 5);
      pop();
    }

    if (obj.pulseEnergy > 0.1) {
      stroke(255, 255, 200);
      strokeWeight(1.5);
      fill(lerpColor(obj.color, obj.activeColor, obj.pulseEnergy));
    } else if (obj.hover) {
      stroke(255, 220, 80);
      strokeWeight(1.5);
      fill(255, 50, 120, 240);
    } else {
      stroke(20, 20, 35, 150);
      strokeWeight(1.0);
      fill(lerpColor(obj.color, color(255, 190, 220), audioLevel * 0.6));
    }

    rotateX(obj.rotX);
    rotateY(obj.rotY);
    switch (obj.type) {
      case 0: drawCrystalBurst(obj.size); break;
      case 1: drawOrbitalLattice(obj.size); break;
      case 2: drawTwistTower(obj.size); break;
      case 3: drawBlobCluster(obj.size); break;
      case 4: drawShardCloud(obj.size); break;
      case 5: drawPetalBloom(obj.size); break;
      default: drawConstellation(obj.size);
    }
    pop();
  }

  visibleCount = visible.length;

  drawDust();
  drawLinks(visible);
  drawSpectrumHalo();
  drawSparks();
  drawParticles();
  drawRipples();

  cursor(dragging ? 'grabbing' : (hovered ? HAND : CROSS));

  hudDiv.html(
    'objetos: ' + floatingObjects.length + '/' + MAX_OBJECTS +
    ' (visibles ' + visibleCount + ')' +
    ' &nbsp;|&nbsp; caos [E]: ' + CHAOS_NAMES[chaosIdx] +
    '<br>patrón: ' + PATTERN_NAMES[currentPattern] +
    ' (' + (autoMode ? 'auto' : 'manual') + ')' +
    (demoMode && !micOn ? ' &nbsp;|&nbsp; DEMO de voz' : '') +
    '<br>doble clic en vacío = crear &nbsp;|&nbsp; M = mic &nbsp;|&nbsp; D = demo &nbsp;|&nbsp; 1-6 = patrón &nbsp;|&nbsp; A = auto'
  );
}

function drawParticles() {
  noStroke();
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.x += p.vx; p.y += p.vy; p.z += p.vz;
    p.vx *= 0.96; p.vy *= 0.96; p.vz *= 0.96;
    p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    push();
    translate(p.x, p.y, p.z);
    fill(red(p.col), green(p.col), blue(p.col), 255 * p.life);
    sphere(p.s * p.life + 0.5, 5, 4);
    pop();
  }
}

// =====================================================
//  FORMAS ABSTRACTAS
// =====================================================
function drawCrystalBurst(sz) {
  sphere(sz * 0.3, 5, 4);
  for (let i = 0; i < SPIKES.length; i++) {
    let d = SPIKES[i];
    let len = sz * (0.9 + 0.25 * sin(frameCount * 2 + i * 50) + bassLevel * 0.5);
    push();
    rotateY(atan2(d.x, d.z));
    rotateX(-asin(d.y));
    translate(0, 0, len * 0.5);
    ellipsoid(sz * 0.1, sz * 0.1, len * 0.5, 5, 3);
    pop();
  }
}

function drawOrbitalLattice(sz) {
  let R = sz * 0.9;
  for (let i = 0; i < 3; i++) {
    push();
    rotateX(i * 60 + frameCount * 0.6);
    rotateY(i * 45);
    noFill();
    torus(R, sz * 0.04, 24, 5);
    let a = frameCount * (2 + i) + i * 120;
    translate(R * cos(a), R * sin(a), 0);
    fill(255, 200, 120);
    sphere(sz * 0.14, 8, 6);
    pop();
  }
  sphere(sz * 0.22, 8, 6);
}

function drawTwistTower(sz) {
  let n = 9;
  for (let i = 0; i < n; i++) {
    push();
    let k = abs(i - (n - 1) / 2);
    translate(0, (i - (n - 1) / 2) * sz * 0.22, 0);
    rotateY(i * (28 + audioLevel * 40) + frameCount * 1.2);
    box(sz * (1.1 - k * 0.14), sz * 0.09, sz * 0.32);
    pop();
  }
}

function drawBlobCluster(sz) {
  sphere(sz * 0.4, 12, 10);
  for (let i = 0; i < 6; i++) {
    let a = frameCount * (1 + i * 0.3) + i * 60;
    push();
    translate(
      cos(a) * sz * 0.55,
      sin(a * 0.7 + i * 40) * sz * 0.55,
      sin(a) * sz * 0.55
    );
    sphere(sz * (0.26 + 0.08 * sin(frameCount * 3 + i * 70) + audioLevel * 0.1), 10, 8);
    pop();
  }
}

function drawShardCloud(sz) {
  for (let i = 0; i < SPIKES.length - 4; i++) {
    let d = SPIKES[i];
    let r = sz * (0.9 + 0.2 * sin(frameCount * 2 + i * 40) + audioLevel * 0.4);
    push();
    translate(d.x * r, d.y * r, d.z * r);
    rotateX(frameCount * 2 + i * 30);
    rotateZ(frameCount * 1.5 + i * 20);
    cone(sz * 0.16, sz * 0.42, 3, 1);
    pop();
  }
}

// 5 - Flor de pétalos que se abre y cierra (más con la voz)
function drawPetalBloom(sz) {
  sphere(sz * 0.14, 6, 5);
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 8; i++) {
      push();
      rotateY(i * 45 + ring * 22 + frameCount * (ring ? -1 : 1));
      rotateZ(35 + 40 * sin(frameCount * 2 + ring * 90) + audioLevel * 50);
      translate(0, -sz * 0.4 * (1 + ring * 0.35), 0);
      ellipsoid(sz * 0.12, sz * 0.4 * (1 + ring * 0.35), sz * 0.05, 6, 4);
      pop();
    }
  }
}

// 6 - Constelación: nodos unidos por líneas que respiran
function drawConstellation(sz) {
  let pts = [];
  for (let i = 0; i < 7; i++) {
    let d = SPIKES[i * 2];
    let r = sz * (0.8 + 0.3 * sin(frameCount * 2 + i * 60) + audioLevel * 0.3);
    pts.push([d.x * r, d.y * r, d.z * r]);
  }
  for (let p of pts) {
    push();
    translate(p[0], p[1], p[2]);
    sphere(sz * 0.1, 6, 5);
    pop();
  }
  strokeWeight(1.2);
  beginShape(LINES);
  for (let i = 0; i < 7; i++) {
    let a = pts[i], b = pts[(i + 1) % 7];
    vertex(0, 0, 0); vertex(a[0], a[1], a[2]);
    vertex(a[0], a[1], a[2]); vertex(b[0], b[1], b[2]);
  }
  endShape();
}

// =====================================================
//  UTILIDADES
// =====================================================
function fibonacciSphere(n) {
  let pts = [];
  let golden = 180 * (3 - sqrt(5));
  for (let i = 0; i < n; i++) {
    let y = 1 - (i / (n - 1)) * 2;
    let r = sqrt(1 - y * y);
    let th = golden * i;
    pts.push({ x: cos(th) * r, y: y, z: sin(th) * r });
  }
  return pts;
}

function easeOutElastic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return pow(2, -10 * t) * sin((t * 10 - 0.75) * 120) + 1;
}

// Mundo -> pantalla (replica la cámara por defecto de p5 WEBGL)
function project(x, y, z) {
  let cy = cos(camYaw), sy = sin(camYaw);
  let x1 = x * cy + z * sy;
  let z1 = -x * sy + z * cy;

  let cp = cos(camPitch), sp = sin(camPitch);
  let y2 = y * cp - z1 * sp;
  let z2 = y * sp + z1 * cp;

  z2 += -zoomDistance + 500;

  let camZ = (height / 2) / tan(30);
  let depth = camZ - z2;
  let sc = camZ / depth;

  return { x: x1 * sc, y: y2 * sc, depth: depth, scale: sc };
}

// Pantalla -> mundo: punto del rayo del cursor a "depth" de la cámara
function unproject(mx, my, depth) {
  let camZ = (height / 2) / tan(30);

  let x1 = mx * depth / camZ;
  let y2 = my * depth / camZ;
  let z2 = camZ - depth;

  z2 -= (-zoomDistance + 500);

  let cp = cos(camPitch), sp = sin(camPitch);
  let y = y2 * cp + z2 * sp;
  let z1 = -y2 * sp + z2 * cp;

  let cy = cos(camYaw), sy = sin(camYaw);
  let x = x1 * cy - z1 * sy;
  let z = x1 * sy + z1 * cy;

  return { x, y, z };
}
// --- NUEVAS VARIABLES DE MÚSICA GRATUITA ---
let genreSelect, playMusicBtn;
let currentSongAudio = null;

// Lista de pistas gratuitas con URL directa en MP3
const FREE_TRACKS = [
  { name: "Electronic / Synthwave", url: "https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3" },
  { name: "Chillhop / Lo-Fi", url: "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3" },
  { name: "Ambient / Cosmos", url: "https://cdn.pixabay.com/download/audio/2021/09/06/audio_84de79a022.mp3" },
  { name: "Rock / Uptempo", url: "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3" }
];

function setupGenreSelector() {
  // Menú selector
  genreSelect = createSelect();
  genreSelect.position(16, 120);
  genreSelect.style('padding', '6px');
  genreSelect.style('border-radius', '6px');
  genreSelect.style('background', '#151830');
  genreSelect.style('color', '#fff');
  genreSelect.style('border', '1px solid #6a6f9a');

  for (let track of FREE_TRACKS) {
    genreSelect.option(track.name, track.url);
  }

  // Botón para reproducir / pausar
  playMusicBtn = createButton('▶ Reproducir Género');
  playMusicBtn.position(200, 120);
  playMusicBtn.style('padding', '6px 12px');
  playMusicBtn.style('border-radius', '6px');
  playMusicBtn.style('background', '#2d1c4d');
  playMusicBtn.style('color', '#fff');
  playMusicBtn.style('border', '1px solid #7fe0ff');
  playMusicBtn.style('cursor', 'pointer');
  playMusicBtn.mousePressed(playSelectedGenre);
}

function playSelectedGenre() {
  let url = genreSelect.value();

  // Si ya hay un audio sonando, lo detenemos
  if (currentSongAudio) {
    currentSongAudio.pause();
  }

  // Crear nuevo elemento de audio HTML5
  currentSongAudio = new Audio(url);
  currentSongAudio.crossOrigin = "anonymous";

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  let src = audioCtx.createMediaElementSource(currentSongAudio);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;

  // Conectar al analizador de frecuencias Y a las bocinas
  src.connect(analyser);
  analyser.connect(audioCtx.destination);

  freqData = new Uint8Array(analyser.frequencyBinCount);
  micOn = true; // Activa la reactividad en el loop draw()
  
  currentSongAudio.play();
  playMusicBtn.html('⏸ Pausar Música');
}