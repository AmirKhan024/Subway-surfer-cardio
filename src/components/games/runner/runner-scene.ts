/**
 * Kriya Runner L1 — Three.js FPP world. DUMB VISUALIZER ONLY.
 *
 * Reads RunnerSceneState every frame and positions meshes; it never decides
 * collision, cues, or score (all of that is RunnerEngine's job).
 *
 * Perf budget (mid-range phone): Lambert/Basic materials only, no shadows,
 * pooled + recycled props, fog culls the draw distance, pixelRatio <= 2.
 *
 * Art seam: all mesh creation lives in the make*() factories at the bottom
 * so CC0 GLTF models can replace procedural meshes later without touching
 * pooling/positioning logic.
 */
import * as THREE from 'three';
import type {
  RunnerSceneState,
  SceneObstacle,
  SceneCoin,
} from '@/modules/game/engines/runner-engine';
import { COIN } from './runner-constants';

const HORIZON = 0xcfe8ff;
const FOG_NEAR = 30;
const FOG_FAR = 95;
const LOOP_LEN = 200; // prop recycling loop, meters
const ROAD_W = 8;

export class RunnerScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private road!: THREE.Mesh;
  private roadTex!: THREE.CanvasTexture;
  private clouds: THREE.Mesh[] = [];
  private props: { mesh: THREE.Object3D; baseZ: number }[] = [];
  private obstacleMeshes = new Map<number, THREE.Object3D>();
  private coinMeshes = new Map<number, THREE.Object3D>();
  /** collect-pop animations: coin id → pop start (ms) */
  private coinPops = new Map<number, number>();
  private hitFlash!: THREE.Mesh;
  private lastFov = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(HORIZON);
    this.scene.fog = new THREE.Fog(HORIZON, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(65, w / h, 0.1, 160);
    this.camera.position.set(0, 1.6, 0);

    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xbfd8ff, 1.4));

    this.buildWorld();
  }

  // ── world construction ────────────────────────────────────────────────

  private buildWorld(): void {
    // sky sun disc
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(6, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }),
    );
    sunDisc.position.set(25, 40, -140);
    this.scene.add(sunDisc);

    // clouds
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      fog: false,
    });
    for (let i = 0; i < 6; i++) {
      const cloud = new THREE.Mesh(new THREE.SphereGeometry(4 + (i % 3) * 2, 8, 6), cloudMat);
      cloud.scale.set(2.2, 0.6, 1);
      cloud.position.set(-50 + i * 22, 26 + (i % 2) * 8, -120 - (i % 3) * 10);
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }

    // road (UV-scrolled canvas texture — cheapest possible scroll)
    this.roadTex = makeRoadTexture();
    this.roadTex.wrapS = THREE.RepeatWrapping;
    this.roadTex.wrapT = THREE.RepeatWrapping;
    this.roadTex.repeat.set(1, 24);
    this.road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, LOOP_LEN),
      new THREE.MeshLambertMaterial({ map: this.roadTex }),
    );
    this.road.rotation.x = -Math.PI / 2;
    this.road.position.set(0, 0, -LOOP_LEN / 2 + 10);
    this.scene.add(this.road);

    // sidewalks + verges
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(
        new THREE.PlaneGeometry(3, LOOP_LEN),
        new THREE.MeshLambertMaterial({ color: 0xb8bec9 }),
      );
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(side * (ROAD_W / 2 + 1.5), 0.02, -LOOP_LEN / 2 + 10);
      this.scene.add(walk);

      const verge = new THREE.Mesh(
        new THREE.PlaneGeometry(40, LOOP_LEN),
        new THREE.MeshLambertMaterial({ color: 0x7ec850 }),
      );
      verge.rotation.x = -Math.PI / 2;
      verge.position.set(side * (ROAD_W / 2 + 3 + 20), -0.01, -LOOP_LEN / 2 + 10);
      this.scene.add(verge);
    }

    // recycled roadside props: buildings, trees, lamps
    const windowTexA = makeWindowTexture(0x3a4a63, 0xffe9a8);
    const windowTexB = makeWindowTexture(0x51402f, 0xcfe6ff);
    for (let i = 0; i < 14; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const b = makeBuilding(i, i % 2 === 0 ? windowTexA : windowTexB);
      b.position.x = side * (ROAD_W / 2 + 10 + (i % 4) * 3);
      this.addProp(b, (i / 14) * LOOP_LEN);
    }
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const t = makeTree();
      t.position.x = side * (ROAD_W / 2 + 4.2);
      this.addProp(t, (i / 10) * LOOP_LEN + 7);
    }
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const l = makeLamp();
      l.position.x = side * (ROAD_W / 2 + 2.2);
      l.scale.x = side; // arm faces the road
      this.addProp(l, (i / 8) * LOOP_LEN + 3);
    }

    // distant skyline silhouette
    for (let i = 0; i < 10; i++) {
      const sil = new THREE.Mesh(
        new THREE.BoxGeometry(10 + (i % 4) * 6, 18 + (i % 5) * 8, 4),
        new THREE.MeshBasicMaterial({ color: 0xa9c4e0 }),
      );
      sil.position.set(-70 + i * 16, 9, -130);
      this.scene.add(sil);
    }

    // red hit-flash plane just in front of the camera
    this.hitFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 3),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0,
        fog: false,
        depthTest: false,
      }),
    );
    this.hitFlash.renderOrder = 999;
    this.camera.add(this.hitFlash);
    this.hitFlash.position.set(0, 0, -1.2);
    this.scene.add(this.camera);
  }

  private addProp(mesh: THREE.Object3D, baseZ: number): void {
    this.scene.add(mesh);
    this.props.push({ mesh, baseZ });
  }

  // ── per-frame update (reads engine state, renders) ────────────────────

  update(state: RunnerSceneState, nowMs: number): void {
    if (this.disposed) return;
    const d = state.distance;

    // road scroll
    this.roadTex.offset.y = (d / LOOP_LEN) * 24;

    // recycle props along the loop
    for (const p of this.props) {
      let z = (p.baseZ - d) % LOOP_LEN;
      if (z < 0) z += LOOP_LEN;
      // z in [0, LOOP_LEN): place ahead of player from -10 to -(LOOP_LEN-10)
      p.mesh.position.z = -(z ? z : LOOP_LEN) + 10;
    }

    // clouds drift slowly
    for (let i = 0; i < this.clouds.length; i++) {
      this.clouds[i].position.x += Math.sin(nowMs / 9000 + i) * 0.005;
    }

    // obstacles + coins
    this.syncObstacles(state.obstacles);
    this.syncCoins(state.coins, nowMs);

    // camera from engine outputs (never recomputed here)
    this.camera.position.y = state.cameraY;
    this.camera.rotation.x = state.cameraPitch;
    if (Math.abs(state.fov - this.lastFov) > 0.05) {
      this.camera.fov = state.fov;
      this.camera.updateProjectionMatrix();
      this.lastFov = state.fov;
    }

    // hit flash decay
    const flashAge = state.hitFlashAt > 0 ? nowMs - state.hitFlashAt : Infinity;
    (this.hitFlash.material as THREE.MeshBasicMaterial).opacity =
      flashAge < 450 ? 0.45 * (1 - flashAge / 450) : 0;

    this.renderer.render(this.scene, this.camera);
  }

  private syncObstacles(obstacles: SceneObstacle[]): void {
    for (const ob of obstacles) {
      const visible = ob.zAhead > -5 && ob.zAhead < FOG_FAR && !ob.resolved;
      let mesh = this.obstacleMeshes.get(ob.id);
      if (visible && !mesh) {
        mesh = ob.type === 'hurdle' ? makeHurdle() : makeBeam();
        this.obstacleMeshes.set(ob.id, mesh);
        this.scene.add(mesh);
      }
      if (mesh) {
        if (!visible) {
          this.scene.remove(mesh);
          this.obstacleMeshes.delete(ob.id);
          disposeObject(mesh);
        } else {
          mesh.position.z = -ob.zAhead;
        }
      }
    }
  }

  private syncCoins(coins: SceneCoin[], nowMs: number): void {
    for (const coin of coins) {
      const inView = coin.zAhead > -5 && coin.zAhead < FOG_FAR;
      const popping = this.coinPops.has(coin.id);
      let mesh = this.coinMeshes.get(coin.id);

      // a coin just got collected while visible → start its pop
      if (coin.collected && mesh && !popping) {
        this.coinPops.set(coin.id, nowMs);
      }

      const wanted = inView && (!coin.collected || this.coinPops.has(coin.id));
      if (wanted && !mesh) {
        if (coin.collected) continue; // collected before ever visible
        mesh = makeCoin();
        this.coinMeshes.set(coin.id, mesh);
        this.scene.add(mesh);
      }
      if (!mesh) continue;

      if (!wanted) {
        this.scene.remove(mesh);
        this.coinMeshes.delete(coin.id);
        this.coinPops.delete(coin.id);
        disposeObject(mesh);
        continue;
      }

      mesh.position.z = -coin.zAhead;
      mesh.position.y = coin.aerial ? 1.7 : 0.8;
      mesh.rotation.y = (nowMs / 1000) * COIN.SPIN_RAD_S;

      // collect pop: quick scale-out then remove
      const popStart = this.coinPops.get(coin.id);
      if (popStart !== undefined) {
        const t = (nowMs - popStart) / 200;
        if (t >= 1) {
          this.scene.remove(mesh);
          this.coinMeshes.delete(coin.id);
          this.coinPops.delete(coin.id);
          disposeObject(mesh);
        } else {
          const s = 1 + t * 0.8;
          mesh.scale.set(s, s, s);
          mesh.position.y += t * 0.5;
          mesh.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
            if (m && 'opacity' in m) {
              m.transparent = true;
              m.opacity = 1 - t;
            }
          });
        }
      }
    }
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    this.scene.traverse((obj) => disposeObject(obj));
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// ── mesh disposal helper ──────────────────────────────────────────────────

function disposeObject(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else if (mat) mat.dispose();
}

// ── procedural art factories (GLTF swap seam) ─────────────────────────────

function makeRoadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3f4652';
  g.fillRect(0, 0, 128, 256);
  // edge lines
  g.fillStyle = '#e8eaee';
  g.fillRect(6, 0, 4, 256);
  g.fillRect(118, 0, 4, 256);
  // center dashes
  g.fillStyle = '#ffd34d';
  for (let y = 0; y < 256; y += 64) g.fillRect(61, y, 6, 34);
  return new THREE.CanvasTexture(c);
}

function makeStripeTexture(colorA: string, colorB: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = colorA;
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = colorB;
  for (let x = -32; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 32);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

function makeWindowTexture(base: number, lit: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${base.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 122; y += 14) {
    for (let x = 6; x < 58; x += 12) {
      g.fillStyle =
        Math.random() > 0.45
          ? `#${lit.toString(16).padStart(6, '0')}`
          : 'rgba(12,18,30,0.9)';
      g.fillRect(x, y, 7, 9);
    }
  }
  return new THREE.CanvasTexture(c);
}

/** Jump obstacle: low hurdle with cyan/white hazard stripes (jump = cyan). */
export function makeHurdle(): THREE.Object3D {
  const group = new THREE.Group();
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_W * 0.72, 0.45, 0.3),
    new THREE.MeshLambertMaterial({ map: makeStripeTexture('#06b6d4', '#f0fdff') }),
  );
  bar.position.y = 0.42;
  group.add(bar);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.42, 0.14),
      new THREE.MeshLambertMaterial({ color: 0x27333f }),
    );
    leg.position.set(side * ROAD_W * 0.34, 0.21, 0);
    group.add(leg);
  }
  return group;
}

/** Squat obstacle: overhead beam, amber/black construction stripes, gap beneath. */
export function makeBeam(): THREE.Object3D {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_W * 0.9, 0.55, 0.5),
    new THREE.MeshLambertMaterial({ map: makeStripeTexture('#f59e0b', '#1c1917') }),
  );
  beam.position.y = 1.45; // gap beneath — squat (eye dips to ~0.85m) fits under
  group.add(beam);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 1.45, 0.22),
      new THREE.MeshLambertMaterial({ color: 0x374151 }),
    );
    post.position.set(side * ROAD_W * 0.44, 0.72, 0);
    group.add(post);
  }
  return group;
}

/** Spinning collectible: gold ring + inner disc, amber muscle-glow. */
export function makeCoin(): THREE.Object3D {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.07, 8, 20),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b }),
  );
  group.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 16),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide }),
  );
  group.add(disc);
  return group;
}

function makeBuilding(i: number, windowTex: THREE.CanvasTexture): THREE.Object3D {
  const w = 6 + (i % 3) * 3;
  const h = 8 + ((i * 7) % 14);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 6),
    new THREE.MeshLambertMaterial({ map: windowTex }),
  );
  mesh.position.y = h / 2;
  return mesh;
}

function makeTree(): THREE.Object3D {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6),
    new THREE.MeshLambertMaterial({ color: 0x7a5230 }),
  );
  trunk.position.y = 0.4;
  group.add(trunk);
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.1 - i * 0.28, 1.1, 8),
      new THREE.MeshLambertMaterial({ color: 0x2f9e44 }),
    );
    cone.position.y = 1.1 + i * 0.62;
    group.add(cone);
  }
  return group;
}

function makeLamp(): THREE.Object3D {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 4.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x4b5563 }),
  );
  pole.position.y = 2.2;
  group.add(pole);
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.08, 0.08),
    new THREE.MeshLambertMaterial({ color: 0x4b5563 }),
  );
  arm.position.set(0.55, 4.35, 0);
  group.add(arm);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff1b8 }),
  );
  bulb.position.set(1.05, 4.28, 0);
  group.add(bulb);
  return group;
}
