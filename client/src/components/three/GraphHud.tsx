import type { PointerEventHandler, ReactNode } from 'react';
import { MousePointer2 as MousePointer2Icon, X as XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TreeLegendItem } from './tree-theme';

/**
 * 3D 图谱浮层（图例 / 详情卡片 / 统计块）。
 * 工作分解 3D 世界与团队报告星图共用同一份结构，两个页面不再各自复制样式。
 */

export function GraphLegendCard({
  items,
  hint,
}: {
  items: TreeLegendItem[];
  hint: ReactNode;
}) {
  return (
    <Card className="absolute bottom-4 left-4 z-10 max-w-[calc(100%-2rem)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {items.map((item) => (
          <span
            key={`legend-${item.label}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: item.color, boxShadow: `0 0 8px ${item.color}` }}
            />
            {item.label}
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <MousePointer2Icon className="size-3.5 shrink-0" />
        <span className="min-w-0">{hint}</span>
      </div>
    </Card>
  );
}

export function GraphDetailCard({
  title,
  onClose,
  hoverProps,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  hoverProps?: {
    onPointerEnter?: PointerEventHandler<HTMLDivElement>;
    onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  };
  children: ReactNode;
}) {
  return (
    <Card
      className="absolute top-4 right-4 z-10 w-72 max-w-[calc(100%-2rem)]"
      style={{ maxHeight: 'calc(100% - 2rem)' }}
      {...hoverProps}
    >
      <CardHeader>
        <CardTitle className="truncate">{title}</CardTitle>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="关闭详情" onClick={onClose}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="min-h-0 space-y-3 overflow-y-auto">{children}</CardContent>
    </Card>
  );
}

export function DetailStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function LevelBadge({ color, label }: { color: string; label: string }) {
  return (
    <Badge variant="outline">
      <span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </Badge>
  );
}
