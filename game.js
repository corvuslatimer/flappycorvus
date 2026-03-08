import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

// ── Config ─────────────────────────────────────────────────────────────────
const CFG = {
  gravity:       -20,
  flapVel:        8.5,
  pipeSpeed:      5.2,     // starting speed
  pipeSpeedMax:   9.5,
  pipeSpeedGain:  0.12,    // per pipe passed
  pipeGap:        3.0,
  pipeInterval:   2.3,     // seconds
  pipeIntervalMin:1.5,
  pipeIntervalDec:0.015,   // per pipe passed
  birdX:         -3,
  pipeXStart:     9,
  pipeW:          1.1,
  floorY:        -5.2,
  ceilY:          5.2,
};

// ── Renderer ───────────────────────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x080c12);
scene.fog = new THREE.FogExp2(0x080c12, 0.022);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
camera.position.set(0, 0, 15);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ── Lighting ───────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x223355, 1.5));
const key = new THREE.DirectionalLight(0x99bbff, 2.8);
key.position.set(6, 12, 10);
key.castShadow = true;
scene.add(key);
const rim = new THREE.PointLight(0x4466ff, 2.0, 22);
rim.position.set(-8, 4, 6);
scene.add(rim);
const glow = new THREE.PointLight(0xff9944, 1.2, 14);
glow.position.set(CFG.birdX, 0, 3);
scene.add(glow); // follows bird loosely

// ── Stars ──────────────────────────────────────────────────────────────────
{
  const geo = new THREE.BufferGeometry();
  const v = [];
  for (let i = 0; i < 1200; i++)
    v.push((Math.random()-0.5)*80, (Math.random()-0.5)*25, -(Math.random()*12+3));
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.055, transparent: true, opacity: 0.7 })));
}

// ── Floor / Ceiling Slabs ──────────────────────────────────────────────────
function makeSlab(y) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(120, 0.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x0f1b2d, roughness: 0.9, metalness: 0.3 })
  );
  m.position.set(0, y, 0);
  m.receiveShadow = true;
  scene.add(m);
}
makeSlab(CFG.floorY - 0.25);
makeSlab(CFG.ceilY  + 0.25);

// ── Pipes ──────────────────────────────────────────────────────────────────
const PIPE_MAT = new THREE.MeshStandardMaterial({
  color: 0x1a3050, roughness: 0.5, metalness: 0.6
});
const PIPE_H = 14;
const pipePool = [];
const activePipes = [];

function getPipeMesh() {
  if (pipePool.length) return pipePool.pop();
  const m = new THREE.Mesh(new THREE.BoxGeometry(CFG.pipeW, PIPE_H, 1.8), PIPE_MAT);
  m.castShadow = true;
  return m;
}

function releasePipe(p) {
  scene.remove(p.top, p.bot);
  pipePool.push(p.top, p.bot);
  const idx = activePipes.indexOf(p);
  if (idx !== -1) activePipes.splice(idx, 1);
}

function spawnPipe() {
  const range   = (CFG.ceilY - CFG.floorY) - CFG.pipeGap - 2.5;
  const mid     = (CFG.ceilY + CFG.floorY) / 2;
  const gapY    = mid + (Math.random() - 0.5) * range;
  const top     = getPipeMesh();
  const bot     = getPipeMesh();
  top.position.set(CFG.pipeXStart, gapY + CFG.pipeGap / 2 + PIPE_H / 2, 0);
  bot.position.set(CFG.pipeXStart, gapY - CFG.pipeGap / 2 - PIPE_H / 2, 0);
  scene.add(top, bot);
  activePipes.push({ top, bot, x: CFG.pipeXStart, gapY, passed: false });
}

// ── Bird ───────────────────────────────────────────────────────────────────
const birdGroup = new THREE.Group();
birdGroup.position.set(CFG.birdX, 0, 0);
scene.add(birdGroup);

// Fallback mesh shown until GLB loads
const fallback = new THREE.Mesh(
  new THREE.SphereGeometry(0.38, 8, 6),
  new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.4 })
);
birdGroup.add(fallback);

let birdModel = null;
const gltfLoader = new GLTFLoader();
gltfLoader.load('./assets/Bird_1_by_get3dmodels.glb', (gltf) => {
  birdModel = gltf.scene;
  birdModel.scale.setScalar(0.012);
  birdModel.rotation.y = -Math.PI / 2;
  birdModel.rotation.x = 0;
  birdModel.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  birdGroup.add(birdModel);
  birdGroup.remove(fallback);
});



// ── Score persistence ──────────────────────────────────────────────────────
let highScore = parseInt(localStorage.getItem('fc_hs') || '0', 10);

function saveHS(s) {
  if (s > highScore) {
    highScore = s;
    localStorage.setItem('fc_hs', s);
  }
}

// ── State ──────────────────────────────────────────────────────────────────
let state      = 'idle'; // idle | playing | dead
let velY       = 0;
let score      = 0;
let pipeTimer  = 0;
let currentSpeed    = CFG.pipeSpeed;
let currentInterval = CFG.pipeInterval;


const overlay = document.getElementById('overlay');
const scoreEl = document.getElementById('score');

function showIdle() {
  overlay.innerHTML = `
    <h1>🐦‍⬛ Flappy Corvus</h1>
    <div class="sub">tap or press space to flap</div>
    ${highScore > 0 ? `<div class="sub" style="color:#e0c97f">best: ${highScore}</div>` : ''}
    <div class="prompt">tap / space to start</div>
  `;
  overlay.style.display = 'flex';
}

function showDead() {
  const isNew = score > 0 && score >= highScore;
  overlay.innerHTML = `
    <h1>🐦‍⬛ Flappy Corvus</h1>
    <div class="final-score">score: ${score}</div>
    ${isNew ? '<div class="sub" style="color:#e0c97f">✨ new best!</div>' : `<div class="sub">best: ${highScore}</div>`}
    <div class="sub">you got wiped</div>
    <div class="prompt">tap / space to try again</div>
  `;
  overlay.style.display = 'flex';
}

function resetGame() {
  // clear pipes
  [...activePipes].forEach(releasePipe);
  activePipes.length = 0;

  birdGroup.position.set(CFG.birdX, 0, 0);
  birdGroup.rotation.z = 0;
  velY            = 0;
  score           = 0;
  pipeTimer       = 0;
  currentSpeed    = CFG.pipeSpeed;
  currentInterval = CFG.pipeInterval;

  overlay.style.display = 'none';
  scoreEl.style.display = 'block';
  scoreEl.textContent   = '0';
  state = 'playing';
}

function flap() {
  if (state === 'idle' || state === 'dead') { resetGame(); return; }
  if (state === 'playing') {
    velY = CFG.flapVel;
  }
}

function die() {
  state = 'dead';
  saveHS(score);
  scoreEl.style.display = 'none';
  showDead();
}

// ── Input ──────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); flap(); }
});
window.addEventListener('pointerdown', e => {
  // ignore clicks on overlay buttons etc
  flap();
});

// ── Collision ──────────────────────────────────────────────────────────────
function checkCollision() {
  const by = birdGroup.position.y;
  const bx = CFG.birdX;
  const br = 0.30;

  if (by - br <= CFG.floorY || by + br >= CFG.ceilY) return true;

  for (const p of activePipes) {
    if (Math.abs(bx - p.x) < CFG.pipeW / 2 + br) {
      if (by > p.gapY + CFG.pipeGap / 2 - br || by < p.gapY - CFG.pipeGap / 2 + br) return true;
    }
  }
  return false;
}

// ── Clock ──────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

// ── Render loop ────────────────────────────────────────────────────────────
showIdle();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state === 'playing') {
    // Physics
    velY += CFG.gravity * dt;
    birdGroup.position.y += velY * dt;

    // Tilt
    const targetZ = THREE.MathUtils.clamp(velY * 0.065, -0.9, 0.5);
    birdGroup.rotation.z += (targetZ - birdGroup.rotation.z) * 18 * dt;

    // Glow follows bird
    glow.position.set(CFG.birdX, birdGroup.position.y, 3);
    glow.intensity = 1.2 + Math.sin(Date.now() * 0.005) * 0.3;

    // Pipes
    pipeTimer += dt;
    if (pipeTimer >= currentInterval) {
      spawnPipe();
      pipeTimer = 0;
    }

    for (let i = activePipes.length - 1; i >= 0; i--) {
      const p = activePipes[i];
      p.x -= currentSpeed * dt;
      p.top.position.x = p.x;
      p.bot.position.x = p.x;

      if (!p.passed && p.x < CFG.birdX) {
        p.passed = true;
        score++;
        scoreEl.textContent = score;
        // Increase difficulty
        currentSpeed    = Math.min(CFG.pipeSpeedMax, currentSpeed + CFG.pipeSpeedGain);
        currentInterval = Math.max(CFG.pipeIntervalMin, currentInterval - CFG.pipeIntervalDec);
      }

      if (p.x < -13) releasePipe(p);
    }

    if (checkCollision()) die();
  }

  // Idle bob
  if (state === 'idle') {
    birdGroup.position.y = Math.sin(Date.now() * 0.0018) * 0.6;
    birdGroup.rotation.z = Math.sin(Date.now() * 0.0025) * 0.08;
  }

  renderer.render(scene, camera);
}

animate();
