// lib/affect-calendar.ts
// 日历 → 情绪桥接：把角色日历里「当前进行中」的事项按标题映射成情绪事件。
//
//   触发时机：角色聊天 / 群聊生成回复时调用 syncCalendarAffect（惰性，非定时器）。
//   去重：affect-model 的 processedCalendarIds 用事项 id 去重，同一事项只叠加一次。

import { loadCalendarWeekPlan } from "./calendar-storage";
import { formatIsoDate, getWeekStartIso, sortScheduleItems, timeToMinutes } from "./calendar-utils";
import { getNowMs } from "./virtual-time";
import { ingestAffectEvent } from "./affect-store";
import type { CalendarOwnerType } from "./calendar-types";

// 标题关键词 → Drivesoid 日历事件类型（顺序即优先级）
const TITLE_TYPE_RULES: { type: string; patterns: RegExp[] }[] = [
  { type: "birthday", patterns: [/生日/, /birthday/i] },
  { type: "exam", patterns: [/考试/, /测验/, /exam/i] },
  { type: "intimacy", patterns: [/亲密/, /二人世界/] },
  { type: "meetup", patterns: [/见面/, /碰面/, /约会/, /聚餐/, /date/i] },
  { type: "trip_start", patterns: [/出发/, /旅行/, /出游/, /旅游/, /trip/i] },
  { type: "trip_end", patterns: [/返程/, /回来/, /回家/] },
  { type: "holiday", patterns: [/假期/, /放假/, /holiday/i] },
];

export function mapCalendarTitleToType(title: string): string | null {
  const t = title.trim();
  if (!t) return null;
  for (const { type, patterns } of TITLE_TYPE_RULES) {
    if (patterns.some(p => p.test(t))) return type;
  }
  return null;
}

/**
 * 把 owner（角色）当前时刻进行中的日历事项映射成情绪事件并摄入。
 * 无匹配事项时无副作用。
 */
export function syncCalendarAffect(ownerType: CalendarOwnerType, ownerId: string): void {
  try {
    const nowMs = getNowMs();
    const now = new Date(nowMs);
    const date = formatIsoDate(now);
    const weekStart = getWeekStartIso(now);
    const plan = loadCalendarWeekPlan(ownerType, ownerId, weekStart);
    if (!plan || plan.items.length === 0) return;

    const currentMinute = now.getHours() * 60 + now.getMinutes();
    const active = sortScheduleItems(plan.items).filter(item => {
      if (item.date !== date) return false;
      const start = timeToMinutes(item.startTime);
      const end = timeToMinutes(item.endTime);
      if (Number.isNaN(start) || Number.isNaN(end)) return false;
      return start <= currentMinute && currentMinute < end;
    });

    for (const item of active) {
      const calendarType = mapCalendarTitleToType(item.title);
      if (calendarType) {
        ingestAffectEvent(ownerId, { type: "calendar", calendarId: item.id, calendarType });
      }
    }
  } catch {
    // 日历读取失败不阻塞聊天链路
  }
}
