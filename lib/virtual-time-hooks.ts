// lib/virtual-time-hooks.ts
// 虚拟时间的 React 订阅层。组件用 useVirtualNow 让显示随虚拟时间走字；
// 用 useVirtualTimeState 在模式/时间/流速变化时重渲染。

"use client";

import { useEffect, useState } from "react";
import {
  getNow,
  getVirtualTimeState,
  subscribeVirtualTime,
  type VirtualTimeState,
} from "./virtual-time";

/** 返回当前虚拟时间，并每 intervalMs 走字一次、状态变化时立即刷新。 */
export function useVirtualNow(intervalMs = 1000): Date {
  const [now, setNow] = useState<Date>(() => getNow());

  useEffect(() => {
    const tick = () => setNow(getNow());
    const id = window.setInterval(tick, intervalMs);
    const unsubscribe = subscribeVirtualTime(tick);
    return () => {
      window.clearInterval(id);
      unsubscribe();
    };
  }, [intervalMs]);

  return now;
}

/** 订阅虚拟时间状态（mode/rate/anchor），状态变化时触发重渲染。 */
export function useVirtualTimeState(): VirtualTimeState {
  const [state, setState] = useState<VirtualTimeState>(() => getVirtualTimeState());

  useEffect(() => {
    const update = () => setState(getVirtualTimeState());
    const unsubscribe = subscribeVirtualTime(update);
    return unsubscribe;
  }, []);

  return state;
}
