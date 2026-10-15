import type { FC } from 'react';
import {
  formatProgressText,
  getProgressColorClass
} from '../../lib/utils/progress-calculator';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ProgressIndicatorProps {
  progress: number;
  size?: 'sm' | 'md' | 'lg';
  showBar?: boolean;
  showText?: boolean;
}

const SIZES = {
  sm: { badge: 'h-4 px-1.5 text-[0.625rem]', container: 'gap-1', bar: 'min-w-[40px] max-w-[80px]' },
  md: { badge: '', container: 'gap-2', bar: 'min-w-[60px] max-w-[120px]' },
  lg: { badge: 'h-6 px-2.5 text-sm', container: 'gap-3', bar: 'min-w-[80px] max-w-[160px]' }
} as const;

// 工作进度指示：状态徽章（悬停显示进度）+ 进度条，全部基于 components/ui。
const ProgressIndicator: FC<ProgressIndicatorProps> = ({
  progress,
  size = 'md',
  showBar = true,
  showText = true,
}) => {
  const clamped = Math.min(100, Math.max(0, progress));
  const text = formatProgressText(progress);
  const current = SIZES[size];

  return (
    <div className={`flex items-center ${current.container}`}>
      {showText && (
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className={`${getProgressColorClass(clamped)} ${current.badge}`}>
              {text}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>工作进度: {text}</TooltipContent>
        </Tooltip>
      )}

      {showBar && (
        <Progress value={clamped} className={`flex-1 ${current.bar}`} />
      )}
    </div>
  );
};

export default ProgressIndicator;
