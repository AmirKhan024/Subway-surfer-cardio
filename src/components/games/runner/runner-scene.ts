/**
 * "The Final Run" — Three.js FPP world. DUMB VISUALIZER ONLY.
 *
 * Themed as the Lohit valley, Arunachal Pradesh: Kaho to the Dong plateau,
 * out of complete darkness into India's first sunrise. The dark→dawn ramp
 * (see DAWN below) is the signature of the level; everything else is scenery
 * around it. All of it is paint — obstacle footprints, lane geometry, camera
 * and clearance heights are unchanged from the original city build.
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

const FOG_NEAR = 30;
const FOG_FAR = 95;
const LOOP_LEN = 200; // prop recycling loop, meters
const ROAD_W = 8;

/**
 * "The Final Run" dawn ramp — Kaho (dark) → Dong plateau (first light).
 *
 * The whole level is ONE 60-second colour ramp; it is the signature of the
 * re-skin. Driven by run progress (0..1) handed in by the layer — see
 * update(). Restraint early is deliberate: ambient starts very low so the
 * sunrise has somewhere to climb to.
 *
 * The mid stops (0.35/0.60) exist so that a run ending EARLY on lives still
 * freezes on a presentable frame instead of a half-saffron smear.
 */
type DawnStop = {
  p: number;
  sky: number;
  sunC: number;
  sunI: number;
  ambC: number;
  ambI: number;
  /** sun disc height; stays behind the ridge line until ~0.7 */
  sunY: number;
};
const DAWN: DawnStop[] = [
  // NIGHT — held. Light tints stay COOL blue-grey on purpose: the trail
  // texture is warm gravel, and a warm key light this early made the whole
  // ground read amber long before the sun was meant to clear the ridge.
  // ambI never drops below ~0.34 — the obstacles must stay readable in the
  // dark or a missed cue costs a real life (this game is also an assessment).
  { p: 0.0, sky: 0x10162e, sunC: 0x1b2742, sunI: 0.12, ambC: 0x2b3a52, ambI: 0.34, sunY: -10 },
  { p: 0.45, sky: 0x141b33, sunC: 0x24304d, sunI: 0.18, ambC: 0x30405e, ambI: 0.4, sunY: -8 },
  // FIRST LIGHT
  { p: 0.6, sky: 0x2b3a4e, sunC: 0x53637a, sunI: 0.42, ambC: 0x4a5a6e, ambI: 0.55, sunY: -4 },
  // pre-dawn violet. Without this stop the blue→saffron lerp passes straight
  // through a muddy grey-brown; real dawn goes indigo → rose → orange.
  { p: 0.68, sky: 0x6b4a5e, sunC: 0x9c6a72, sunI: 0.8, ambC: 0x6d5566, ambI: 0.74, sunY: 4 },
  // SUNRISE — the rim clears the ridge here, in the last quarter
  { p: 0.75, sky: 0xe8913a, sunC: 0xffb066, sunI: 1.35, ambC: 0xbe8a62, ambI: 0.95, sunY: 20 },
  { p: 0.9, sky: 0xf5c542, sunC: 0xffd07a, sunI: 1.75, ambC: 0xdcb679, ambI: 1.2, sunY: 31 },
  // FINISH — warm gold, intensity CAPPED. Not white: an over-exposed cream
  // frame throws away the payoff the whole ramp was built for.
  { p: 1.0, sky: 0xffcb5c, sunC: 0xffdf9a, sunI: 1.95, ambC: 0xf0c98a, ambI: 1.35, sunY: 40 },
];
/** hard translucent green of the Lohit — NOT blue, NOT plains-brown */
const LOHIT_GREEN = 0x1e7a5e;

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class RunnerScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private road!: THREE.Mesh;
  private roadTex!: THREE.CanvasTexture;
  private clouds: THREE.Mesh[] = [];
  // ── dawn-ramp refs (written once per frame by applyDawn; nothing allocated)
  private sunLight!: THREE.DirectionalLight;
  private ambLight!: THREE.AmbientLight;
  private sunDisc!: THREE.Mesh;
  private sunDiscMat!: THREE.MeshBasicMaterial;
  private ridgeMat!: THREE.MeshBasicMaterial;
  private mistMat!: THREE.MeshBasicMaterial;
  /** scratch colours — reused every frame so applyDawn allocates nothing */
  private cA = new THREE.Color();
  private cB = new THREE.Color();
  private cSky = new THREE.Color();
  private props: { mesh: THREE.Object3D; baseZ: number }[] = [];
  private obstacleMeshes = new Map<number, THREE.Object3D>();
  private coinMeshes = new Map<number, THREE.Object3D>();
  /** collect-pop animations: coin id → pop start (ms) */
  private coinPops = new Map<number, number>();
  private lastFov = 0;
  private disposed = false;
  /** visual-scroll follower: a velocity-clamped smoothed distance. Legit
   *  motion passes 1:1 (zero standing lag; hitstop/freezes stay crisp);
   *  only super-speed excess — a single-frame lurch after a main-thread
   *  hitch — bleeds out over ~100ms instead of jumping the world. */
  private smoothD = 0;
  private lastNowMs = 0;
  /** smoothed visual velocity (m/s) derived from smoothD — the ONE signal
   *  layer-side speed fx must read (raw engine distance would strobe on
   *  exactly the frames this follower masks) */
  private visualVel = 0;
  private static readonly SNAP_M = 2;
  private static readonly FOLLOW_RATE = 12;

  constructor(canvas: HTMLCanvasElement) {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(DAWN[0].sky);
    this.scene.fog = new THREE.Fog(DAWN[0].sky, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(65, w / h, 0.1, 160);
    this.camera.position.set(0, 1.6, 0);

    // lights start at the DARK end of the ramp; applyDawn drives them
    this.sunLight = new THREE.DirectionalLight(DAWN[0].sunC, DAWN[0].sunI);
    this.sunLight.position.set(30, 60, 20);
    this.scene.add(this.sunLight);
    this.ambLight = new THREE.AmbientLight(DAWN[0].ambC, DAWN[0].ambI);
    this.scene.add(this.ambLight);

    this.buildWorld();
  }

  // ── world construction ────────────────────────────────────────────────

  private buildWorld(): void {
    // the sunrise itself — rises from behind the ridge line across the run
    this.sunDiscMat = new THREE.MeshBasicMaterial({ color: DAWN[0].sunC, fog: false });
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(6, 24), this.sunDiscMat);
    this.sunDisc.position.set(25, DAWN[0].sunY, -140);
    this.scene.add(this.sunDisc);

    // valley mist (was clouds) — same pooled spheres, dropped low over the
    // trail and flattened so they read as fog on the water, not sky clouds
    this.mistMat = new THREE.MeshBasicMaterial({
      color: 0x9fb0bd,
      transparent: true,
      opacity: 0.3,
      fog: false,
    });
    for (let i = 0; i < 6; i++) {
      const mist = new THREE.Mesh(new THREE.SphereGeometry(4 + (i % 3) * 2, 8, 6), this.mistMat);
      mist.scale.set(3.2, 0.35, 1);
      mist.position.set(-50 + i * 22, 5 + (i % 2) * 3, -70 - (i % 3) * 22);
      this.scene.add(mist);
      this.clouds.push(mist);
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

    // gravel sandbars flanking the trail + the braided Lohit channels beyond.
    // Lane geometry and positions are UNCHANGED — this is paint only, but it
    // is what makes the three lanes read as channel / gravel bar / channel.
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(
        new THREE.PlaneGeometry(3, LOOP_LEN),
        new THREE.MeshLambertMaterial({ color: 0x9a9384 }),
      );
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(side * (ROAD_W / 2 + 1.5), 0.02, -LOOP_LEN / 2 + 10);
      this.scene.add(bar);

      const channel = new THREE.Mesh(
        new THREE.PlaneGeometry(40, LOOP_LEN),
        new THREE.MeshLambertMaterial({ color: LOHIT_GREEN, transparent: true, opacity: 0.88 }),
      );
      channel.rotation.x = -Math.PI / 2;
      channel.position.set(side * (ROAD_W / 2 + 3 + 20), -0.01, -LOOP_LEN / 2 + 10);
      this.scene.add(channel);
    }

    // recycled trailside props. Counts and x/z placement are kept from the
    // city build so the draw count does not grow — only the art changed.
    // (part counts per prop are LOWER than the city's, see the factories)
    for (let i = 0; i < 14; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      // ONE gonpa per loop as a landmark; the rest is pine slope and cane.
      // (an earlier build put a lit-window block every 4th prop, which read
      // as a city skyline — the whole thing this re-skin exists to remove)
      const b = i === 9 ? makeGonpa() : i % 3 === 1 ? makeBamboo(i) : makePine(i);
      b.position.x = side * (ROAD_W / 2 + 10 + (i % 4) * 3);
      this.addProp(b, (i / 14) * LOOP_LEN);
    }
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      // alternating prayer-flag lines and mani-stone stacks at the trail edge
      const t = i % 2 === 0 ? makePrayerFlags() : makeManiStack();
      t.position.x = side * (ROAD_W / 2 + 4.2);
      this.addProp(t, (i / 10) * LOOP_LEN + 7);
    }
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      // milestone stones counting the trail down, with the odd butter lamp
      const l = makeTrailMarker(i);
      l.position.x = side * (ROAD_W / 2 + 2.2);
      l.scale.x = side;
      this.addProp(l, (i / 8) * LOOP_LEN + 3);
    }

    // the ridge line — one SHARED material so the dawn ramp tints all ten
    // peaks with a single write per frame
    // fog:false is load-bearing — the ridge sits at z=-130, well beyond
    // FOG_FAR (95), so with fog on it dissolves completely into the sky and
    // the sunrise has no ridge to clear. (The old city skyline silhouettes
    // had the same problem and were effectively invisible geometry.)
    this.ridgeMat = new THREE.MeshBasicMaterial({ color: 0x0b1020, fog: false });
    for (let i = 0; i < 10; i++) {
      // BROAD and low — a peak that is taller than it is wide just reads as
      // another pine at this distance. Mountains are wide.
      const peak = new THREE.Mesh(
        new THREE.ConeGeometry(18 + (i % 4) * 9, 20 + (i % 5) * 9, 4),
        this.ridgeMat,
      );
      peak.position.set(-78 + i * 18, 4, -130);
      peak.rotation.y = Math.PI / 4;
      this.scene.add(peak);
    }

    // NOTE: the damage cue is no longer a full-screen red plane parented to
    // the camera (it read as a full-screen pink tint over the bright sky and
    // was one of the worst-frame paints). It's now a cheap localized red
    // edge-flash in the React overlay, driven off the OBSTACLE(cleared:false)
    // event — see runner-layer.tsx (fxHit).
    this.scene.add(this.camera);
  }

  private addProp(mesh: THREE.Object3D, baseZ: number): void {
    this.scene.add(mesh);
    this.props.push({ mesh, baseZ });
  }

  // ── per-frame update (reads engine state, renders) ────────────────────

  /**
   * @param progress 0..1 run progress, ONLY used to drive the dark→dawn
   *   colour ramp. Purely cosmetic: nothing here feeds back into the engine,
   *   and the default keeps every existing caller valid.
   */
  update(state: RunnerSceneState, nowMs: number, progress = 0): void {
    if (this.disposed) return;

    this.applyDawn(progress);

    // visual-scroll follower (see field comment): pass legitimate per-frame
    // motion 1:1, smooth only the super-speed excess of a frame hitch
    const dtS =
      this.lastNowMs === 0 ? 0 : Math.min(0.1, Math.max(0, (nowMs - this.lastNowMs) / 1000));
    this.lastNowMs = nowMs;
    const prevSmoothD = this.smoothD;
    const step = state.distance - this.smoothD;
    if (dtS === 0 || step < 0 || step > RunnerScene.SNAP_M) {
      this.smoothD = state.distance; // first frame / restart / teleport
      this.visualVel = 0;
    } else {
      // clamp dt so the hitch frame itself counts as a lurch to be smoothed
      const allowed = state.speed * 1.25 * Math.min(dtS, 1 / 30);
      this.smoothD +=
        step <= allowed
          ? step
          : allowed + (step - allowed) * Math.min(1, dtS * RunnerScene.FOLLOW_RATE);
      const instVel = dtS > 0 ? (this.smoothD - prevSmoothD) / dtS : 0;
      this.visualVel += (instVel - this.visualVel) * 0.2;
    }
    const d = this.smoothD;
    const lagOffset = state.distance - this.smoothD;

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

    // obstacles + coins (positioned on the smoothed scroll via lagOffset)
    this.syncObstacles(state.obstacles, lagOffset);
    this.syncCoins(state.coins, nowMs, lagOffset);

    // camera from engine outputs (never recomputed here)
    this.camera.position.y = state.cameraY;
    this.camera.position.x = state.shakeX ?? 0;
    this.camera.rotation.x = state.cameraPitch;
    if (Math.abs(state.fov - this.lastFov) > 0.05) {
      this.camera.fov = state.fov;
      this.camera.updateProjectionMatrix();
      this.lastFov = state.fov;
    }

    // (damage cue moved to a localized React overlay — see fxHit)

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Kaho → Dong: walk the DAWN ramp and repaint sky, fog, both lights, the
   * sun disc and the ridge/mist tints. No allocation, no geometry change, no
   * new full-screen paint — ~6 colour writes per frame. Every Lambert surface
   * (trail, sandbars, river, pines, stones) re-lights for free off the two
   * lights, which is why the ground needs no per-frame touch.
   */
  private applyDawn(progress: number): void {
    const p = Math.min(1, Math.max(0, progress));
    let i = 0;
    while (i < DAWN.length - 2 && p > DAWN[i + 1].p) i++;
    const a = DAWN[i];
    const b = DAWN[i + 1];
    const t = b.p === a.p ? 0 : Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p)));

    // sky + fog share one colour so the horizon has no seam
    this.cSky.copy(this.cA.setHex(a.sky)).lerp(this.cB.setHex(b.sky), t);
    (this.scene.background as THREE.Color).copy(this.cSky);
    (this.scene.fog as THREE.Fog).color.copy(this.cSky);

    this.sunLight.color.copy(this.cA.setHex(a.sunC)).lerp(this.cB.setHex(b.sunC), t);
    this.sunLight.intensity = lerpNum(a.sunI, b.sunI, t);
    this.ambLight.color.copy(this.cA.setHex(a.ambC)).lerp(this.cB.setHex(b.ambC), t);
    this.ambLight.intensity = lerpNum(a.ambI, b.ambI, t);

    // the sun clears the ridge
    this.sunDisc.position.y = lerpNum(a.sunY, b.sunY, t);
    this.sunDiscMat.color.copy(this.cA.setHex(a.sunC)).lerp(this.cB.setHex(b.sunC), t);

    // ridge reads as a silhouette against whatever the sky is doing
    this.ridgeMat.color.copy(this.cSky).multiplyScalar(0.32);
    // mist only becomes visible once there is light to catch
    this.mistMat.color.copy(this.cSky).lerp(this.cA.setHex(0xffffff), 0.25);
    this.mistMat.opacity = 0.12 + p * 0.34;
  }

  /** Smoothed visual velocity (m/s) — same signal as the scroll follower;
   *  the layer's speed-fx intensity MUST use this, never raw distance. */
  getVisualVelocity(): number {
    return this.visualVel;
  }

  private syncObstacles(obstacles: SceneObstacle[], lagOffset: number): void {
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
          mesh.position.z = -(ob.zAhead + lagOffset);
        }
      }
    }
  }

  private syncCoins(coins: SceneCoin[], nowMs: number, lagOffset: number): void {
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

      mesh.position.z = -(coin.zAhead + lagOffset);
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
  // gravel trail bed
  g.fillStyle = '#38332c';
  g.fillRect(0, 0, 128, 256);
  // scattered grit — deterministic, so the trail is identical every run
  for (let i = 0; i < 220; i++) {
    const x = (i * 37) % 128;
    const y = (i * 71) % 256;
    g.fillStyle = i % 3 === 0 ? '#4a443a' : '#2e2a24';
    g.fillRect(x, y, 2, 2);
  }
  // edge stones — DASHED so the edges scroll visibly (solid lines read as
  // static; the dashes are most of the ground-speed sensation)
  g.fillStyle = '#b9b0a0';
  for (let y = 0; y < 256; y += 16) {
    g.fillRect(6, y, 4, 9);
    g.fillRect(118, y, 4, 9);
  }
  // worn centre of the footpath
  g.fillStyle = '#8f8676';
  for (let y = 0; y < 256; y += 64) g.fillRect(61, y, 6, 34);
  return new THREE.CanvasTexture(c);
}

/**
 * Obstacle skins are SHARED module singletons, created once on first use.
 * They used to be rebuilt per obstacle spawn (a fresh 128x32 canvas each
 * time); hoisting them removes that per-spawn cost. Lazy because `document`
 * does not exist at module scope under SSR. Never disposed — disposeObject
 * only releases geometry + material, which is what keeps this safe.
 */
let barkTex: THREE.CanvasTexture | null = null;
function barkTexture(): THREE.CanvasTexture {
  if (barkTex) return barkTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a4630';
  g.fillRect(0, 0, 64, 32);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#6d573c' : '#42331f';
    g.fillRect((i * 7) % 64, 0, 2, 32);
  }
  barkTex = new THREE.CanvasTexture(c);
  barkTex.wrapS = THREE.RepeatWrapping;
  barkTex.repeat.set(3, 1);
  return barkTex;
}

let bambooTex: THREE.CanvasTexture | null = null;
function bambooTexture(): THREE.CanvasTexture {
  if (bambooTex) return bambooTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b5b268';
  g.fillRect(0, 0, 64, 32);
  // node bands
  g.fillStyle = '#6f7a3a';
  for (let x = 0; x < 64; x += 21) g.fillRect(x, 0, 3, 32);
  g.fillStyle = '#d8d59a';
  g.fillRect(0, 4, 64, 3);
  bambooTex = new THREE.CanvasTexture(c);
  bambooTex.wrapS = THREE.RepeatWrapping;
  bambooTex.repeat.set(4, 1);
  return bambooTex;
}

/** Lung ta — the five elements, in the traditional order. */
let flagTex: THREE.CanvasTexture | null = null;
function flagTexture(): THREE.CanvasTexture {
  if (flagTex) return flagTex;
  const c = document.createElement('canvas');
  c.width = 80;
  c.height = 16;
  const g = c.getContext('2d')!;
  const lungTa = ['#2b6cb0', '#f7f7f2', '#c53030', '#2f855a', '#e8b339'];
  for (let i = 0; i < 5; i++) {
    g.fillStyle = lungTa[i];
    g.fillRect(i * 16, 0, 15, 16);
  }
  flagTex = new THREE.CanvasTexture(c);
  flagTex.wrapS = THREE.RepeatWrapping;
  flagTex.repeat.set(2, 1);
  return flagTex;
}

// (the tiled lit-window facade texture that used to live here is gone with
// the city — the gonpa's two butter-lamp windows are plain quads now)

/**
 * JUMP obstacle: a fallen pine log across the trail.
 *
 * Footprint is byte-identical to the old hurdle — same span (ROAD_W * 0.72),
 * same height (0.42), same leg positions. Only the skin changed.
 *
 * The pale frost band on top is NOT decoration: the old hurdle was cyan so it
 * read instantly as "jump", and this level runs in near-darkness for its first
 * third. The band keeps that cold, high-contrast read (and stays unlit, via
 * MeshBasicMaterial, so the dark end of the dawn ramp cannot swallow it).
 */
export function makeHurdle(): THREE.Object3D {
  const group = new THREE.Group();
  const log = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, ROAD_W * 0.72, 8),
    // emissive floor: at the dark end of the ramp a plain Lambert log goes
    // fully black and the frost band alone reads as a floating white bar.
    // This keeps the LOG visible as the object you have to jump.
    new THREE.MeshLambertMaterial({ map: barkTexture(), emissive: 0x3d2e1d }),
  );
  log.rotation.z = Math.PI / 2;
  log.position.y = 0.42;
  group.add(log);
  const frost = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_W * 0.7, 0.04, 0.2),
    new THREE.MeshBasicMaterial({ color: 0xb8d8e2 }),
  );
  frost.position.y = 0.6;
  group.add(frost);
  for (const side of [-1, 1]) {
    const stump = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.42, 0.14),
      new THREE.MeshLambertMaterial({ color: 0x342e26 }),
    );
    stump.position.set(side * ROAD_W * 0.34, 0.21, 0);
    group.add(stump);
  }
  return group;
}

/**
 * SCOOP (squat) obstacle: a low bamboo bough over the trail.
 *
 * Same span, same posts, and the bough sits at exactly the old beam height —
 * the clearance gap beneath is unchanged. The saffron prayer ribbon rides on
 * TOP of the bough on purpose: nothing in this prop may hang below 1.45 or it
 * would read as a lower ceiling than the game actually has.
 */
export function makeBeam(): THREE.Object3D {
  const group = new THREE.Group();
  const bough = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.27, ROAD_W * 0.9, 8),
    new THREE.MeshLambertMaterial({ map: bambooTexture() }),
  );
  bough.rotation.z = Math.PI / 2;
  bough.position.y = 1.45; // gap beneath — squat (eye dips to ~0.85m) fits under
  group.add(bough);
  const ribbon = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_W * 0.9, 0.1, 0.2),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b }),
  );
  ribbon.position.y = 1.74;
  group.add(ribbon);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 1.45, 0.22),
      new THREE.MeshLambertMaterial({ color: 0x4a3f33 }),
    );
    post.position.set(side * ROAD_W * 0.44, 0.72, 0);
    group.add(post);
  }
  return group;
}

/**
 * Gold mohur, from a retreating column's scattered pay-chest.
 *
 * Mesh size is PURELY visual — pickup is decided engine-side from the coin's
 * zAhead and lane, never from this geometry — so it is safe to scale. The
 * original ring filled a third of the screen as it passed the camera; a coin
 * should read as a coin.
 */
export function makeCoin(): THREE.Object3D {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.19, 0.05, 8, 20),
    new THREE.MeshBasicMaterial({ color: 0xd9a441 }),
  );
  group.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.135, 16),
    new THREE.MeshBasicMaterial({ color: 0xf7d872, side: THREE.DoubleSide }),
  );
  group.add(disc);
  return group;
}

/** Pine on the valley slope — 2 meshes, where the old building was 1. */
function makePine(i: number): THREE.Object3D {
  const group = new THREE.Group();
  const w = 6 + (i % 3) * 3;
  const h = 8 + ((i * 7) % 14);
  const trunkH = h * 0.3;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 0.05, w * 0.08, trunkH, 6),
    new THREE.MeshLambertMaterial({ color: 0x4a3a28 }),
  );
  trunk.position.y = trunkH / 2;
  group.add(trunk);
  const canopyH = h * 0.85;
  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(w * 0.42, canopyH, 7),
    new THREE.MeshLambertMaterial({ color: 0x1f3d2b }),
  );
  canopy.position.y = trunkH + canopyH / 2 - trunkH * 0.3;
  group.add(canopy);
  return group;
}

/**
 * Gonpa (monastery) — a LANDMARK, one per recycling loop, not a skyline.
 *
 * The previous version of this was a box wearing a tiled lit-window texture
 * plus a flat roof slab, which rendered as a grey apartment block and read as
 * "the city is still here". The silhouette is what makes a gonpa: a tiered
 * base, a wide OVERHANGING sloped roof, and a finial. Basic-material
 * throughout so it stays a silhouette against the sky like the ridge peaks,
 * with two small warm windows — with the prayer flags, the only saturated
 * things in the dark opening of the run.
 */
function makeGonpa(): THREE.Object3D {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x241f1a });

  const base = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 7), wallMat);
  base.position.y = 2;
  group.add(base);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 5), wallMat);
  upper.position.y = 5.6;
  group.add(upper);

  // the overhang is the tell — 4-sided cone, wider than the storey it caps
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(6.4, 2.6, 4),
    new THREE.MeshBasicMaterial({ color: 0x6b2f22 }),
  );
  roof.position.y = 8.5;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  const finial = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.2, 6),
    new THREE.MeshBasicMaterial({ color: 0xd9a441 }),
  );
  finial.position.y = 10.3;
  group.add(finial);

  // butter-lamp windows — a couple of warm points, never a tiled facade
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffcf6a });
  for (const x of [-1.6, 1.6]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), lampMat);
    win.position.set(x, 5.4, 2.55);
    group.add(win);
  }
  return group;
}

/** Cane/bamboo clump — thin tapered culms sharing one material. */
function makeBamboo(i: number): THREE.Object3D {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x5c6b34 });
  const culms = 3 + (i % 2);
  for (let c = 0; c < culms; c++) {
    const h = 5 + ((i + c * 3) % 5);
    const culm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, h, 5), mat);
    culm.position.set((c - culms / 2) * 0.55, h / 2, (c % 2) * 0.5);
    culm.rotation.z = (c % 2 === 0 ? 1 : -1) * 0.06 * (c + 1);
    group.add(culm);
  }
  return group;
}

/** Prayer-flag line at the trail edge — unlit, so it carries colour in the dark. */
function makePrayerFlags(): THREE.Object3D {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, 3.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b5a45 }),
  );
  pole.position.y = 1.7;
  group.add(pole);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 0.34),
    new THREE.MeshBasicMaterial({ map: flagTexture(), side: THREE.DoubleSide }),
  );
  line.position.set(1.3, 2.6, 0);
  line.rotation.z = -0.12; // the sag of a strung line
  group.add(line);
  return group;
}

/** Mani-stone stack at a trail junction. */
function makeManiStack(): THREE.Object3D {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x6e6a63 });
  for (let i = 0; i < 3; i++) {
    const s = 0.7 - i * 0.16;
    const stone = new THREE.Mesh(new THREE.BoxGeometry(s, 0.18, s * 0.7), mat);
    stone.position.y = 0.09 + i * 0.19;
    stone.rotation.y = i * 0.4;
    group.add(stone);
  }
  return group;
}

/**
 * Trail markers, alternating a tall darchor flag pole with a roadside
 * kilometre stone. The poles are what keep the near-trail vertical rhythm the
 * old lamp posts gave — that rhythm is a real part of the sense of speed.
 */
function makeTrailMarker(i: number): THREE.Object3D {
  const group = new THREE.Group();
  if (i % 2 === 0) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 4, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b5a45 }),
    );
    pole.position.y = 2;
    group.add(pole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 1.7),
      new THREE.MeshBasicMaterial({ color: 0xe8913a, side: THREE.DoubleSide }),
    );
    flag.position.set(0.2, 3, 0);
    group.add(flag);
    if (i % 4 === 0) {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffcf6a }),
      );
      lamp.position.set(0, 4.05, 0);
      group.add(lamp);
    }
    return group;
  }
  const stone = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.62, 0.18),
    new THREE.MeshLambertMaterial({ color: 0xe8e4da }),
  );
  stone.position.y = 0.31;
  group.add(stone);
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.16, 0.2),
    new THREE.MeshLambertMaterial({ color: 0xd9a441 }),
  );
  cap.position.y = 0.66;
  group.add(cap);
  return group;
}
