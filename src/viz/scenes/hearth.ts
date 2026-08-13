import * as THREE from 'three';
import { AppSettingsV1 } from '../../storage/settings';
import { AudioEnergySmoother } from '../audio-energy';
import { atmosphereSpeed, SceneVisualizerOptions } from '../scene';
import { SceneRuntime } from '../scene-runtime';

const MAX_COALS = 18;
const MAX_SPARKS = 48;

interface Spark {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

const FIRE_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FIRE_FRAG = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;

uniform vec3 uCamPos;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uEnergy;
uniform float uPulse;
uniform float uHeight;
uniform float uHue;
uniform float uSat;
uniform int uSteps;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.52;
  }
  return s;
}

vec2 boxIntersect(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv;
  vec3 t1 = (bmax - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float enter = max(max(tmin.x, tmin.y), tmin.z);
  float exit = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(enter, exit);
}

vec3 fireTint(float t, float hue, float sat) {
  vec3 ember = vec3(0.18, 0.025, 0.005);
  vec3 orange = vec3(0.95, 0.28, 0.03);
  vec3 gold = vec3(1.0, 0.72, 0.22);
  vec3 white = vec3(1.0, 0.94, 0.78);
  vec3 col = mix(ember, orange, smoothstep(0.0, 0.35, t));
  col = mix(col, gold, smoothstep(0.28, 0.7, t));
  col = mix(col, white, smoothstep(0.62, 1.0, t));

  float angle = hue * 6.28318;
  vec3 shift = vec3(
    0.12 * sin(angle),
    0.04 * sin(angle + 2.1),
    0.10 * cos(angle)
  );
  col = mix(col, col + shift, sat * 0.55);
  return max(col, vec3(0.0));
}

void main() {
  vec3 ro = uCamPos;
  vec3 rd = normalize(vWorldPos - uCamPos);
  vec2 hit = boxIntersect(ro, rd, uBoxMin, uBoxMax);
  if (hit.y < hit.x || hit.y < 0.0) discard;

  float t0 = max(hit.x, 0.0);
  float t1 = hit.y;
  vec3 boxSize = max(uBoxMax - uBoxMin, vec3(0.001));
  float height = mix(0.42, 1.0, clamp(uHeight, 0.0, 1.0));

  vec3 acc = vec3(0.0);
  float trans = 1.0;
  int steps = clamp(uSteps, 16, 56);
  float dt = (t1 - t0) / float(steps);

  for (int i = 0; i < 56; i++) {
    if (i >= steps || trans < 0.012) break;
    float t = t0 + (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;
    vec3 local = (p - uBoxMin) / boxSize;

    float y = local.y / height;
    if (y < 0.0 || y > 1.12) continue;

    float radial = length((local.xz - vec3(0.5, 0.0, 0.52).xz) * vec2(1.15, 1.35));
    float waist = mix(0.48, 0.12, smoothstep(0.0, 1.0, y));
    float shape = smoothstep(waist + 0.12, waist - 0.08, radial);
    shape *= smoothstep(-0.04, 0.08, local.y) * (1.0 - smoothstep(0.82, 1.08, y));

    vec3 adv = p;
    adv.y -= uTime * (0.55 + uBass * 0.45 + uPulse * 0.25);
    adv.x += sin(uTime * 0.7 + p.y * 3.4) * 0.08;
    adv.z += cos(uTime * 0.55 + p.y * 2.8) * 0.06;
    float n = fbm(adv * vec3(2.6, 1.35, 2.6));
    float flicker = fbm(adv * 5.4 + vec3(0.0, -uTime * 1.8, 0.0));

    float dens = shape * (0.28 + n * 0.95) * (0.55 + uEnergy * 0.7 + uPulse * 0.35);
    dens *= 1.0 - smoothstep(0.55, 1.05, y);
    dens += shape * flicker * uTreble * 0.18;
    dens = max(dens, 0.0);

    float heat = clamp(shape * (1.15 - y * 0.85) * (0.45 + n * 0.7 + uMid * 0.25), 0.0, 1.0);
    vec3 col = fireTint(heat, uHue, uSat);
    col += vec3(1.0, 0.85, 0.45) * pow(heat, 4.0) * (0.15 + uTreble * 0.35);

    float absorb = 1.0 - exp(-dens * dt * 6.4);
    acc += trans * col * absorb;
    trans *= 1.0 - absorb;
  }

  if (acc.r + acc.g + acc.b < 0.01 && trans > 0.97) discard;
  float alpha = clamp(1.0 - trans, 0.0, 1.0);
  gl_FragColor = vec4(acc, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create hearth texture');
  draw(ctx, size);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function makeBrickMaps(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const map = canvasTexture(512, (ctx, size) => {
    ctx.fillStyle = '#3a241c';
    ctx.fillRect(0, 0, size, size);
    const cols = 8;
    const rows = 12;
    const mortar = 5;
    const bw = size / cols;
    const bh = size / rows;
    for (let y = 0; y < rows; y++) {
      const offset = y % 2 === 0 ? 0 : bw * 0.5;
      for (let x = -1; x <= cols; x++) {
        const px = x * bw + offset;
        const py = y * bh;
        const shade = 0.72 + Math.random() * 0.28;
        const r = Math.floor((92 + Math.random() * 40) * shade);
        const g = Math.floor((48 + Math.random() * 22) * shade);
        const b = Math.floor((32 + Math.random() * 16) * shade);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(px + mortar * 0.5, py + mortar * 0.5, bw - mortar, bh - mortar);
        if (Math.random() > 0.55) {
          ctx.fillStyle = `rgba(20,10,6,${0.08 + Math.random() * 0.12})`;
          ctx.beginPath();
          ctx.ellipse(
            px + Math.random() * bw,
            py + Math.random() * bh,
            4 + Math.random() * 10,
            2 + Math.random() * 4,
            0,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }
    }
    const heat = ctx.createLinearGradient(0, size, 0, 0);
    heat.addColorStop(0, 'rgba(90, 28, 8, 0.28)');
    heat.addColorStop(0.45, 'rgba(40, 12, 6, 0.08)');
    heat.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = heat;
    ctx.fillRect(0, 0, size, size);
  });

  const roughness = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 3 + Math.random() * 8, 2);
    }
  });
  roughness.colorSpace = THREE.NoColorSpace;
  return { map, roughness };
}

function makeBarkMaps(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const map = canvasTexture(256, (ctx, size) => {
    const base = ctx.createLinearGradient(0, 0, size, 0);
    base.addColorStop(0, '#2a1810');
    base.addColorStop(0.5, '#4a2c18');
    base.addColorStop(1, '#23140c');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(18, 10, 6, ${0.25 + Math.random() * 0.45})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      const x = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 4, size * 0.35, x - 6, size * 0.7, x + (Math.random() - 0.5) * 8, size);
      ctx.stroke();
    }
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(255, 120, 30, ${0.04 + Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 18 + Math.random() * 40);
    }
  });

  const roughness = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#555555';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 50; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.06 + Math.random() * 0.1})`;
      ctx.lineWidth = 2;
      const x = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (Math.random() - 0.5) * 6, size);
      ctx.stroke();
    }
  });
  roughness.colorSpace = THREE.NoColorSpace;
  return { map, roughness };
}

function makeStoneMap(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#2b241e';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${60 + Math.random() * 40},${50 + Math.random() * 30},${40 + Math.random() * 20},${0.08 + Math.random() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * size, Math.random() * size, 8 + Math.random() * 28, 4 + Math.random() * 10, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

export class EmberHearth {
  private readonly runtime: SceneRuntime;
  private readonly energy = new AudioEnergySmoother({
    bass: 0.12,
    mid: 0.1,
    treble: 0.16,
    energy: 0.09,
    pulseDecay: 2.4,
  });

  private readonly brickMaps: { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture };
  private readonly barkMaps: { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture };
  private readonly stoneMap: THREE.CanvasTexture;

  private readonly fireMaterial: THREE.ShaderMaterial;
  private readonly fireMesh: THREE.Mesh;
  private readonly fireBox = new THREE.Box3(new THREE.Vector3(-0.52, 0.08, -0.58), new THREE.Vector3(0.52, 1.28, 0.08));

  private readonly fireLight: THREE.PointLight;
  private readonly hearthLight: THREE.PointLight;
  private readonly logMats: THREE.MeshStandardMaterial[] = [];
  private readonly coalMesh: THREE.InstancedMesh;
  private readonly coalDummy = new THREE.Object3D();
  private readonly coalSeeds: Array<{ pos: THREE.Vector3; radius: number; phase: number }> = [];

  private readonly sparkGeom: THREE.BufferGeometry;
  private readonly sparkPositions: Float32Array;
  private readonly sparkSizes: Float32Array;
  private readonly sparkColors: Float32Array;
  private readonly sparks: Spark[] = [];
  private sparkCount = MAX_SPARKS;
  private coalCount = MAX_COALS;
  private qualityTier = 2;
  private simTime = 0;
  private spawnAcc = 0;

  constructor(container: HTMLElement, options: SceneVisualizerOptions = {}) {
    this.runtime = new SceneRuntime(container, {
      onContextLost: options.onContextLost,
      fov: 38,
      near: 0.08,
      far: 40,
      cameraPosition: [1.62, 1.08, 2.92],
      target: [0, 0.74, -0.18],
      enablePan: false,
      minDistance: 2.1,
      maxDistance: 5.4,
      minPolarAngle: Math.PI * 0.36,
      maxPolarAngle: Math.PI * 0.58,
      dampingFactor: 0.07,
      background: 0x070504,
      fogDensity: 0.065,
      toneMappingExposure: 0.95,
      useEnvironment: true,
      environmentIntensity: 0.16,
      environmentBlur: 0.08,
      autoRotateSpeedScale: 0.55,
      onResize: () => this.frameHearth(),
    });

    this.brickMaps = makeBrickMaps();
    this.barkMaps = makeBarkMaps();
    this.stoneMap = makeStoneMap();

    this.buildRoom();
    this.buildFireplace();
    this.buildLogs();

    this.fireMaterial = new THREE.ShaderMaterial({
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uBoxMin: { value: this.fireBox.min.clone() },
        uBoxMax: { value: this.fireBox.max.clone() },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
        uHeight: { value: 0.72 },
        uHue: { value: 0.04 },
        uSat: { value: 0.35 },
        uSteps: { value: 44 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const fireSize = new THREE.Vector3();
    this.fireBox.getSize(fireSize);
    const fireCenter = new THREE.Vector3();
    this.fireBox.getCenter(fireCenter);
    this.fireMesh = new THREE.Mesh(new THREE.BoxGeometry(fireSize.x, fireSize.y, fireSize.z), this.fireMaterial);
    this.fireMesh.position.copy(fireCenter);
    this.fireMesh.renderOrder = 3;
    this.runtime.scene.add(this.fireMesh);

    this.fireLight = new THREE.PointLight(0xff6a28, 8.5, 7.5, 1.55);
    this.fireLight.position.set(0, 0.55, -0.12);
    this.runtime.scene.add(this.fireLight);

    this.hearthLight = new THREE.PointLight(0xff8140, 2.2, 4.2, 1.8);
    this.hearthLight.position.set(0, 0.18, 0.42);
    this.runtime.scene.add(this.hearthLight);

    this.coalMesh = this.buildCoals();
    const spark = this.buildSparks();
    this.sparkGeom = spark.geometry;
    this.sparkPositions = spark.positions;
    this.sparkSizes = spark.sizes;
    this.sparkColors = spark.colors;

    this.runtime.resize();
  }

  private brickMaterial(repeatX = 2, repeatY = 2, darker = false): THREE.MeshStandardMaterial {
    const map = this.brickMaps.map.clone();
    map.repeat.set(repeatX, repeatY);
    map.needsUpdate = true;
    const roughnessMap = this.brickMaps.roughness.clone();
    roughnessMap.repeat.set(repeatX, repeatY);
    roughnessMap.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      color: darker ? 0x5a3a2c : 0x8a5a42,
      map,
      roughnessMap,
      roughness: darker ? 0.82 : 0.74,
      metalness: 0.04,
      envMapIntensity: 0.35,
    });
  }

  private buildRoom(): void {
    const scene = this.runtime.scene;

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 40),
      new THREE.MeshStandardMaterial({
        color: 0x1a120e,
        map: this.stoneMap,
        roughness: 0.9,
        metalness: 0.04,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 32),
      new THREE.MeshBasicMaterial({
        color: 0x5a220c,
        transparent: true,
        opacity: 0.42,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.005;
    scene.add(glow);

    const backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(8, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
      new THREE.MeshBasicMaterial({ color: 0x060403, side: THREE.BackSide })
    );
    backdrop.position.y = 1.2;
    scene.add(backdrop);

    scene.add(new THREE.AmbientLight(0x2a1812, 0.22));
    const hemi = new THREE.HemisphereLight(0xffc8a0, 0x080604, 0.28);
    scene.add(hemi);
  }

  private buildFireplace(): void {
    const scene = this.runtime.scene;
    const brick = this.brickMaterial(2.2, 2.4);
    const brickDark = this.brickMaterial(1.4, 1.6, true);
    const stone = new THREE.MeshStandardMaterial({
      color: 0x4a4036,
      map: this.stoneMap,
      roughness: 0.88,
      metalness: 0.06,
    });
    const soot = new THREE.MeshStandardMaterial({
      color: 0x16110e,
      roughness: 0.92,
      metalness: 0.02,
    });
    const iron = new THREE.MeshStandardMaterial({
      color: 0x1c1612,
      roughness: 0.42,
      metalness: 0.72,
      envMapIntensity: 0.7,
    });

    const hearth = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.12, 1.18), stone);
    hearth.position.set(0, 0.0, 0.08);
    scene.add(hearth);

    const back = new THREE.Mesh(new THREE.BoxGeometry(1.22, 1.18, 0.14), soot);
    back.position.set(0, 0.68, -0.62);
    scene.add(back);

    const left = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.48, 0.92), brick);
    left.position.set(-0.86, 0.74, -0.22);
    scene.add(left);
    const right = left.clone();
    right.position.x = 0.86;
    scene.add(right);

    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.22, 0.78), brick);
    lintel.position.set(0, 1.48, -0.22);
    scene.add(lintel);

    const breast = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.85, 0.62), brickDark);
    breast.position.set(0, 2.0, -0.28);
    scene.add(breast);

    const innerFloor = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.06, 0.62), soot);
    innerFloor.position.set(0, 0.09, -0.28);
    scene.add(innerFloor);

    this.addAndiron(-0.32, iron);
    this.addAndiron(0.32, iron);
  }

  private addAndiron(x: number, iron: THREE.MeshStandardMaterial): void {
    const group = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.32, 8), iron);
    post.position.y = 0.22;
    group.add(post);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.42), iron);
    bar.position.set(0, 0.12, -0.08);
    group.add(bar);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.12), iron);
    foot.position.set(0, 0.075, 0.12);
    group.add(foot);
    group.position.set(x, 0.06, -0.08);
    this.runtime.scene.add(group);
  }

  private buildLogs(): void {
    const specs = [
      { pos: new THREE.Vector3(-0.12, 0.2, -0.22), rot: new THREE.Euler(0.12, 0.35, 0.55), len: 0.78, r: 0.075 },
      { pos: new THREE.Vector3(0.16, 0.19, -0.3), rot: new THREE.Euler(-0.08, -0.4, -0.62), len: 0.72, r: 0.068 },
      { pos: new THREE.Vector3(0.0, 0.3, -0.26), rot: new THREE.Euler(0.05, 0.1, 0.18), len: 0.62, r: 0.055 },
    ];

    for (const spec of specs) {
      const map = this.barkMaps.map.clone();
      map.repeat.set(2, 1);
      map.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x6a3c22,
        map,
        roughnessMap: this.barkMaps.roughness,
        roughness: 0.78,
        metalness: 0.04,
        emissive: new THREE.Color(0x4a1408),
        emissiveIntensity: 0.15,
      });
      this.logMats.push(mat);
      const log = new THREE.Mesh(new THREE.CapsuleGeometry(spec.r, spec.len, 6, 12), mat);
      log.position.copy(spec.pos);
      log.rotation.copy(spec.rot);
      this.runtime.scene.add(log);
    }
  }

  private buildCoals(): THREE.InstancedMesh {
    const geom = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a0c08,
      emissive: new THREE.Color(0xff4a12),
      emissiveIntensity: 0.8,
      roughness: 0.7,
      metalness: 0.08,
    });
    const mesh = new THREE.InstancedMesh(geom, mat, MAX_COALS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_COALS; i++) {
      const a = (i / MAX_COALS) * Math.PI * 2 + i * 0.37;
      const r = 0.08 + (i % 5) * 0.045;
      this.coalSeeds.push({
        pos: new THREE.Vector3(Math.cos(a) * r * 0.9, 0.13 + (i % 3) * 0.02, -0.22 + Math.sin(a) * r * 0.55),
        radius: 0.028 + (i % 4) * 0.01,
        phase: i * 1.13,
      });
    }
    this.runtime.scene.add(mesh);
    return mesh;
  }

  private buildSparks(): {
    geometry: THREE.BufferGeometry;
    positions: Float32Array;
    sizes: Float32Array;
    colors: Float32Array;
  } {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_SPARKS * 3);
    const sizes = new Float32Array(MAX_SPARKS);
    const colors = new Float32Array(MAX_SPARKS * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.035,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    this.runtime.scene.add(points);

    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparks.push({
        pos: new THREE.Vector3(0, -10, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0.02,
      });
    }
    return { geometry, positions, sizes, colors };
  }

  private palette(settings: AppSettingsV1): { hue: number; sat: number; light: THREE.Color } {
    if (settings.colorMode === 'mood') {
      return {
        hue: 0.96 + this.energy.bass * 0.04,
        sat: 0.55,
        light: new THREE.Color().setHSL(0.04, 0.85, 0.52),
      };
    }
    if (settings.colorMode === 'spectrum') {
      return {
        hue: (0.03 + this.energy.mid * 0.08) % 1,
        sat: 0.42,
        light: new THREE.Color().setHSL(0.045, 0.9, 0.5),
      };
    }
    return {
      hue: 0.035,
      sat: 0.15,
      light: new THREE.Color(0xff6a28),
    };
  }

  private applyQualityTier(): void {
    const steps = [24, 34, 44][this.qualityTier];
    this.fireMaterial.uniforms.uSteps.value = steps;
    this.sparkCount = [16, 30, MAX_SPARKS][this.qualityTier];
    this.coalCount = [8, 12, MAX_COALS][this.qualityTier];
  }

  private updateCoals(): void {
    const mid = this.energy.mid;
    const pulse = this.energy.heatPulse;
    for (let i = 0; i < MAX_COALS; i++) {
      const seed = this.coalSeeds[i];
      if (!seed || i >= this.coalCount) {
        this.coalDummy.scale.setScalar(0);
        this.coalDummy.position.set(0, -4, 0);
        this.coalDummy.updateMatrix();
        this.coalMesh.setMatrixAt(i, this.coalDummy.matrix);
        continue;
      }
      const breathe = 1 + Math.sin(this.simTime * 2.1 + seed.phase) * 0.08 + mid * 0.18 + pulse * 0.12;
      this.coalDummy.position.copy(seed.pos);
      this.coalDummy.scale.setScalar(seed.radius * breathe);
      this.coalDummy.updateMatrix();
      this.coalMesh.setMatrixAt(i, this.coalDummy.matrix);
    }
    this.coalMesh.instanceMatrix.needsUpdate = true;
    const mat = this.coalMesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.55 + mid * 1.1 + pulse * 0.6;
  }

  private spawnSpark(): void {
    const spark = this.sparks.find((item) => item.life <= 0);
    if (!spark) return;
    spark.pos.set((Math.random() - 0.5) * 0.42, 0.22 + Math.random() * 0.18, -0.28 + (Math.random() - 0.5) * 0.2);
    spark.vel.set((Math.random() - 0.5) * 0.18, 0.35 + Math.random() * 0.45, (Math.random() - 0.5) * 0.12);
    spark.maxLife = 0.7 + Math.random() * 1.1;
    spark.life = spark.maxLife;
    spark.size = 0.012 + Math.random() * 0.02;
  }

  private updateSparks(dt: number, reduced: boolean): void {
    if (!reduced) {
      this.spawnAcc += dt * (0.35 + this.energy.treble * 4.5 + this.energy.heatPulse * 2.2);
      while (this.spawnAcc > 1) {
        this.spawnAcc -= 1;
        const live = this.sparks.filter((s) => s.life > 0).length;
        if (live < this.sparkCount) this.spawnSpark();
      }
    }

    for (let i = 0; i < MAX_SPARKS; i++) {
      const spark = this.sparks[i];
      if (spark.life > 0 && !reduced) {
        spark.life -= dt;
        spark.vel.y += 0.25 * dt;
        spark.vel.x += Math.sin(this.simTime * 6.0 + i) * this.energy.treble * 0.15 * dt;
        spark.vel.multiplyScalar(Math.exp(-0.55 * dt));
        spark.pos.addScaledVector(spark.vel, dt);
      }
      const alive = spark.life > 0;
      const fade = alive ? Math.min(1, spark.life / 0.2) * Math.min(1, (spark.maxLife - spark.life) / 0.15) : 0;
      this.sparkPositions[i * 3] = alive ? spark.pos.x : 0;
      this.sparkPositions[i * 3 + 1] = alive ? spark.pos.y : -10;
      this.sparkPositions[i * 3 + 2] = alive ? spark.pos.z : 0;
      this.sparkSizes[i] = alive ? spark.size * (0.7 + fade) : 0;
      this.sparkColors[i * 3] = 1.0;
      this.sparkColors[i * 3 + 1] = 0.55 + fade * 0.3;
      this.sparkColors[i * 3 + 2] = 0.18;
    }
    const pos = this.sparkGeom.getAttribute('position');
    const size = this.sparkGeom.getAttribute('size');
    const color = this.sparkGeom.getAttribute('color');
    pos.needsUpdate = true;
    if (size) size.needsUpdate = true;
    if (color) color.needsUpdate = true;
  }

  private updateFire(settings: AppSettingsV1): void {
    const u = this.fireMaterial.uniforms;
    u.uCamPos.value.copy(this.runtime.camera.position);
    u.uTime.value = this.simTime;
    u.uBass.value = this.energy.bass;
    u.uMid.value = this.energy.mid;
    u.uTreble.value = this.energy.treble;
    u.uEnergy.value = this.energy.energy;
    u.uPulse.value = this.energy.heatPulse;
    u.uHeight.value = 0.58 + this.energy.bass * 0.38 + this.energy.heatPulse * 0.22;

    const pal = this.palette(settings);
    u.uHue.value = pal.hue;
    u.uSat.value = pal.sat;

    const idle = 0.08 * Math.sin(this.simTime * 1.4);
    this.fireLight.color.copy(pal.light);
    this.fireLight.intensity = 5.4 + this.energy.bass * 7.5 + this.energy.heatPulse * 3.8 + idle;
    this.hearthLight.intensity = 1.4 + this.energy.energy * 2.2;
    this.hearthLight.color.copy(pal.light);

    const logGlow = 0.12 + this.energy.mid * 0.55 + this.energy.heatPulse * 0.2;
    for (const mat of this.logMats) {
      mat.emissiveIntensity = logGlow;
      mat.emissive.copy(pal.light).multiplyScalar(0.35);
    }
  }

  private frameHearth(): void {
    this.runtime.controls.target.set(0, 0.74, -0.18);
    const vFov = THREE.MathUtils.degToRad(this.runtime.camera.fov);
    const aspect = Math.max(this.runtime.camera.aspect, 0.2);
    const fitH = 1.85;
    const fitW = 2.2;
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / (Math.tan(vFov / 2) * aspect);
    const dist = Math.max(distH, distW) * 1.05;

    const offset = this.runtime.camera.position.clone().sub(this.runtime.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0.45, 0.18, 1);
    offset.normalize().multiplyScalar(dist);
    this.runtime.camera.position.copy(this.runtime.controls.target).add(offset);
    this.runtime.controls.minDistance = dist * 0.55;
    this.runtime.controls.maxDistance = dist * 1.85;
  }

  public degradeQuality(): boolean {
    if (this.runtime.degradeQuality()) return true;
    if (this.qualityTier > 0) {
      this.qualityTier -= 1;
      this.applyQualityTier();
      return true;
    }
    return false;
  }

  public render(bands: Float32Array, settings: AppSettingsV1): void {
    if (!this.runtime.alive) return;

    const { now, rawDt } = this.runtime.beginFrame();
    const reduced = this.runtime.applyControls(settings, 0.55);
    const dt = reduced ? 0 : rawDt * atmosphereSpeed(settings);
    if (!reduced) {
      this.simTime += dt;
      this.energy.update(bands, dt);
    }

    this.updateFire(settings);
    this.updateCoals();
    this.updateSparks(dt, reduced);
    this.runtime.renderScene(now);
  }

  public destroy(): void {
    if (this.runtime.isDestroyed) return;
    this.brickMaps.map.dispose();
    this.brickMaps.roughness.dispose();
    this.barkMaps.map.dispose();
    this.barkMaps.roughness.dispose();
    this.stoneMap.dispose();
    this.runtime.disposeSceneGraph();
    this.runtime.destroy();
  }
}
