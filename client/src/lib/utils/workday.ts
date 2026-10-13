// 中国法定工作日判断（含调休），数据源自 chinese-workday（国务院放假安排，覆盖 2011–2026）。
// 超出数据覆盖范围的日期，该库自动回退为周一~周五规则，无需额外处理。
// 每年国务院公布新一年放假安排后，执行 pnpm update chinese-workday 即可跟进。
import { isWorkday } from "chinese-workday";

/** 是否为工作日（调休上班的周末算工作日，法定节假日不算） */
export function isWorkdayCN(date: Date): boolean {
  return isWorkday(date);
}

/** 是否为调休上班日（落在周末的工作日，用于列表打标） */
export function isAdjustedWorkday(date: Date): boolean {
  const day = date.getDay();
  return (day === 0 || day === 6) && isWorkdayCN(date);
}
