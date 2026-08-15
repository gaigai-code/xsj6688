"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Layers } from "lucide-react";

import { Toggle } from "@/components/ui/form";
import {
  DEFAULT_PWA_DISPLAY_PREFERENCE,
  readPwaDisplayPreference,
  writePwaDisplayPreference,
  type PwaDisplayPreference,
} from "@/lib/pwa-display-mode";
import { CONTENT_APP_ACCENTS } from "@/lib/ui-accent-colors";

type PwaDisplaySettingProps = {
  onNotice: (message: string) => void;
};

export function PwaDisplaySetting({ onNotice }: PwaDisplaySettingProps) {
  const [preference, setPreference] = useState<PwaDisplayPreference>(DEFAULT_PWA_DISPLAY_PREFERENCE);

  useEffect(() => {
    setPreference(readPwaDisplayPreference(document.cookie) ?? DEFAULT_PWA_DISPLAY_PREFERENCE);
  }, []);

  const setShowSystemStatusBar = (enabled: boolean) => {
    const next: PwaDisplayPreference = enabled ? "standalone" : "fullscreen";
    setPreference(next);
    writePwaDisplayPreference(next);

    if (next === "standalone" && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }

    onNotice(enabled
      ? "已开启系统状态栏，重新添加到桌面后完全生效"
      : "已恢复沉浸全屏，重新添加到桌面后完全生效");
  };

  return (
    <div className="app-card card-featured settings-toggle-card">
      <span className="card-icon" style={{ "--icon-color": CONTENT_APP_ACCENTS.calendar } as CSSProperties}>
        <Layers size={22} strokeWidth={1.75} />
      </span>
      <div className="card-featured-body">
        <div className="card-featured-label">显示系统状态栏</div>
        <div className="card-featured-desc">开启后退出沉浸全屏，避免安卓反复显示全屏提示；重新添加到桌面后完全生效</div>
      </div>
      <Toggle
        checked={preference === "standalone"}
        onChange={setShowSystemStatusBar}
        className="settings-toggle-control"
      />
    </div>
  );
}
