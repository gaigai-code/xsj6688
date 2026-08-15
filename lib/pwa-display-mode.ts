export type PwaDisplayPreference = "fullscreen" | "standalone";
export type RuntimePwaDisplayMode = "fullscreen" | "standalone" | "minimal-ui" | "browser";
export type PwaHostedSurface = "custom-app" | "game";

export type PwaHostedSafeArea = {
  top: string;
  right: string;
  bottom: string;
  left: string;
};

export const PWA_DISPLAY_MODE_COOKIE = "pwa_display_mode";
export const PWA_DISPLAY_MODE_CHANGED_EVENT = "pwa-display-mode-changed";
export const DEFAULT_PWA_DISPLAY_PREFERENCE: PwaDisplayPreference = "fullscreen";

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function readPwaDisplayPreference(cookie: string): PwaDisplayPreference | null {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${PWA_DISPLAY_MODE_COOKIE}=([^;]+)`));
  if (!match) return null;
  const value = decodeCookieValue(match[1]);
  return value === "fullscreen" || value === "standalone" ? value : null;
}

export function writePwaDisplayPreference(preference: PwaDisplayPreference) {
  if (typeof document === "undefined") return;
  document.cookie = `${PWA_DISPLAY_MODE_COOKIE}=${preference}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new CustomEvent(PWA_DISPLAY_MODE_CHANGED_EVENT, { detail: preference }));
}

/** Preserve the upstream default: mobile browsers request fullscreen unless Edge or explicitly disabled. */
export function shouldRequestPwaFullscreen(): boolean {
  if (typeof document === "undefined" || typeof navigator === "undefined") return false;
  const preference = readPwaDisplayPreference(document.cookie);
  if (preference === "standalone") return false;
  if (preference === "fullscreen") return true;
  return !/Edg/i.test(navigator.userAgent);
}

export function getRuntimePwaDisplayMode(): RuntimePwaDisplayMode {
  if (typeof window === "undefined" || typeof document === "undefined") return "browser";
  if (document.fullscreenElement || window.matchMedia("(display-mode: fullscreen)").matches) {
    return "fullscreen";
  }
  if (window.matchMedia("(display-mode: standalone)").matches) {
    return "standalone";
  }
  if (window.matchMedia("(display-mode: minimal-ui)").matches) {
    return "minimal-ui";
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return navigatorWithStandalone.standalone ? "standalone" : "browser";
}

/** 非沉浸布局是否生效：必须用户显式开了「显示系统状态栏」且运行时确实不在全屏。
 *  只看运行时模式是不行的——iOS 装到桌面永远报 standalone，会把没碰过开关的
 *  用户也误判成非沉浸（这正是 pwa-manifest-injector 挂标记前要先过这道门的原因）。 */
export function isNonImmersiveLayoutActive(): boolean {
  if (typeof document === "undefined") return false;
  return readPwaDisplayPreference(document.cookie) === "standalone"
    && getRuntimePwaDisplayMode() !== "fullscreen";
}

/** Safe-area values injected into sandboxed apps, which cannot inherit host CSS variables.
 *  measuredTopPx：宿主实测的顶部浮层（胶囊按钮/悬浮返回钮）下沿，优先于估算值——
 *  壳布局以后再调整时数字不会失真。 */
export function getPwaHostedSafeArea(surface: PwaHostedSurface, embedded = false, measuredTopPx?: number | null): PwaHostedSafeArea {
  if (embedded) {
    return { top: "0px", right: "0px", bottom: "0px", left: "0px" };
  }

  const fallbackTop = isNonImmersiveLayoutActive() ? (surface === "game" ? "60px" : "48px") : "88px";
  return {
    top: measuredTopPx != null && measuredTopPx > 0 ? `${Math.round(measuredTopPx)}px` : fallbackTop,
    right: "16px",
    bottom: "24px",
    left: "16px",
  };
}
