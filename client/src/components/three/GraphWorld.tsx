import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Pause as PauseIcon,
  Play as PlayIcon,
  RotateCcw as RotateCcwIcon,
  Sparkles as SparklesIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from 'lucide-react';
import {
  UP_AXIS,
  createDustField,
  createGlowTexture,
  createLabelSprite,
  createScanRings,
  createSciFiComposer,
  createSciFiRenderer,
  createSky,
  createSoftPointMaterial,
  createSparkSystem,
  easeOutCubic,
  hashUnit,
  type LabelSpriteOptions,
  type SciFiComposer,
} from '@/lib/three/scifi-kit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * 科幻图谱 3D 引擎（工作分解 3D 世界与团队报告星图共用）。
 * 调用方只负责语义层：节点/边数据（位置、半径、颜色、权重）+ 图例/详情卡片；
 * 引擎负责渲染层：场景、节点工厂、曲线边、流光、拾取、相机、动画、工具栏。
 */

export interface GraphWorldNodeInput {
  key: string;
  /** 节点标签（null 则无标签精灵）。 */
  label: string | null;
  sublabel?: string;
  /** 标签描边色（缺省用节点色）。 */
  labelAccent?: string;
  base: THREE.Vector3;
  radius: number;
  color: string;
  /** 0~1，辉光基线（团队星图用活跃度驱动，工作分解缺省 0）。 */
  activity?: number;
}

export interface GraphWorldEdgeInput {
  a: string;
  b: string;
  /** 确定性随机的盐（perpendicular/流动相位用）。 */
  salt: string;
  /** 边的基准色（调用方按权重预计算，压暗模式下会按亮度缩放）。 */
  color: string;
  /** 被选中关联时的目标亮度，默认 1（团队核心边传 0.75）。 */
  highlightLevel?: number;
}

export interface GraphWorldVisuals {
  fogDensity?: number;
  cameraFar?: number;
  minDistance?: number;
  maxDistance?: number;
  rotateSpeed?: number;
  hemiIntensity?: number;
  dirIntensity?: number;
  dirPosition?: [number, number, number];
  coreLightColor?: string;
  coreLightIntensity?: number;
  coreLightDistance?: number;
  skyRadius?: number;
  dustCount?: number;
  dustInner?: number;
  dustOuter?: number;
  scanColors?: string[];
  scanY?: number;
  scanRadius?: number | ((sphereRadius: number) => number);
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  edgeSegments?: number;
  maxSparks?: number;
  introDuration?: number;
  glowFactor?: number;
  glowBoostFactor?: number;
  labelLift?: number;
  labelStyle?: LabelSpriteOptions;
  homeMinDistance?: number;
  homeDistanceFactor?: number;
  homeDir?: [number, number, number];
  introStartScale?: number;
  introSpin?: number;
}

export interface GraphWorldProps {
  nodes: GraphWorldNodeInput[];
  edges: GraphWorldEdgeInput[];
  selectedKey: string | null;
  hoveredKey: string | null;
  onPick: (key: string | null) => void;
  onHoverKeyChange: (key: string | null) => void;
  /** 哪些节点可被选中（团队核心点击视为取消，工作分解全部可选）。 */
  isPickableKey?: (key: string) => boolean;
  /** 是否压暗无关节点/边（团队星图开，工作分解关）。 */
  dimUnrelated?: boolean;
  visuals?: GraphWorldVisuals;
  /** 地面网格（缺省按节点最低点 -9、尺寸 300、工作分解样式）。 */
  grid?: { size?: number; y?: number; opacity?: number };
  toolbarBadge: ReactNode;
  legend: ReactNode;
  viewportClassName?: string;
  children?: ReactNode;
}

const DEFAULT_VIEWPORT_CLASS =
  'h-[calc(100dvh-300px)] min-h-120 w-full bg-[#050a18] sm:h-[calc(100dvh-250px)] lg:h-[calc(100dvh-225px)]';

interface SceneNode {
  key: string;
  base: THREE.Vector3;
  radius: number;
  color: THREE.Color;
  activity: number;
  phase: number;
  bobAmp: number;
  bobSpeed: number;
  dirX: number;
  dirZ: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  glow: THREE.Sprite;
  glowMaterial: THREE.SpriteMaterial;
  label: THREE.Sprite | null;
  labelMaterial: THREE.SpriteMaterial | null;
  scale: number;
  emissive: number;
}

interface SceneEdge {
  a: number;
  b: number;
  perp: THREE.Vector3;
  lift: THREE.Vector3;
  phase: number;
  wobbleSpeed: number;
  wobbleAmp: number;
  flowSpeed: number;
  flowOffset: number;
  highlightLevel: number;
  brightness: number;
}

export default function GraphWorld({
  nodes: nodeInputs,
  edges: edgeInputs,
  selectedKey,
  hoveredKey,
  onPick,
  onHoverKeyChange,
  isPickableKey,
  dimUnrelated = false,
  visuals = {},
  grid: gridProp,
  toolbarBadge,
  legend,
  viewportClassName = DEFAULT_VIEWPORT_CLASS,
  children,
}: GraphWorldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const homeRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  const [autoRotate, setAutoRotate] = useState(true);
  const [bloomEnabled, setBloomEnabled] = useState(true);
  const hoveredKeyRef = useRef<string | null>(null);
  const selectedKeyRef = useRef<string | null>(null);
  const autoRotateRef = useRef(true);
  const bloomEnabledRef = useRef(true);
  const onPickRef = useRef(onPick);
  const onHoverKeyChangeRef = useRef(onHoverKeyChange);
  const isPickableKeyRef = useRef(isPickableKey);
  hoveredKeyRef.current = hoveredKey;
  selectedKeyRef.current = selectedKey;
  autoRotateRef.current = autoRotate;
  bloomEnabledRef.current = bloomEnabled;
  onPickRef.current = onPick;
  onHoverKeyChangeRef.current = onHoverKeyChange;
  isPickableKeyRef.current = isPickableKey;

  useEffect(() => {
    if (containerRef.current) {
      const canvas = containerRef.current.querySelector('canvas');
      if (canvas) canvas.style.cursor = hoveredKey || selectedKey ? 'pointer' : 'grab';
    }
  }, [hoveredKey, selectedKey]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) controls.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || nodeInputs.length === 0) return;

    const v = visuals;
    const EDGE_SEGMENTS = v.edgeSegments ?? 8;
    const MAX_SPARKS = v.maxSparks ?? 1600;
    const INTRO_DURATION = v.introDuration ?? 2.0;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    // ---------- 渲染器 / 场景 / 相机 ----------
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#050a18', v.fogDensity ?? 0.0021);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, v.cameraFar ?? 2000);
    cameraRef.current = camera;

    const { renderer, pixelRatio } = createSciFiRenderer(width, height);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = v.minDistance ?? 5;
    controls.maxDistance = v.maxDistance ?? 180;
    controls.autoRotate = true;
    controls.autoRotateSpeed = v.rotateSpeed ?? 0.55;
    controlsRef.current = controls;

    // ---------- 后处理：轻量 Bloom（半分辨率，可一键关闭） ----------
    let composer: SciFiComposer | null = createSciFiComposer(renderer, scene, camera, pixelRatio, width, height, {
      strength: v.bloomStrength ?? 0.62,
      radius: v.bloomRadius ?? 0.72,
      threshold: v.bloomThreshold ?? 0.68,
    });

    // ---------- 深空背景 ----------
    const sky = createSky(v.skyRadius ?? 900);
    scene.add(sky.mesh);

    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x111a2e, v.hemiIntensity ?? 0.9));
    const directional = new THREE.DirectionalLight(0xffffff, v.dirIntensity ?? 1.25);
    const dirPos = v.dirPosition ?? [30, 50, 20];
    directional.position.set(dirPos[0], dirPos[1], dirPos[2]);
    scene.add(directional);

    // ---------- 世界分组（整体缓慢自转 → 节点与连线一起动） ----------
    const worldGroup = new THREE.Group();
    scene.add(worldGroup);

    const glowTexture = createGlowTexture();
    const sphereGeometries = new Map<number, THREE.SphereGeometry>();
    const geometryFor = (radius: number): THREE.SphereGeometry => {
      const rounded = Math.round(radius * 20) / 20;
      const cached = sphereGeometries.get(rounded);
      if (cached) return cached;
      const geometry = new THREE.SphereGeometry(rounded, 40, 28);
      sphereGeometries.set(rounded, geometry);
      return geometry;
    };

    // ---------- 节点 ----------
    const nodeIndexOf = new Map<string, number>();
    const nodes: SceneNode[] = [];
    const glowFactor = v.glowFactor ?? 6.4;
    for (const input of nodeInputs) {
      const color = new THREE.Color(input.color);
      const radius = input.radius;
      const base = input.base;
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.4,
        roughness: 0.28,
        metalness: 0.35,
      });
      const mesh = new THREE.Mesh(geometryFor(radius), material);
      mesh.position.copy(base);
      mesh.userData.nodeKey = input.key;
      worldGroup.add(mesh);

      const glowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.55,
      });
      const glow = new THREE.Sprite(glowMaterial);
      const glowSize = radius * glowFactor;
      glow.scale.set(glowSize, glowSize, 1);
      glow.position.copy(base);
      worldGroup.add(glow);

      let label: THREE.Sprite | null = null;
      if (input.label) {
        label = createLabelSprite(input.label, input.labelAccent ?? input.color, {
          ...(v.labelStyle ?? {}),
          ...(input.sublabel ? { subtitle: input.sublabel } : {}),
        });
        label.position.copy(base).add(new THREE.Vector3(0, radius + (v.labelLift ?? 1.7), 0));
        worldGroup.add(label);
      }

      const dir = new THREE.Vector3(base.x, 0, base.z);
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
      dir.normalize();

      nodeIndexOf.set(input.key, nodes.length);
      nodes.push({
        key: input.key,
        base,
        radius,
        color,
        activity: input.activity ?? 0,
        phase: hashUnit(input.key, 1) * Math.PI * 2,
        bobAmp: 0.25 + hashUnit(input.key, 2) * 0.6,
        bobSpeed: 0.42 + hashUnit(input.key, 3) * 0.65,
        dirX: dir.x,
        dirZ: dir.z,
        mesh,
        material,
        glow,
        glowMaterial,
        label,
        labelMaterial: label ? (label.material as THREE.SpriteMaterial) : null,
        scale: 1,
        emissive: 0.4,
      });
    }

    const coreLight = new THREE.PointLight(
      v.coreLightColor ?? '#6ab0ff',
      v.coreLightIntensity ?? 90,
      v.coreLightDistance ?? 160,
    );
    coreLight.position.set(0, 0, 0);
    scene.add(coreLight);

    // ---------- 动态连线（每帧重算曲线，线不固定） ----------
    const edges: SceneEdge[] = [];
    for (const input of edgeInputs) {
      const ai = nodeIndexOf.get(input.a);
      const bi = nodeIndexOf.get(input.b);
      if (ai === undefined || bi === undefined) continue;
      const a = nodes[ai];
      const b = nodes[bi];
      const along = b.base.clone().sub(a.base);
      if (along.lengthSq() < 1e-6) continue;
      along.normalize();
      const perp = new THREE.Vector3().crossVectors(along, UP_AXIS);
      if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
      perp.normalize();
      const lift = new THREE.Vector3().crossVectors(along, perp).normalize();
      const r1 = hashUnit(input.salt, 11);
      const r2 = hashUnit(input.salt, 12);
      edges.push({
        a: ai,
        b: bi,
        perp,
        lift,
        phase: r1 * Math.PI * 2,
        wobbleSpeed: 0.5 + r2 * 0.9,
        wobbleAmp: 0.42 + r1 * 0.75,
        flowSpeed: 0.16 + r2 * 0.24,
        flowOffset: r1,
        highlightLevel: input.highlightLevel ?? 1,
        brightness: dimUnrelated ? 0.2 : 1,
      });
    }

    const edgeVertexCount = edges.length * EDGE_SEGMENTS * 2;
    const linePositions = new Float32Array(edgeVertexCount * 3);
    const lineColors = new Float32Array(edgeVertexCount * 3);
    const lineBaseColors = new Float32Array(edges.length * 3);
    let lines: THREE.LineSegments | null = null;
    let lineGeometry: THREE.BufferGeometry | null = null;
    let lineMaterial: THREE.LineBasicMaterial | null = null;
    const curvePoint = new Float32Array((EDGE_SEGMENTS + 1) * 3);

    if (edges.length > 0) {
      // 边颜色按输入逐边写入（静态初始化，压暗模式下每帧按 brightness 重算）
      for (let ei = 0; ei < edges.length; ei += 1) {
        const base = new THREE.Color();
        // 按输入顺序与有效边对齐：用边两端节点 key 反查输入颜色
        const aKey = nodes[edges[ei].a].key;
        const bKey = nodes[edges[ei].b].key;
        const found = edgeInputs.find((e) => e.a === aKey && e.b === bKey);
        base.set(found?.color ?? '#8ab4ff');
        lineBaseColors[ei * 3] = base.r;
        lineBaseColors[ei * 3 + 1] = base.g;
        lineBaseColors[ei * 3 + 2] = base.b;
        const dim = dimUnrelated ? 0.35 : 1;
        for (let s = 0; s < EDGE_SEGMENTS * 2; s += 1) {
          const vi = (ei * EDGE_SEGMENTS * 2 + s) * 3;
          lineColors[vi] = base.r * dim;
          lineColors[vi + 1] = base.g * dim;
          lineColors[vi + 2] = base.b * dim;
        }
      }
      lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
      lineGeometry.setAttribute(
        'color',
        new THREE.BufferAttribute(lineColors, 3).setUsage(dimUnrelated ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage),
      );
      lineMaterial = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.52,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      lines = new THREE.LineSegments(lineGeometry, lineMaterial);
      lines.frustumCulled = false;
      worldGroup.add(lines);
    }

    // ---------- 数据流光点：沿连线流动 ----------
    let flowPoints: THREE.Points | null = null;
    let flowGeometry: THREE.BufferGeometry | null = null;
    let flowMaterial: THREE.ShaderMaterial | null = null;
    let flowPositions: Float32Array | null = null;
    if (edges.length > 0) {
      flowPositions = new Float32Array(edges.length * 3);
      const flowColors = new Float32Array(edges.length * 3);
      const flowSizes = new Float32Array(edges.length);
      const flowAlphas = new Float32Array(edges.length);
      const white = new THREE.Color('#ffffff');
      for (let ei = 0; ei < edges.length; ei += 1) {
        const c = new THREE.Color(lineBaseColors[ei * 3], lineBaseColors[ei * 3 + 1], lineBaseColors[ei * 3 + 2]).lerp(
          white,
          0.55,
        );
        flowColors[ei * 3] = c.r;
        flowColors[ei * 3 + 1] = c.g;
        flowColors[ei * 3 + 2] = c.b;
        flowSizes[ei] = 1.5 + hashUnit(String(ei), 21) * 1.3;
        flowAlphas[ei] = 0.85;
      }
      flowGeometry = new THREE.BufferGeometry();
      flowGeometry.setAttribute('position', new THREE.BufferAttribute(flowPositions, 3).setUsage(THREE.DynamicDrawUsage));
      flowGeometry.setAttribute('aColor', new THREE.BufferAttribute(flowColors, 3));
      flowGeometry.setAttribute('aSize', new THREE.BufferAttribute(flowSizes, 1));
      flowGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(flowAlphas, 1));
      flowMaterial = createSoftPointMaterial(pixelRatio);
      flowPoints = new THREE.Points(flowGeometry, flowMaterial);
      flowPoints.frustumCulled = false;
      worldGroup.add(flowPoints);
    }

    // ---------- 环境尘埃（GPU 内漂移）与能量扫描环 ----------
    const dust = createDustField(pixelRatio, v.dustCount ?? 700, v.dustInner ?? 40, v.dustOuter ?? 360);
    scene.add(dust.points);

    // ---------- 相机初始机位（按节点包围球适配） ----------
    const bounding = new THREE.Box3();
    for (const input of nodeInputs) bounding.expandByPoint(input.base);
    bounding.expandByScalar(6);
    const sphere = bounding.getBoundingSphere(new THREE.Sphere());
    const focusCenter = sphere.center.clone();
    const homeDistance = Math.max(v.homeMinDistance ?? 30, sphere.radius * (v.homeDistanceFactor ?? 2.05));
    const homeDir = v.homeDir ?? [0.7, 0.5, 1];
    const homePosition = new THREE.Vector3(
      sphere.center.x + homeDistance * homeDir[0],
      sphere.center.y + homeDistance * homeDir[1],
      sphere.center.z + homeDistance * homeDir[2],
    );
    const homeOffset = homePosition.clone().sub(focusCenter);
    camera.position.copy(focusCenter).addScaledVector(homeOffset, 0.42);
    controls.target.copy(focusCenter);
    homeRef.current = { position: homePosition.clone(), target: focusCenter.clone() };
    controls.update();

    const scanRadiusRaw = v.scanRadius;
    const scanRadius =
      typeof scanRadiusRaw === 'function' ? scanRadiusRaw(sphere.radius) : (scanRadiusRaw ?? sphere.radius * 1.5 + 16);
    const scanRings = createScanRings(v.scanColors, v.scanY);
    scene.add(scanRings.group);

    // ---------- 交互粒子（鼠标掠过 + 点击爆发） ----------
    const sparks = createSparkSystem(pixelRatio, MAX_SPARKS);
    scene.add(sparks.points);

    // ---------- 地面网格 ----------
    let minY = 0;
    for (const input of nodeInputs) {
      minY = Math.min(minY, input.base.y);
    }
    const grid = new THREE.GridHelper(gridProp?.size ?? 300, 60, 0x2f4a7a, 0x16203a);
    grid.position.y = gridProp?.y ?? minY - 9;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = gridProp?.opacity ?? 0.4;
    scene.add(grid);

    // ---------- 交互 ----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointerPlane = new THREE.Plane();
    const cameraDir = new THREE.Vector3();
    const worldPoint = new THREE.Vector3();
    const emitPos = new THREE.Vector3();
    const emitVel = new THREE.Vector3();
    const nodeMeshes = nodes.map((n) => n.mesh);

    const pickKey = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeMeshes, false);
      if (hits.length === 0) return null;
      return (hits[0].object.userData.nodeKey as string | undefined) ?? null;
    };

    // 指针在“面向相机、过场景中心”平面上的落点 → 粒子在该处生成
    const worldPointFromPointer = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      camera.getWorldDirection(cameraDir).negate();
      pointerPlane.setFromNormalAndCoplanarPoint(cameraDir, focusCenter);
      const hit = raycaster.ray.intersectPlane(pointerPlane, worldPoint);
      return hit ? worldPoint : null;
    };

    const trailColor = new THREE.Color('#7dd3fc');
    const trailTintFallback = new THREE.Color('#c4b5fd');
    let lastTrailAt = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let hasPointer = false;

    const handlePointerMove = (event: PointerEvent) => {
      const key = pickKey(event.clientX, event.clientY);
      if (key !== hoveredKeyRef.current) {
        onHoverKeyChangeRef.current(key);
      }
      // 鼠标掠过：沿路径撒出细碎光子
      const now = performance.now() / 1000;
      const moved = hasPointer ? Math.hypot(event.clientX - lastPointerX, event.clientY - lastPointerY) : 0;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      hasPointer = true;
      if (now - lastTrailAt < 0.035 || moved < 1.5) return;
      lastTrailAt = now;
      const point = worldPointFromPointer(event.clientX, event.clientY);
      if (!point) return;
      const hoverTint = key !== null && nodeIndexOf.get(key) !== undefined
        ? nodes[nodeIndexOf.get(key) as number].color
        : trailTintFallback;
      const count = moved > 26 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const tint = trailColor.clone().lerp(hoverTint, Math.random() * 0.7);
        emitPos.set(
          point.x + (Math.random() - 0.5) * 0.9,
          point.y + (Math.random() - 0.5) * 0.9,
          point.z + (Math.random() - 0.5) * 0.9,
        );
        emitVel.set(
          (Math.random() - 0.5) * 0.9,
          0.35 + Math.random() * 0.7,
          (Math.random() - 0.5) * 0.9,
        );
        sparks.emit(emitPos, emitVel, tint, 0.7 + Math.random() * 1.4, 0.75 + Math.random() * 0.85);
      }
    };

    let downX = 0;
    let downY = 0;
    const handlePointerDown = (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
    };
    // 区分点击与拖拽旋转：只有小位移才视为选中
    const handlePointerUp = (event: PointerEvent) => {
      const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
      if (moved > 6) return;
      const key = pickKey(event.clientX, event.clientY);
      const origin = new THREE.Vector3();
      if (key && (isPickableKeyRef.current?.(key) ?? true)) {
        const idx = nodeIndexOf.get(key);
        onPickRef.current(key);
        if (idx !== undefined) {
          worldGroup.updateMatrixWorld();
          origin.copy(nodes[idx].mesh.position);
          worldGroup.localToWorld(origin);
          sparks.burst(origin, nodes[idx].color.clone(), 34, 1.15);
          return;
        }
      } else {
        // 空白或不可选节点：取消选中
        if (key) {
          const idx = nodeIndexOf.get(key);
          if (idx !== undefined) {
            worldGroup.updateMatrixWorld();
            origin.copy(nodes[idx].mesh.position);
            worldGroup.localToWorld(origin);
            sparks.burst(origin, nodes[idx].color.clone(), 30, 1.15);
          }
        } else {
          const point = worldPointFromPointer(event.clientX, event.clientY);
          if (point) {
            sparks.burst(point.clone(), new THREE.Color('#8ab4ff'), 18, 0.8);
          }
        }
        onPickRef.current(null);
        return;
      }
      const point = worldPointFromPointer(event.clientX, event.clientY);
      if (point) {
        sparks.burst(point.clone(), new THREE.Color('#8ab4ff'), 18, 0.8);
      }
    };
    const handlePointerLeave = () => {
      onHoverKeyChangeRef.current(null);
      hasPointer = false;
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer?.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    // ---------- 每帧更新 ----------
    let intro = 0;
    let introSettled = false;
    let worldAngle = 0;
    let lastSelectedEmit = 0;
    const tmpVec = new THREE.Vector3();
    const tmpColor = new THREE.Color();
    const neighborKeys = new Set<string>();
    const glowBoostFactor = v.glowBoostFactor ?? 2.4;

    const updateNodes = (dt: number, t: number, introEase: number, activeKey: string | null) => {
      if (dimUnrelated) {
        neighborKeys.clear();
        if (activeKey) {
          neighborKeys.add(activeKey);
          for (const edge of edges) {
            const aKey = nodes[edge.a].key;
            const bKey = nodes[edge.b].key;
            if (aKey === activeKey) neighborKeys.add(bKey);
            if (bKey === activeKey) neighborKeys.add(aKey);
          }
        }
      }

      for (const node of nodes) {
        const bob = Math.sin(t * node.bobSpeed + node.phase) * node.bobAmp * introEase;
        const sway = Math.sin(t * node.bobSpeed * 0.63 + node.phase * 1.7) * 0.16 * introEase;
        const pulse = 1 + Math.sin(t * 0.42 + node.phase * 0.5) * 0.022 * introEase;
        const px = node.base.x * pulse * introEase + node.dirX * sway;
        const pz = node.base.z * pulse * introEase + node.dirZ * sway;
        const py = node.base.y * introEase + bob;
        node.mesh.position.set(px, py, pz);
        node.glow.position.set(px, py, pz);
        if (node.label) {
          node.label.position.set(px, py + node.radius + (v.labelLift ?? 1.7), pz);
        }

        // 高亮平滑过渡（选中 > 悬浮/相邻 > 默认；压暗模式下无关节点下沉）
        let targetScale = 1;
        let targetEmissive = 0.4 + node.activity * 0.35;
        if (dimUnrelated) {
          if (activeKey && node.key === activeKey) {
            targetScale = 1.4;
            targetEmissive = 1.45;
          } else if (activeKey && neighborKeys.has(node.key)) {
            targetScale = 1.16;
            targetEmissive = 0.95;
          } else if (activeKey) {
            targetEmissive = 0.24;
          }
          if (node.labelMaterial) {
            node.labelMaterial.opacity = introEase * (activeKey === null || neighborKeys.has(node.key) ? 0.92 : 0.25);
          }
        } else {
          if (node.key === selectedKeyRef.current) {
            targetScale = 1.34;
            targetEmissive = 1.35;
          } else if (node.key === hoveredKeyRef.current) {
            targetScale = 1.18;
            targetEmissive = 0.95;
          }
          if (node.labelMaterial) {
            node.labelMaterial.opacity = introEase * 0.95;
          }
        }
        const k = 1 - Math.exp(-dt * 9);
        node.scale += (targetScale - node.scale) * k;
        node.emissive += (targetEmissive - node.emissive) * k;
        const breath = 1 + Math.sin(t * 1.7 + node.phase) * 0.035;
        node.mesh.scale.setScalar(node.scale * breath);
        node.material.emissiveIntensity = node.emissive;
        const glowBoost = THREE.MathUtils.clamp((node.emissive - 0.4) * 0.8, 0, 1);
        node.glowMaterial.opacity = (0.42 + glowBoost * 0.5 + Math.sin(t * 1.4 + node.phase) * 0.06) * introEase;
        const glowScale = node.radius * (glowFactor + glowBoost * glowBoostFactor)
          * (1 + Math.sin(t * 1.1 + node.phase) * 0.05) * introEase;
        node.glow.scale.set(glowScale, glowScale, 1);
      }
    };

    const updateEdges = (t: number, activeKey: string | null) => {
      if (!lineGeometry || !lines || edges.length === 0) return;
      for (let ei = 0; ei < edges.length; ei += 1) {
        const edge = edges[ei];
        const a = nodes[edge.a].mesh.position;
        const b = nodes[edge.b].mesh.position;
        const wobble = Math.sin(t * edge.wobbleSpeed + edge.phase) * edge.wobbleAmp;
        const liftWobble = Math.cos(t * edge.wobbleSpeed * 0.77 + edge.phase * 1.7) * edge.wobbleAmp * 0.65;
        const mx = (a.x + b.x) * 0.5 + edge.perp.x * wobble + edge.lift.x * liftWobble;
        const my = (a.y + b.y) * 0.5 + edge.perp.y * wobble + edge.lift.y * liftWobble;
        const mz = (a.z + b.z) * 0.5 + edge.perp.z * wobble + edge.lift.z * liftWobble;
        for (let s = 0; s <= EDGE_SEGMENTS; s += 1) {
          const u = s / EDGE_SEGMENTS;
          const iu = 1 - u;
          curvePoint[s * 3] = iu * iu * a.x + 2 * iu * u * mx + u * u * b.x;
          curvePoint[s * 3 + 1] = iu * iu * a.y + 2 * iu * u * my + u * u * b.y;
          curvePoint[s * 3 + 2] = iu * iu * a.z + 2 * iu * u * mz + u * u * b.z;
        }
        if (dimUnrelated) {
          // 高亮相关边，压暗其余（平滑过渡）
          const connected = !activeKey || nodes[edge.a].key === activeKey || nodes[edge.b].key === activeKey;
          const targetBrightness = connected ? edge.highlightLevel : 0.06;
          edge.brightness += (targetBrightness - edge.brightness) * 0.12;
          for (let s = 0; s < EDGE_SEGMENTS * 2; s += 1) {
            const vi = (ei * EDGE_SEGMENTS * 2 + s) * 3;
            lineColors[vi] = lineBaseColors[ei * 3] * edge.brightness;
            lineColors[vi + 1] = lineBaseColors[ei * 3 + 1] * edge.brightness;
            lineColors[vi + 2] = lineBaseColors[ei * 3 + 2] * edge.brightness;
          }
        }
        for (let s = 0; s < EDGE_SEGMENTS; s += 1) {
          const base = (ei * EDGE_SEGMENTS + s) * 6;
          linePositions[base] = curvePoint[s * 3];
          linePositions[base + 1] = curvePoint[s * 3 + 1];
          linePositions[base + 2] = curvePoint[s * 3 + 2];
          linePositions[base + 3] = curvePoint[(s + 1) * 3];
          linePositions[base + 4] = curvePoint[(s + 1) * 3 + 1];
          linePositions[base + 5] = curvePoint[(s + 1) * 3 + 2];
        }
        if (flowPositions) {
          const u = (t * edge.flowSpeed + edge.flowOffset) % 1;
          const f = u * EDGE_SEGMENTS;
          const si = Math.min(EDGE_SEGMENTS - 1, Math.floor(f));
          const lt = f - si;
          flowPositions[ei * 3] = curvePoint[si * 3] + (curvePoint[(si + 1) * 3] - curvePoint[si * 3]) * lt;
          flowPositions[ei * 3 + 1] = curvePoint[si * 3 + 1] + (curvePoint[(si + 1) * 3 + 1] - curvePoint[si * 3 + 1]) * lt;
          flowPositions[ei * 3 + 2] = curvePoint[si * 3 + 2] + (curvePoint[(si + 1) * 3 + 2] - curvePoint[si * 3 + 2]) * lt;
        }
      }
      (lineGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      if (dimUnrelated) {
        (lineGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      }
      if (flowGeometry) {
        (flowGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
    };

    let rafId = 0;
    const clock = new THREE.Clock();
    let elapsed = 0;

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;

      // 入场：相机推进 + 节点从中心生长（进入视图自动播放）
      if (intro < 1) {
        intro = Math.min(1, intro + dt / INTRO_DURATION);
        const e = easeOutCubic(intro);
        const rotated = homeOffset.clone().applyAxisAngle(UP_AXIS, (1 - e) * (v.introSpin ?? -0.85));
        camera.position.copy(focusCenter).addScaledVector(rotated, (v.introStartScale ?? 0.4) + (1 - (v.introStartScale ?? 0.4)) * e);
        controls.autoRotate = false;
      } else if (!introSettled) {
        introSettled = true;
        controls.autoRotate = autoRotateRef.current;
      }
      const introEase = easeOutCubic(intro);

      worldAngle += dt * 0.055;
      worldGroup.rotation.y = worldAngle;

      const activeKey = selectedKeyRef.current ?? hoveredKeyRef.current;
      updateNodes(dt, elapsed, introEase, activeKey);
      updateEdges(elapsed, activeKey);

      // 选中节点持续迸发粒子
      if (intro >= 1 && selectedKeyRef.current) {
        const idx = nodeIndexOf.get(selectedKeyRef.current);
        if (idx !== undefined && elapsed - lastSelectedEmit > 0.085) {
          lastSelectedEmit = elapsed;
          worldGroup.updateMatrixWorld();
          tmpVec.copy(nodes[idx].mesh.position);
          worldGroup.localToWorld(tmpVec);
          sparks.burst(tmpVec, tmpColor.copy(nodes[idx].color), 2, 0.55);
        }
      }

      sparks.update(dt);
      if (flowMaterial) flowMaterial.uniforms.uTime.value = elapsed;
      dust.setTime(elapsed);
      dust.points.rotation.y = elapsed * 0.006;
      scanRings.update(elapsed, scanRadius, introEase);

      controls.update();
      if (composer && bloomEnabledRef.current) {
        composer.composer.render(dt);
      } else {
        renderer.render(scene, camera);
      }
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      controls.dispose();
      composer?.dispose();
      for (const node of nodes) {
        node.material.dispose();
        node.glowMaterial.dispose();
        node.labelMaterial?.map?.dispose();
        node.labelMaterial?.dispose();
      }
      sphereGeometries.forEach((geometry) => geometry.dispose());
      glowTexture.dispose();
      sky.dispose();
      dust.dispose();
      sparks.dispose();
      scanRings.dispose();
      lineGeometry?.dispose();
      lineMaterial?.dispose();
      flowGeometry?.dispose();
      flowMaterial?.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      controlsRef.current = null;
      cameraRef.current = null;
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [nodeInputs, edgeInputs]);

  const handleResetView = () => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    const home = homeRef.current;
    if (!controls || !camera || !home) return;
    camera.position.copy(home.position);
    controls.target.copy(home.target);
    controls.update();
  };

  const handleZoom = (factor: number) => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;
    const offset = camera.position.clone().sub(controls.target);
    const nextLength = THREE.MathUtils.clamp(
      offset.length() * factor,
      controls.minDistance,
      controls.maxDistance,
    );
    offset.setLength(nextLength);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  };

  return (
    <Card className="relative w-full overflow-hidden [--card-spacing:0px]">
      <div ref={containerRef} className={viewportClassName} />

      {/* 工具栏：视角与特效 */}
      <Card className="absolute top-4 left-4 z-10 p-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="放大" title="放大（滚轮上滚）" onClick={() => handleZoom(0.8)}>
            <ZoomInIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="缩小" title="缩小（滚轮下滚）" onClick={() => handleZoom(1.25)}>
            <ZoomOutIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="重置视角" title="回到初始视角" onClick={handleResetView}>
            <RotateCcwIcon />
          </Button>
          <Button
            variant={autoRotate ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label={autoRotate ? '暂停自动播放' : '自动播放'}
            title={autoRotate ? '暂停自动播放' : '自动播放'}
            onClick={() => setAutoRotate((v) => !v)}
          >
            {autoRotate ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Button
            variant={bloomEnabled ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label={bloomEnabled ? '关闭光效' : '开启光效'}
            title={bloomEnabled ? '关闭光效（低配设备可关，省 GPU）' : '开启光效'}
            onClick={() => setBloomEnabled((v) => !v)}
          >
            <SparklesIcon />
          </Button>
          {toolbarBadge}
        </div>
      </Card>

      {legend}
      {children}
    </Card>
  );
}
