import { useCallback, useEffect, useRef, useState } from 'react';

/** 鼠标离开画布后保留悬浮详情的宽限时间（毫秒）。 */
const HOVER_CLEAR_DELAY = 220;

/**
 * 3D 图谱悬浮状态。
 *
 * 悬浮详情卡片叠在画布右上角，鼠标从节点移向卡片时会先触发 canvas 的 pointerleave。
 * 如果立刻清空 hoveredKey，卡片会在鼠标下消失，随后又因鼠标回到画布而重新出现，
 * 表现为持续闪烁。这里给「离开画布」加一个宽限期，并让卡片自身的 pointerenter
 * 取消清理：鼠标停在卡片上时详情保持打开，离开卡片后才收起。
 */
export function useGraphHover() {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const cardHoveredRef = useRef(false);

  const cancelPendingClear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleClear = useCallback(() => {
    cancelPendingClear();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (!cardHoveredRef.current) setHoveredKey(null);
    }, HOVER_CLEAR_DELAY);
  }, [cancelPendingClear]);

  const onHoverKeyChange = useCallback(
    (key: string | null) => {
      cancelPendingClear();
      if (key !== null) {
        cardHoveredRef.current = false;
        setHoveredKey(key);
        return;
      }
      if (!cardHoveredRef.current) scheduleClear();
    },
    [cancelPendingClear, scheduleClear],
  );

  const detailHoverProps = {
    onPointerEnter: () => {
      cardHoveredRef.current = true;
      cancelPendingClear();
    },
    onPointerLeave: () => {
      cardHoveredRef.current = false;
      scheduleClear();
    },
  };

  /** 主动关闭详情时调用，顺手解除卡片悬浮锁，避免之后再也无法自动收起。 */
  const clearHover = useCallback(() => {
    cancelPendingClear();
    cardHoveredRef.current = false;
    setHoveredKey(null);
  }, [cancelPendingClear]);

  useEffect(() => () => cancelPendingClear(), [cancelPendingClear]);

  return { hoveredKey, onHoverKeyChange, detailHoverProps, clearHover };
}
