import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';

// ── Constants ──────────────────────────────────────────────────────────────
const GRAVITY      = -18;
const FLAP_VEL     =  8;
const PIPE_SPEED   =  5;
const PIPE_GAP     =  3.2;
const PIPE_INTERVAL = 2.4; // seconds between pipes
const BIRD_X       = -3;
const PIPE_X_START =  8;
const PIPE_W       =  1.1;
const FLOOR_Y      = -5;
const CEIL_Y       =  5;

// ── Scene Setup ────────────────────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 18, 35);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 0, 14);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ── Lighting ───────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x334466, 1.2));
const sun = new THREE.DirectionalLight(0x88aaff, 2.5);
sun.position.set(5, 10, 8);
sun.castShadow = true;
scene.add(sun);
const rimLight = new THREE.PointLight(0x4488ff, 1.5, 20);
rimLight.position.set(-6, 3, 5);
scene.add(rimLight);

// ── Scrolling Background Stars ─────────────────────────────────────────────
const starGeo = new THREE.BufferGeometry();
const starVerts = [];
for (let i = 0; i < 800; i++) {
  starVerts.push((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 10 - 5);
}
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 })));

// ── Ground / Ceiling ───────────────────────────────────────────────────────
function makeSlab(y, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(100, 0.4, 4),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
  );
  mesh.position.set(0, y, 0);
  scene.add(mesh);
}
makeSlab(FLOOR_Y - 0.2, 0x1a2233);
makeSlab(CEIL_Y + 0.2, 0x1a2233);

// ── Pipe Pool ──────────────────────────────────────────────────────────────
const PIPE_MAT = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.6, metalness: 0.4 });
const PIPE_HEIGHT = 12;

function makePipeMesh() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(PIPE_W, PIPE_HEIGHT, 1.5), PIPE_MAT);
  m.castShadow = true;
  return m;
}

const pipes = []; // { top, bot, x, passed }

function spawnPipe() {
  const gapCenter = (Math.random() - 0.5) * (CEIL_Y - FLOOR_Y - PIPE_GAP - 2) + (FLOOR_Y + CEIL_Y) / 2;
  const top = makePipeMesh();
  const bot = makePipeMesh();
  top.position.set(PIPE_X_START, gapCenter + PIPE_GAP / 2 + PIPE_HEIGHT / 2, 0);
  bot.position.set(PIPE_X_START, gapCenter - PIPE_GAP / 2 - PIPE_HEIGHT / 2, 0);
  scene.add(top, bot);
  pipes.push({ top, bot, x: PIPE_X_START, passed: false });
}

function removePipe(p) {
  scene.remove(p.top, p.bot);
  p.top.geometry.dispose();
  p.bot.geometry.dispose();
}

// ── Bird ───────────────────────────────────────────────────────────────────
let bird = null;         // GLB group
let birdFallback = null; // fallback box if GLB fails

const birdGroup = new THREE.Group();
birdGroup.position.set(BIRD_X, 0, 0);
scene.add(birdGroup);

const loader = new GLTFLoader();
loader.load(
  './assets/Bird_1_by_get3dmodels.glb',
  (gltf) => {
    bird = gltf.scene;
    // Scale and orient — raven model faces +Z by default
    bird.scale.set(0.6, 0.6, 0.6);
    bird.rotation.y = Math.PI;
    birdGroup.add(bird);
  },
  undefined,
  () => {
    // Fallback: simple black box
    birdFallback = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    birdGroup.add(birdFallback);
  }
);

// ── Particle burst on flap ─────────────────────────────────────────────────
const particles = [];
const PART_MAT = new THREE.PointsMaterial({ color: 0x8899ff, size: 0.12, transparent: true });

function spawnParticles() {
  const geo = new THREE.BufferGeometry();
  const verts = [];
  for (let i = 0; i < 12; i++) {
    verts.push(BIRD_X + (Math.random() - 0.5) * 0.6,
               birdGroup.position.y + (Math.random() - 0.5) * 0.6,
               (Math.random() - 0.5) * 0.4);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const pts = new THREE.Points(geo, PART_MAT.clone());
  pts.userData.life = 0.4;
  scene.add(pts);
  particles.push(pts);
}

// ── State ──────────────────────────────────────────────────────────────────
let state = 'idle'; // idle | playing | dead
let velY = 0;
let score = 0;
let pipeTimer = 0;
let clock = new THREE.Clock();

const overlay    = document.getElementById('overlay');
const scoreEl    = document.getElementById('score');

function startGame() {
  if (state === 'playing') return;
  state = 'playing';
  velY = 0;
  birdGroup.position.y = 0;
  birdGroup.rotation.z = 0;
  score = 0;
  pipeTimer = 0;
  // Clear existing pipes
  pipes.forEach(removePipe);
  pipes.length = 0;
  // Hide overlay
  overlay.style.display = 'none';
  scoreEl.style.display = 'block';
  scoreEl.textContent = '0';
  clock.start();
}

function flap() {
  if (state === 'idle' || state === 'dead') { startGame(); return; }
  velY = FLAP_VEL;
  spawnParticles();
}

function die() {
  state = 'dead';
  scoreEl.style.display = 'none';
  overlay.innerHTML = `
    <h1>🐦‍⬛ Flappy Corvus</h1>
    <div class="final-score">Score: ${score}</div>
    <div class="sub">you got wiped</div>
    <div class="prompt">tap / space to try again</div>
  `;
  overlay.style.display = 'flex';
}

// ── Input ──────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); flap(); } });
window.addEventListener('pointerdown', flap);

// ── Collision (AABB) ───────────────────────────────────────────────────────
function checkCollision() {
  const by = birdGroup.position.y;
  const bx = BIRD_X;
  const br = 0.32; // bird radius

  if (by - br <= FLOOR_Y || by + br >= CEIL_Y) return true;

  for (const p of pipes) {
    if (Math.abs(bx - p.x) < PIPE_W / 2 + br) {
      const gapCenter = p.top.position.y - PIPE_HEIGHT / 2 - PIPE_GAP / 2;
      if (by > gapCenter + PIPE_GAP / 2 - br || by < gapCenter - PIPE_GAP / 2 + br) return true;
    }
  }
  return false;
}

// ── Main Loop ──────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state === 'playing') {
    // Physics
    velY += GRAVITY * dt;
    birdGroup.position.y += velY * dt;

    // Tilt bird
    const tilt = THREE.MathUtils.clamp(velY * 0.06, -0.8, 0.4);
    birdGroup.rotation.z = tilt;

    // Pipes
    pipeTimer += dt;
    if (pipeTimer >= PIPE_INTERVAL) { spawnPipe(); pipeTimer = 0; }

    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= PIPE_SPEED * dt;
      p.top.position.x = p.x;
      p.bot.position.x = p.x;

      if (!p.passed && p.x < BIRD_X) {
        p.passed = true;
        score++;
        scoreEl.textContent = score;
        // Gradually increase speed
        // PIPE_SPEED handled via closure below
      }

      if (p.x < -12) { removePipe(p); pipes.splice(i, 1); }
    }

    if (checkCollision()) die();
  }

  // Idle bob
  if (state === 'idle') {
    birdGroup.position.y = Math.sin(Date.now() * 0.002) * 0.5;
  }

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt;
    p.material.opacity = p.userData.life / 0.4;
    if (p.userData.life <= 0) { scene.remove(p); p.geometry.dispose(); particles.splice(i, 1); }
  }

  renderer.render(scene, camera);
}

animate();
