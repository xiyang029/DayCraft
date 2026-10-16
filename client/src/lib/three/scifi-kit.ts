import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * 科幻 3D 视觉基建（工作分解 3D 世界与团队报告星图共用）。
 * 只放纯视觉效果：柔光粒子、辉光、尘埃、扫描环、Bloom、深空背景。
 * 业务逻辑（布局、拾取、数据映射）留在各自组件里。
 */

export const UP_AXIS = new THREE.Vector3(0, 1, 0);

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

/** 径向柔光贴图：节点光晕的基础（避免方块状点精灵）。 */
export function createGlowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.12, 'rgba(255, 255, 255, 0.72)');
    gradient.addColorStop(0.32, 'rgba(255, 255, 255, 0.26)');
    gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.06)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 圆形柔光点着色器：交互粒子、数据流、环境尘埃共用
const SOFT_POINT_VERTEX = /* glsl */ `
uniform float uPixelRatio;
uniform float uTime;
uniform float uDriftSpeed;
uniform vec2 uDriftRange;
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec3 p = position;
  if (uDriftSpeed > 0.0) {
    float span = max(0.001, uDriftRange.y - uDriftRange.x);
    p.y = mod(p.y - uDriftRange.x + uTime * uDriftSpeed, span) + uDriftRange.x;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(aSize * uPixelRatio * (300.0 / max(0.001, -mv.z)), 1.0, 72.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SOFT_POINT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float falloff = 1.0 - r2 * 4.0;
  float glow = falloff * falloff;
  float alpha = glow * vAlpha;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColor * (0.5 + 2.1 * glow), alpha);
}
`;

export function createSoftPointMaterial(
  pixelRatio: number,
  driftSpeed = 0,
  driftRange?: THREE.Vector2,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: pixelRatio },
      uTime: { value: 0 },
      uDriftSpeed: { value: driftSpeed },
      uDriftRange: { value: driftRange ?? new THREE.Vector2(0, 1) },
    },
    vertexShader: SOFT_POINT_VERTEX,
    fragmentShader: SOFT_POINT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export interface SkyBox {
  mesh: THREE.Mesh;
  dispose(): void;
}

/** 深空渐变背景球（不参与雾与色调映射）。 */
export function createSky(radius = 900): SkyBox {
  const geometry = new THREE.SphereGeometry(radius, 32, 24);
  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y * 0.5 + 0.5;
        vec3 bottom = vec3(0.012, 0.026, 0.075);
        vec3 middle = vec3(0.045, 0.078, 0.17);
        vec3 top = vec3(0.115, 0.06, 0.235);
        vec3 col = mix(bottom, middle, smoothstep(0.0, 0.55, h));
        col = mix(col, top, smoothstep(0.52, 1.0, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export interface DustField {
  points: THREE.Points;
  setTime(t: number): void;
  dispose(): void;
}

/** 环境尘埃：漂移在顶点着色器内完成，CPU 零开销。 */
export function createDustField(
  pixelRatio: number,
  count = 700,
  innerRadius = 40,
  outerRadius = 360,
  palette: string[] = ['#9fd8ff', '#c7b6ff', '#8ff2e0', '#ffffff'],
): DustField {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const r = innerRadius + Math.random() * (outerRadius - innerRadius);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.55;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const c = new THREE.Color(palette[Math.floor(Math.random() * palette.length)]);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    sizes[i] = 0.7 + Math.random() * 1.9;
    alphas[i] = 0.16 + Math.random() * 0.5;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  const material = createSoftPointMaterial(
    pixelRatio,
    1.4,
    new THREE.Vector2(-outerRadius * 0.55, outerRadius * 0.55),
  );
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    setTime(t: number) {
      material.uniforms.uTime.value = t;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export interface SparkSystem {
  points: THREE.Points;
  /** 发射单个粒子（位置/速度向量会被读取，不会被持有）。 */
  emit(position: THREE.Vector3, velocity: THREE.Vector3, color: THREE.Color, size: number, life: number): void;
  /** 径向爆发一批粒子。 */
  burst(point: THREE.Vector3, color: THREE.Color, count: number, power: number): void;
  update(dt: number): void;
  readonly active: number;
  dispose(): void;
}

/** 交互粒子池：固定内存，环形复用，单 draw call。 */
export function createSparkSystem(pixelRatio: number, maxSparks = 1600): SparkSystem {
  const positions = new Float32Array(maxSparks * 3);
  const colors = new Float32Array(maxSparks * 3);
  const sizes = new Float32Array(maxSparks);
  const alphas = new Float32Array(maxSparks);
  const baseSizes = new Float32Array(maxSparks);
  const velocities = new Float32Array(maxSparks * 3);
  const life = new Float32Array(maxSparks);
  const maxLife = new Float32Array(maxSparks);
  let active = 0;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const material = createSoftPointMaterial(pixelRatio);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  const emit = (
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    color: THREE.Color,
    size: number,
    lifeSpan: number,
  ) => {
    let i: number;
    if (active < maxSparks) {
      i = active;
      active += 1;
      geometry.setDrawRange(0, active);
    } else {
      // 池满时随机覆盖旧粒子，保证内存与 drawRange 恒定
      i = Math.floor(Math.random() * maxSparks);
    }
    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
    velocities[i * 3] = velocity.x;
    velocities[i * 3 + 1] = velocity.y;
    velocities[i * 3 + 2] = velocity.z;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    baseSizes[i] = size;
    sizes[i] = size;
    alphas[i] = 0;
    life[i] = lifeSpan;
    maxLife[i] = lifeSpan;
  };

  const burst = (point: THREE.Vector3, color: THREE.Color, count: number, power: number) => {
    for (let i = 0; i < count; i += 1) {
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      );
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      const speed = (0.9 + Math.random() * 2.6) * power;
      const tint = color.clone().lerp(new THREE.Color('#ffffff'), 0.15 + Math.random() * 0.6);
      emit(
        new THREE.Vector3(point.x + dir.x * 0.35, point.y + dir.y * 0.35, point.z + dir.z * 0.35),
        new THREE.Vector3(dir.x * speed, dir.y * speed + 0.5 * power, dir.z * speed),
        tint,
        0.9 + Math.random() * 1.8,
        0.7 + Math.random() * 0.9,
      );
    }
  };

  const swap = (from: number, to: number) => {
    for (let k = 0; k < 3; k += 1) {
      positions[to * 3 + k] = positions[from * 3 + k];
      colors[to * 3 + k] = colors[from * 3 + k];
      velocities[to * 3 + k] = velocities[from * 3 + k];
    }
    sizes[to] = sizes[from];
    alphas[to] = alphas[from];
    baseSizes[to] = baseSizes[from];
    life[to] = life[from];
    maxLife[to] = maxLife[from];
  };

  const update = (dt: number) => {
    if (active === 0) return;
    const damping = Math.exp(-dt * 1.7);
    let i = 0;
    while (i < active) {
      life[i] -= dt;
      if (life[i] <= 0) {
        active -= 1;
        if (i !== active) swap(active, i);
        continue;
      }
      const k = life[i] / maxLife[i];
      velocities[i * 3] *= damping;
      velocities[i * 3 + 1] = velocities[i * 3 + 1] * damping + dt * 0.55;
      velocities[i * 3 + 2] *= damping;
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      alphas[i] = Math.min(1, (1 - k) * 7) * k * k;
      sizes[i] = baseSizes[i] * (0.4 + 0.6 * k);
      i += 1;
    }
    geometry.setDrawRange(0, active);
    (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  };

  return {
    points,
    emit,
    burst,
    update,
    get active() {
      return active;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export interface ScanRings {
  group: THREE.Group;
  /** maxRadius 为环扩张到的最大半径；alpha 为主控透明度（入场动画用）。 */
  update(t: number, maxRadius: number, alpha: number): void;
  dispose(): void;
}

/** 能量脉冲扫描环：以原点为中心向外扩散。 */
export function createScanRings(
  colors: string[] = ['#38bdf8', '#a855f7', '#22d3ee'],
  y = -0.4,
): ScanRings {
  const geometry = new THREE.RingGeometry(1, 1.015, 160);
  const group = new THREE.Group();
  const rings = colors.map((color, index) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    group.add(mesh);
    return { mesh, material, offset: index / colors.length, speed: 0.085 };
  });
  return {
    group,
    update(t: number, maxRadius: number, alpha: number) {
      for (const ring of rings) {
        const p = (t * ring.speed + ring.offset) % 1;
        const s = 8 + p * maxRadius;
        ring.mesh.scale.set(s, s, 1);
        ring.material.opacity = (1 - p) * (1 - p) * 0.5 * alpha;
      }
    },
    dispose() {
      geometry.dispose();
      rings.forEach((ring) => ring.material.dispose());
    },
  };
}

export interface SciFiComposer {
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/**
 * 半分辨率 UnrealBloom 后处理（HDR + ACES）。
 * 任何一步失败都返回 null，调用方回退到普通 renderer.render（低配设备也可通过开关跳过）。
 */
export function createSciFiComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  pixelRatio: number,
  width: number,
  height: number,
  options: { strength?: number; radius?: number; threshold?: number } = {},
): SciFiComposer | null {
  try {
    const renderTarget = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
      type: THREE.HalfFloatType,
      samples: 2,
    });
    const composer = new EffectComposer(renderer, renderTarget);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(Math.max(1, width), Math.max(1, height));
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, width), Math.max(1, height)),
      options.strength ?? 0.62,
      options.radius ?? 0.72,
      options.threshold ?? 0.68,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    return {
      composer,
      bloomPass,
      setSize(w: number, h: number) {
        composer.setSize(Math.max(1, w), Math.max(1, h));
      },
      dispose() {
        composer.dispose();
        bloomPass.dispose();
      },
    };
  } catch {
    return null;
  }
}

/** 统一的科幻渲染器配置（像素比上限 1.75，避免高 DPI 下 GPU 压力）。 */
export function createSciFiRenderer(width: number, height: number): { renderer: THREE.WebGLRenderer; pixelRatio: number } {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(Math.max(1, width), Math.max(1, height));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return { renderer, pixelRatio };
}

/** 非负字符串哈希（布局/动画相位的确定性随机源）。 */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** 0~1 的确定性伪随机（同一 key 每次渲染结果一致，避免布局抖动）。 */
export function hashUnit(s: string, salt: number): number {
  return (hashString(`${s}#${salt}`) % 10000) / 10000;
}

export function truncateText(text: string, maxLength = 12): string {
  if (!text) return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}…` : text;
}

export interface LabelSpriteOptions {
  subtitle?: string;
  fontSize?: number;
  padX?: number;
  maxLength?: number;
}

/** Canvas 药丸文字精灵：节点上方的名称标签（3D 世界与团队星图共用同一风格）。 */
export function createLabelSprite(text: string, accent: string, opts: LabelSpriteOptions = {}): THREE.Sprite {
  const { subtitle, fontSize = 50, padX = 76, maxLength = 12 } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = subtitle ? 176 : 128;
  const ctx = canvas.getContext('2d');
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 }),
  );
  if (ctx) {
    const label = truncateText(text, maxLength);
    ctx.font = `600 ${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    const textWidth = Math.min(ctx.measureText(label).width, 430);
    const pillW = textWidth + padX;
    const pillH = subtitle ? 130 : 82;
    const x = (512 - pillW) / 2;
    const y = (canvas.height - pillH) / 2;
    const fill = ctx.createLinearGradient(0, y, 0, y + pillH);
    fill.addColorStop(0, 'rgba(12, 20, 38, 0.9)');
    fill.addColorStop(1, 'rgba(5, 9, 20, 0.72)');
    ctx.fillStyle = fill;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.roundRect(x, y, pillW, pillH, 22);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eaf2ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 256, subtitle ? y + 44 : canvas.height / 2);
    if (subtitle) {
      ctx.font = '400 34px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(190, 214, 255, 0.9)';
      ctx.fillText(subtitle, 256, y + 96);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  sprite.material.map = texture;
  sprite.material.needsUpdate = true;
  if (subtitle) {
    const aspect = canvas.height / 512;
    sprite.scale.set(6.6, 6.6 * aspect, 1);
  } else {
    sprite.scale.set(7.2, 1.8, 1);
  }
  return sprite;
}
