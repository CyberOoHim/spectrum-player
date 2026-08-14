import * as THREE from 'three';
import { AppSettingsV1 } from '../../storage/settings';
import { AudioEnergySmoother } from '../audio-energy';
import { atmosphereSpeed, SceneVisualizerOptions } from '../scene';
import { SceneRuntime } from '../scene-runtime';

const MAX_SPARKLES = 60;

interface Sparkle {
  pos: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

const WATER_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;

uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uPulse;

// Gerstner Wave displacement
vec3 gerstnerWave(vec2 dir, float steepness, float wavelength, vec2 p, float time, inout vec3 tangent, inout vec3 binormal) {
  float k = 2.0 * 3.14159 / wavelength;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(dir);
  float f = k * (dot(d, p) - c * time);
  float a = steepness / k;

  tangent += vec3(
    -d.x * d.x * (steepness * sin(f)),
    d.x * (steepness * cos(f)),
    -d.x * d.y * (steepness * sin(f))
  );
  binormal += vec3(
    -d.x * d.y * (steepness * sin(f)),
    d.y * (steepness * cos(f)),
    -d.y * d.y * (steepness * sin(f))
  );

  return vec3(
    d.x * (a * cos(f)),
    a * sin(f),
    d.y * (a * cos(f))
  );
}

void main() {
  vUv = uv;
  vec3 p = position;

  float waveSpeed = uTime * (0.65 + uPulse * 0.25);
  float swellAmp = 0.08 + uBass * 0.09 + uPulse * 0.05;
  
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 wavePos = vec3(0.0);

  // Main incoming ocean swell (toward shore, +Z direction)
  wavePos += gerstnerWave(vec2(0.08, 0.99), swellAmp * 1.8, 4.2, p.xz, waveSpeed * 1.1, tangent, binormal);
  // Secondary cross swell
  wavePos += gerstnerWave(vec2(0.35, 0.93), swellAmp * 1.0, 2.4, p.xz, waveSpeed * 1.35, tangent, binormal);
  // Fine surface wave
  wavePos += gerstnerWave(vec2(-0.25, 0.96), swellAmp * 0.6, 1.1, p.xz, waveSpeed * 1.8, tangent, binormal);

  // Dampen waves as they reach the shallow shore (z > 2.2)
  float shoreDamp = clamp(1.0 - smoothstep(1.5, 3.8, p.z), 0.05, 1.0);
  wavePos.y *= shoreDamp;

  p += wavePos;
  vec3 normalCalc = normalize(cross(binormal, tangent));

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize((modelMatrix * vec4(normalCalc, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;

uniform vec3 uCamPos;
uniform vec3 uMoonPos;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uEnergy;
uniform float uPulse;
uniform float uHue;
uniform float uSat;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

vec3 paletteShift(vec3 col, float hue, float sat) {
  float angle = hue * 6.28318;
  vec3 shift = vec3(
    0.12 * sin(angle),
    0.06 * sin(angle + 2.1),
    0.16 * cos(angle)
  );
  return mix(col, clamp(col + shift, 0.0, 1.0), sat * 0.55);
}

void main() {
  vec3 viewDir = normalize(uCamPos - vWorldPos);
  vec3 moonDir = normalize(uMoonPos - vWorldPos);

  // Micro-ripple normal perturbation
  vec2 rippleUv = vWorldPos.xz * 3.5 + vec2(uTime * 0.15, uTime * 0.35);
  float n1 = fbm(rippleUv);
  float n2 = fbm(rippleUv * 2.2 - vec2(uTime * 0.2, 0.0));
  vec3 waveNorm = normalize(vNormal + vec3((n1 - 0.5) * 0.22, 0.0, (n2 - 0.5) * 0.22));

  // Fresnel reflectance
  float fresnel = pow(1.0 - max(dot(viewDir, waveNorm), 0.0), 4.2);
  fresnel = clamp(fresnel * 0.85 + 0.08, 0.0, 1.0);

  // Moonlight specular path on rolling water
  vec3 halfMoon = normalize(viewDir + moonDir);
  float specSharp = pow(max(dot(waveNorm, halfMoon), 0.0), 96.0);
  float specWide = pow(max(dot(waveNorm, halfMoon), 0.0), 16.0);
  
  // Specular sparkles (Treble glitter path)
  float sparkleNoise = pow(noise(vWorldPos.xz * 18.0 + uTime * 0.6), 5.0);
  float moonPath = smoothstep(2.5, 0.0, abs(vWorldPos.x - uMoonPos.x * (vWorldPos.z / uMoonPos.z)));
  float glitter = specSharp * (1.8 + uTreble * 3.5) * (1.0 + sparkleNoise * 4.0 * uTreble) * moonPath;

  // Ocean color depth gradient (deep navy -> turquoise shallow)
  vec3 deepColor = vec3(0.02, 0.06, 0.14);
  vec3 shallowColor = vec3(0.04, 0.18, 0.26);
  vec3 skyReflection = vec3(0.06, 0.12, 0.24);

  float depthFactor = smoothstep(-6.0, 2.5, vWorldPos.z);
  vec3 waterBody = mix(deepColor, shallowColor, depthFactor);

  // Foam lace calculation (wave crests & shoreline foam)
  float crestHeight = smoothstep(0.04 + uBass * 0.04, 0.15, vWorldPos.y);
  float shoreDistance = smoothstep(1.2, 3.2, vWorldPos.z);
  float foamNoise = fbm(vWorldPos.xz * 6.0 - vec2(0.0, uTime * 0.45));
  float foamLace = smoothstep(0.48 - uMid * 0.15, 0.72, foamNoise) * (crestHeight * 0.75 + shoreDistance * 0.95);
  
  vec3 foamColor = vec3(0.85, 0.94, 1.0);

  // Composite water surface
  vec3 col = mix(waterBody, skyReflection, fresnel);
  col += vec3(1.0, 0.96, 0.85) * (glitter + specWide * 0.35);
  col = mix(col, foamColor, foamLace * 0.88);

  col = paletteShift(col, uHue, uSat);

  // Transparency near shallow beach
  float alpha = clamp(smoothstep(3.8, 1.5, vWorldPos.z) * 0.7 + 0.3 + foamLace * 0.5, 0.2, 0.95);
  gl_FragColor = vec4(col, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SPARKLE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uPixelRatio;
varying float vAlpha;

void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * (200.0 / max(-mv.z, 0.1)) * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`;

const SPARKLE_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 2.0);
  vec3 col = vec3(1.0, 0.98, 0.88);
  gl_FragColor = vec4(col, glow * vAlpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  colorSpace: typeof THREE.SRGBColorSpace | typeof THREE.NoColorSpace = THREE.SRGBColorSpace
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create canvas texture');
  draw(ctx, size);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = colorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function makeWetSandMaps(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const map = canvasTexture(512, (ctx, size) => {
    // Dark wet sand gradient
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#0c1218'); // Very wet shoreline
    grad.addColorStop(0.5, '#161c22');
    grad.addColorStop(1, '#1e2428'); // Drier upper beach
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Sand grain speckles
    for (let i = 0; i < 400; i++) {
      const tone = 25 + Math.random() * 35;
      ctx.fillStyle = `rgba(${tone}, ${tone + 4}, ${tone + 8}, ${0.1 + Math.random() * 0.2})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // Wet tidal water streaks
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = `rgba(180, 210, 240, ${0.03 + Math.random() * 0.06})`;
      ctx.fillRect(0, Math.random() * size, size, 2 + Math.random() * 6);
    }
  });

  const roughness = canvasTexture(
    256,
    (ctx, size) => {
      // High contrast: very glossy near shoreline (dark), rougher uphill (lighter)
      const grad = ctx.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, '#222222');
      grad.addColorStop(0.6, '#555555');
      grad.addColorStop(1, '#888888');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    },
    THREE.NoColorSpace
  );

  return { map, roughness };
}

function makeMoonTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    const center = size * 0.5;
    const grad = ctx.createRadialGradient(center, center, 0, center, center, center * 0.95);
    grad.addColorStop(0, 'rgba(255, 255, 240, 1.0)');
    grad.addColorStop(0.6, 'rgba(240, 245, 255, 0.95)');
    grad.addColorStop(0.85, 'rgba(200, 220, 255, 0.7)');
    grad.addColorStop(1, 'rgba(150, 180, 240, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle lunar mare spots
    ctx.fillStyle = 'rgba(180, 195, 215, 0.25)';
    ctx.beginPath();
    ctx.arc(center - 15, center - 10, 28, 0, Math.PI * 2);
    ctx.arc(center + 18, center + 12, 22, 0, Math.PI * 2);
    ctx.fill();
  });
}

export class MoonlitTide {
  private readonly runtime: SceneRuntime;
  private readonly energy = new AudioEnergySmoother({
    bass: 0.18,
    mid: 0.14,
    treble: 0.22,
    energy: 0.12,
    pulseDecay: 2.1,
  });

  private readonly sandMaps: { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture };
  private readonly moonMap: THREE.CanvasTexture;

  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly waterMesh: THREE.Mesh;
  private readonly moonLight: THREE.DirectionalLight;
  private readonly shoreLight: THREE.PointLight;

  private readonly sparkleGeom: THREE.BufferGeometry;
  private readonly sparkleMat: THREE.ShaderMaterial;
  private readonly sparklePositions: Float32Array;
  private readonly sparkleSizes: Float32Array;
  private readonly sparkleAlphas: Float32Array;
  private readonly sparkles: Sparkle[] = [];

  private simTime = 0;
  private qualityTier = 2;

  constructor(container: HTMLElement, options: SceneVisualizerOptions = {}) {
    this.runtime = new SceneRuntime(container, {
      onContextLost: options.onContextLost,
      fov: 44,
      near: 0.1,
      far: 60,
      cameraPosition: [0.2, 1.25, 3.8],
      target: [0, 0.35, 0.5],
      enablePan: false,
      minDistance: 1.5,
      maxDistance: 6.5,
      minPolarAngle: Math.PI * 0.15,
      maxPolarAngle: Math.PI * 0.76,
      dampingFactor: 0.07,
      background: 0x050810,
      fogDensity: 0.032,
      toneMappingExposure: 1.05,
      useEnvironment: true,
      environmentIntensity: 0.15,
      environmentBlur: 0.15,
      autoRotateSpeedScale: 0.55,
      onResize: () => this.frameTide(),
    });

    this.sandMaps = makeWetSandMaps();
    this.moonMap = makeMoonTexture();

    this.buildShoreline();
    this.buildSkyAndMoon();

    // Ocean Water Mesh
    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uMoonPos: { value: new THREE.Vector3(0.5, 6.0, -12.0) },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
        uHue: { value: 0 },
        uSat: { value: 0.3 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // High tessellation plane for wave displacement
    const waterGeom = new THREE.PlaneGeometry(16, 16, 128, 128);
    this.waterMesh = new THREE.Mesh(waterGeom, this.waterMaterial);
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.waterMesh.position.set(0, 0.08, -1.5);
    this.waterMesh.renderOrder = 2;
    this.runtime.scene.add(this.waterMesh);

    // Moonlight
    this.moonLight = new THREE.DirectionalLight(0xddeeff, 2.4);
    this.moonLight.position.set(0.5, 6.0, -12.0);
    this.runtime.scene.add(this.moonLight);

    this.shoreLight = new THREE.PointLight(0x446688, 1.2, 8.0, 1.5);
    this.shoreLight.position.set(0, 0.6, 2.2);
    this.runtime.scene.add(this.shoreLight);

    // Moonlight sparkles
    const spark = this.buildSparkles();
    this.sparkleGeom = spark.geometry;
    this.sparkleMat = spark.material;
    this.sparklePositions = spark.positions;
    this.sparkleSizes = spark.sizes;
    this.sparkleAlphas = spark.alphas;

    this.runtime.resize();
  }

  private buildShoreline(): void {
    const scene = this.runtime.scene;

    // Wet Sand Beach Plane
    const sandMat = new THREE.MeshStandardMaterial({
      map: this.sandMaps.map,
      roughnessMap: this.sandMaps.roughness,
      roughness: 0.45,
      metalness: 0.08,
      color: 0x222a30,
    });

    const sandGeom = new THREE.PlaneGeometry(18, 18, 48, 48);
    // Slope the sand gently up toward +Z
    const pos = sandGeom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getY(i);
      pos.setZ(i, Math.max(0, (z + 2.0) * 0.14));
    }
    sandGeom.computeVertexNormals();

    const sand = new THREE.Mesh(sandGeom, sandMat);
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, -0.05, 0);
    scene.add(sand);

    // Coastal Rocks / Pebbles
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x1c2228,
      roughness: 0.65,
      metalness: 0.1,
    });
    for (let i = 0; i < 18; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), rockMat);
      const r = 0.06 + Math.random() * 0.12;
      rock.scale.set(r * (1 + Math.random() * 0.4), r * 0.6, r * (1 + Math.random() * 0.4));
      rock.position.set((Math.random() - 0.5) * 6.5, r * 0.4, 2.0 + Math.random() * 2.2);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      scene.add(rock);
    }
  }

  private buildSkyAndMoon(): void {
    const scene = this.runtime.scene;

    // Night Sky Dome
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(25, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshBasicMaterial({ color: 0x040710, side: THREE.BackSide, fog: false })
    );
    sky.position.y = 0.0;
    scene.add(sky);

    // Luminous Moon Disc
    const moon = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({
        map: this.moonMap,
        transparent: true,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    moon.position.set(0.5, 6.2, -12.5);
    scene.add(moon);

    // Ambient Lighting
    scene.add(new THREE.AmbientLight(0x0c1424, 0.35));
    const hemi = new THREE.HemisphereLight(0x38557a, 0x08101a, 0.32);
    scene.add(hemi);

    // Starfield
    this.buildStars();
  }

  private buildStars(): void {
    const count = 130;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      const radius = 22.0;
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) + 1.0;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      const bright = 0.75 + Math.random() * 0.25;
      colors[i * 3] = bright * 0.9;
      colors[i * 3 + 1] = bright * 0.95;
      colors[i * 3 + 2] = bright;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(
      geom,
      new THREE.PointsMaterial({
        size: 0.045,
        vertexColors: true,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    stars.frustumCulled = false;
    this.runtime.scene.add(stars);
  }

  private buildSparkles(): {
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    positions: Float32Array;
    sizes: Float32Array;
    alphas: Float32Array;
  } {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_SPARKLES * 3);
    const sizes = new Float32Array(MAX_SPARKLES);
    const alphas = new Float32Array(MAX_SPARKLES);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: SPARKLE_VERT,
      fragmentShader: SPARKLE_FRAG,
      uniforms: {
        uPixelRatio: { value: this.runtime.currentPixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    this.runtime.scene.add(points);

    for (let i = 0; i < MAX_SPARKLES; i++) {
      this.sparkles.push({
        pos: new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.12, -0.5 - Math.random() * 4.5),
        life: Math.random() * 2.0,
        maxLife: 1.5 + Math.random() * 1.5,
        size: 0.02 + Math.random() * 0.035,
      });
    }
    return { geometry, material, positions, sizes, alphas };
  }

  private updateSparkles(dt: number, reduced: boolean): void {
    for (let i = 0; i < MAX_SPARKLES; i++) {
      const s = this.sparkles[i];
      if (!reduced) {
        s.life += dt * (1.0 + this.energy.treble * 2.0);
        if (s.life >= s.maxLife) {
          s.life = 0;
          // Spawn in the moonlight path corridor
          const z = -0.5 - Math.random() * 4.5;
          const spread = (Math.abs(z) / 5.0) * 1.2;
          s.pos.set((Math.random() - 0.5) * spread, 0.12 + Math.sin(this.simTime + i) * 0.04, z);
        }
      }

      const progress = s.life / s.maxLife;
      const alpha = Math.sin(progress * Math.PI) * (0.3 + this.energy.treble * 0.7);

      this.sparklePositions[i * 3] = s.pos.x;
      this.sparklePositions[i * 3 + 1] = s.pos.y;
      this.sparklePositions[i * 3 + 2] = s.pos.z;
      this.sparkleSizes[i] = s.size * (1.0 + this.energy.treble * 0.8);
      this.sparkleAlphas[i] = alpha;
    }

    this.sparkleGeom.getAttribute('position').needsUpdate = true;
    this.sparkleGeom.getAttribute('aSize').needsUpdate = true;
    this.sparkleGeom.getAttribute('aAlpha').needsUpdate = true;
    this.sparkleMat.uniforms.uPixelRatio.value = this.runtime.currentPixelRatio;
  }

  private frameTide(): void {
    this.runtime.controls.target.set(0, 0.35, 0.5);
    const vFov = THREE.MathUtils.degToRad(this.runtime.camera.fov);
    const aspect = Math.max(this.runtime.camera.aspect, 0.2);
    const fitH = 2.4;
    const fitW = 2.8;
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / (Math.tan(vFov / 2) * aspect);
    const dist = Math.max(distH, distW) * 1.1;

    const offset = this.runtime.camera.position.clone().sub(this.runtime.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0.2, 0.8, 3.2);
    offset.normalize().multiplyScalar(dist);
    this.runtime.camera.position.copy(this.runtime.controls.target).add(offset);
    this.runtime.controls.minDistance = dist * 0.45;
    this.runtime.controls.maxDistance = dist * 2.2;
  }

  public degradeQuality(): boolean {
    if (this.runtime.degradeQuality()) return true;
    if (this.qualityTier > 0) {
      this.qualityTier -= 1;
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

    // Update water uniforms
    const u = this.waterMaterial.uniforms;
    u.uCamPos.value.copy(this.runtime.camera.position);
    u.uTime.value = this.simTime;
    u.uBass.value = this.energy.bass;
    u.uMid.value = this.energy.mid;
    u.uTreble.value = this.energy.treble;
    u.uEnergy.value = this.energy.energy;
    u.uPulse.value = this.energy.heatPulse;
    u.uHue.value = settings.colorMode === 'spectrum' ? (this.energy.mid * 0.15) % 1 : 0;
    u.uSat.value = settings.colorMode === 'mono' ? 0.05 : 0.35;

    // Moonlight breathing intensity
    this.moonLight.intensity = 2.2 + this.energy.bass * 1.2 + this.energy.heatPulse * 0.6;
    this.shoreLight.intensity = 1.0 + this.energy.energy * 0.8;

    this.updateSparkles(dt, reduced);
    this.runtime.renderScene(now);
  }

  public destroy(): void {
    if (this.runtime.isDestroyed) return;
    this.sandMaps.map.dispose();
    this.sandMaps.roughness.dispose();
    this.moonMap.dispose();
    this.runtime.disposeSceneGraph();
    this.runtime.destroy();
  }
}
