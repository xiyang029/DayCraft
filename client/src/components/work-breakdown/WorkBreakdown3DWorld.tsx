import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  X as XIcon,
  RotateCcw as RotateCcwIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  Play as PlayIcon,
  Pause as PauseIcon,
  MousePointer2 as MousePointer2Icon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getWorkStatusStyle } from '@/lib/utils/status-colors';
import type { WorkItem } from '../../lib/services/work-breakdown';

interface WorkBreakdown3DWorldProps {
  workItems: WorkItem[];
  projectName: string;
}

// 与工作导图同一套层级配色
const LEVEL_COLORS = ['#2196f3', '#4caf50', '#ffc107', '#9c27b0', '#f44336', '#00bcd4'];
const LEVEL_NAMES = ['项目', '1级', '2级', '3级', '4级', '5级+'];

const levelColor = (level: number): string => LEVEL_COLORS[Math.min(Math.max(level, 0), LEVEL_COLORS.length - 1)];

const nodeRadius = (level: number): number => {
  const sizes = [2.0, 1.3, 1.0, 0.85, 0.7, 0.6];
  return sizes[Math.min(Math.max(level, 0), sizes.length - 1)];
};

interface FlatNode {
  key: string;
  name: string;
  description?: string;
  progress_notes?: string;
  status?: string;
  tags?: string;
  members?: string;
  level: number;
  path: string;
  parentKey: string | null;
}

// 工作项树拍平（含虚拟项目根节点），保留父子关系与路径
function flattenWorkItems(workItems: WorkItem[], projectName: string): FlatNode[] {
  const flat: FlatNode[] = [];
  flat.push({
    key: '__root__',
    name: projectName,
    description: '项目根节点',
    level: 0,
    path: projectName,
    parentKey: null,
  });
  const walk = (items: WorkItem[], parentKey: string, parentPath: string, level: number) => {
    for (const item of items) {
      const path = `${parentPath} / ${item.name}`;
      flat.push({
        key: item.id,
        name: item.name,
        description: item.description,
        progress_notes: item.progress_notes,
        status: item.status,
        tags: item.tags,
        members: item.members,
        level,
        path,
        parentKey,
      });
      if (item.children.length > 0) {
        walk(item.children, item.id, path, level + 1);
      }
    }
  };
  walk(workItems, '__root__', projectName, 1);
  return flat;
}

// Fibonacci 球面均匀方向（确定性，无随机抖动）
function fibonacciDir(index: number, total: number, phase: number): THREE.Vector3 {
  if (total === 1) return new THREE.Vector3(1, 0.2, 0).normalize();
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / (total - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * index + phase;
  return new THREE.Vector3(Math.cos(theta) * r, y * 0.9, Math.sin(theta) * r).normalize();
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// 递归银河布局：子节点分布在父节点周围的球面上
function layoutPositions(flat: FlatNode[]): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>();
  const childrenOf = new Map<string, FlatNode[]>();
  for (const node of flat) {
    if (node.parentKey) {
      const list = childrenOf.get(node.parentKey) ?? [];
      list.push(node);
      childrenOf.set(node.parentKey, list);
    }
  }
  positions.set('__root__', new THREE.Vector3(0, 0, 0));
  const place = (parentKey: string) => {
    const parentPos = positions.get(parentKey);
    const children = childrenOf.get(parentKey) ?? [];
    if (!parentPos || children.length === 0) return;
    const spread = parentKey === '__root__' ? 2.2 : 1;
    const radius = Math.max(7, 4.5 + children.length * 1.7) * spread;
    const phase = (hashString(parentKey) % 360) * (Math.PI / 180);
    children.forEach((child, i) => {
      const dir = fibonacciDir(i, children.length, phase);
      positions.set(child.key, parentPos.clone().addScaledVector(dir, radius));
      place(child.key);
    });
  };
  place('__root__');
  return positions;
}

function truncateLabel(text: string, maxLength = 12): string {
  if (!text) return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}…` : text;
}

// Canvas 文字精灵：节点上方的名称标签
function makeLabelSprite(text: string, accent: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ transparent: true, depthWrite: false }),
  );
  if (ctx) {
    const label = truncateLabel(text);
    ctx.font = '600 52px "Segoe UI", "Microsoft YaHei", sans-serif';
    const textWidth = Math.min(ctx.measureText(label).width, 440);
    const pillW = textWidth + 72;
    const pillH = 84;
    const x = (512 - pillW) / 2;
    const y = (128 - pillH) / 2;
    ctx.fillStyle = 'rgba(8, 12, 24, 0.78)';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, pillW, pillH, 26);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f1f5f9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 256, 66);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  sprite.material.map = texture;
  sprite.material.needsUpdate = true;
  sprite.scale.set(7.2, 1.8, 1);
  return sprite;
}

export default function WorkBreakdown3DWorld({ workItems, projectName }: WorkBreakdown3DWorldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const baseEmissiveRef = useRef<Map<string, number>>(new Map());
  const homeRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const hoveredKeyRef = useRef<string | null>(null);
  const selectedKeyRef = useRef<string | null>(null);
  hoveredKeyRef.current = hoveredKey;
  selectedKeyRef.current = selectedKey;

  const flat = useMemo(() => flattenWorkItems(workItems, projectName), [workItems, projectName]);
  const flatByKey = useMemo(() => new Map(flat.map((n) => [n.key, n])), [flat]);

  const activeNode = selectedKey ? flatByKey.get(selectedKey) ?? null : null;
  const hoverNode = !activeNode && hoveredKey ? flatByKey.get(hoveredKey) ?? null : null;
  const detailNode = activeNode ?? hoverNode;

  // 高亮：选中 > 悬浮 > 默认
  useEffect(() => {
    meshesRef.current.forEach((mesh, key) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const base = baseEmissiveRef.current.get(key) ?? 0.35;
      if (key === selectedKey) {
        material.emissiveIntensity = 1.1;
        mesh.scale.setScalar(1.35);
      } else if (key === hoveredKey) {
        material.emissiveIntensity = 0.8;
        mesh.scale.setScalar(1.2);
      } else {
        material.emissiveIntensity = base;
        mesh.scale.setScalar(1);
      }
    });
    if (containerRef.current) {
      const canvas = containerRef.current.querySelector('canvas');
      if (canvas) canvas.style.cursor = hoveredKey || selectedKey ? 'pointer' : 'grab';
    }
  }, [hoveredKey, selectedKey]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || flat.length === 0) return;

    const positions = layoutPositions(flat);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1020');
    scene.fog = new THREE.FogExp2('#0b1020', 0.0035);

    const camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      2000,
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5;
    controls.maxDistance = 160;
    controls.autoRotateSpeed = 0.9;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a2033, 1.0));
    const directional = new THREE.DirectionalLight(0xffffff, 1.4);
    directional.position.set(30, 50, 20);
    scene.add(directional);
    const rootGlow = new THREE.PointLight(0x60a5fa, 60, 120);
    rootGlow.position.copy(positions.get('__root__') ?? new THREE.Vector3());
    scene.add(rootGlow);

    // 星空背景
    const starCount = 900;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const r = 220 + Math.random() * 260;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: '#93a4c4', size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.85 }),
    );
    scene.add(stars);

    // 地面网格：3D 世界的方位参照
    let minY = 0;
    positions.forEach((pos) => {
      minY = Math.min(minY, pos.y);
    });
    const grid = new THREE.GridHelper(260, 52, 0x2a3a5f, 0x16203a);
    grid.position.y = minY - 8;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.55;
    scene.add(grid);

    // 连线
    const linePositions: number[] = [];
    const lineColors: number[] = [];
    const tmpColor = new THREE.Color();
    for (const node of flat) {
      if (!node.parentKey) continue;
      const a = positions.get(node.parentKey);
      const b = positions.get(node.key);
      if (!a || !b) continue;
      linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      tmpColor.set(levelColor(node.level));
      lineColors.push(tmpColor.r, tmpColor.g, tmpColor.b, tmpColor.r, tmpColor.g, tmpColor.b);
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    const lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }),
    );
    scene.add(lines);

    // 节点球体 + 名称标签
    const meshes = new Map<string, THREE.Mesh>();
    const sphereGeometries = new Map<number, THREE.SphereGeometry>();
    const geometryFor = (radius: number): THREE.SphereGeometry => {
      const cached = sphereGeometries.get(radius);
      if (cached) return cached;
      const geometry = new THREE.SphereGeometry(radius, 40, 28);
      sphereGeometries.set(radius, geometry);
      return geometry;
    };
    for (const node of flat) {
      const pos = positions.get(node.key);
      if (!pos) continue;
      const color = levelColor(node.level);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.35,
        roughness: 0.35,
        metalness: 0.15,
      });
      const mesh = new THREE.Mesh(geometryFor(nodeRadius(node.level)), material);
      mesh.position.copy(pos);
      mesh.userData.nodeKey = node.key;
      scene.add(mesh);
      meshes.set(node.key, mesh);
      baseEmissiveRef.current.set(node.key, 0.35);

      const label = makeLabelSprite(node.name, color);
      label.position.copy(pos).add(new THREE.Vector3(0, nodeRadius(node.level) + 1.6, 0));
      scene.add(label);
    }
    meshesRef.current = meshes;

    // 相机初始机位：包住整个星系
    const bounding = new THREE.Box3();
    positions.forEach((pos) => bounding.expandByPoint(pos));
    const sphere = bounding.getBoundingSphere(new THREE.Sphere());
    const homeDistance = Math.max(28, sphere.radius * 2.1);
    const homePosition = new THREE.Vector3(
      sphere.center.x + homeDistance * 0.75,
      sphere.center.y + homeDistance * 0.55,
      sphere.center.z + homeDistance,
    );
    camera.position.copy(homePosition);
    controls.target.copy(sphere.center);
    homeRef.current = { position: homePosition.clone(), target: sphere.center.clone() };
    controls.update();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pickNode = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(Array.from(meshes.values()), false);
      if (hits.length === 0) return null;
      return (hits[0].object.userData.nodeKey as string | undefined) ?? null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const key = pickNode(event.clientX, event.clientY);
      if (key !== hoveredKeyRef.current) {
        setHoveredKey(key);
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
      const key = pickNode(event.clientX, event.clientY);
      setSelectedKey(key);
    };
    const handlePointerLeave = () => setHoveredKey(null);

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);

    const handleResize = () => {
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
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
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          (object.material as THREE.Material).dispose();
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      starGeometry.dispose();
      (stars.material as THREE.Material).dispose();
      lineGeometry.dispose();
      (lines.material as THREE.Material).dispose();
      sphereGeometries.forEach((geometry) => geometry.dispose());
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      meshesRef.current = new Map();
      controlsRef.current = null;
      cameraRef.current = null;
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [flat]);

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

  const renderTags = (tags?: string) => {
    if (!tags) return null;
    const tagList = tags.split(/[，,]/).map((t) => t.trim()).filter(Boolean);
    if (tagList.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {tagList.map((tag, idx) => (
          <Badge variant="secondary" key={`3d-tag-${idx}`}>
            {tag}
          </Badge>
        ))}
      </div>
    );
  };

  const renderMembers = (members?: string) => {
    if (!members) return null;
    const memberList = members.split(/[，,]/).map((m) => m.trim()).filter(Boolean);
    if (memberList.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {memberList.map((member, idx) => (
          <Badge variant="outline" key={`3d-member-${idx}`} className="border-primary/30 bg-accent text-primary">
            {member}
          </Badge>
        ))}
      </div>
    );
  };

  const detailStyle = detailNode ? getWorkStatusStyle(detailNode.status) : null;

  return (
    <Card className="relative w-full overflow-hidden [--card-spacing:0px]">
      <div ref={containerRef} className="h-[calc(100dvh-300px)] min-h-120 w-full sm:h-[calc(100dvh-250px)] lg:h-[calc(100dvh-225px)]" />

      {/* 工具栏：视角控制 */}
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
            aria-label={autoRotate ? '暂停自动旋转' : '自动旋转'}
            title={autoRotate ? '暂停自动旋转' : '自动旋转'}
            onClick={() => setAutoRotate((v) => !v)}
          >
            {autoRotate ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Badge variant="secondary" className="ml-1">
            共 {flat.length} 个节点
          </Badge>
        </div>
      </Card>

      {/* 图例与操作提示 */}
      <Card className="absolute bottom-4 left-4 z-10 max-w-[calc(100%-2rem)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {LEVEL_COLORS.map((color, index) => (
            <span key={`legend-${index}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: color }} />
              {LEVEL_NAMES[index]}
            </span>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MousePointer2Icon className="size-3.5" />
          左键拖拽旋转 · 滚轮缩放 · 右键拖拽平移 · 悬浮 / 点击节点查看详情
        </div>
      </Card>

      {/* 详情卡片：悬浮或点击时显示（同工作导图右上角） */}
      {detailNode && (
        <Card className="absolute top-4 right-4 z-10 w-72 max-w-[calc(100%-2rem)]" style={{ maxHeight: 'calc(100% - 2rem)' }}>
          <CardHeader>
            <CardTitle>{detailNode.name}</CardTitle>
            <CardAction>
              <Button variant="ghost" size="icon-sm" aria-label="关闭详情" onClick={() => { setSelectedKey(null); setHoveredKey(null); }}>
                <XIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-1.5">
              {detailNode.status && detailStyle && (
                <Badge variant={detailStyle.badgeVariant} className={detailStyle.badgeClassName}>
                  {detailNode.status}
                </Badge>
              )}
              <Badge variant="outline">
                <span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: levelColor(detailNode.level) }} />
                {LEVEL_NAMES[Math.min(detailNode.level, LEVEL_NAMES.length - 1)]}
              </Badge>
            </div>
            <p className="text-xs break-all text-muted-foreground">{detailNode.path}</p>
            {detailNode.description && (
              <div>
                <h4 className="mb-1 text-sm font-medium text-foreground">工作描述</h4>
                <p className="text-sm text-muted-foreground">{detailNode.description}</p>
              </div>
            )}
            {detailNode.progress_notes && (
              <div>
                <h4 className="mb-1 text-sm font-medium text-foreground">工作进展备注</h4>
                <p className="rounded border border-border bg-muted p-2 text-sm whitespace-pre-wrap text-muted-foreground">
                  {detailNode.progress_notes}
                </p>
              </div>
            )}
            {detailNode.tags && (
              <div>
                <h4 className="mb-1 text-sm font-medium text-foreground">工作标签</h4>
                {renderTags(detailNode.tags)}
              </div>
            )}
            {detailNode.members && (
              <div>
                <h4 className="mb-1 text-sm font-medium text-foreground">参与人员</h4>
                {renderMembers(detailNode.members)}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </Card>
  );
}

