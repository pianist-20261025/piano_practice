// iPad などタッチ端末・全画面表示まわりの判定と操作（ブラウザの違いを吸収する）

interface WebkitDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => void;
}

/** iPad か（iPadOS 13 以降の Safari は Mac と名乗るので、タッチ点の数で見分ける） */
export function isIPad(): boolean {
  return /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** ホーム画面に追加したアプリとして開いているか */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function fullscreenSupported(): boolean {
  const d = document as Document & WebkitDocument;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as Document & WebkitDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** 全画面表示を切り替える（iPad の Safari は webkit の接頭辞つきの API しかない版がある） */
export function toggleFullscreen(): void {
  const d = document as Document & WebkitDocument;
  const el = document.documentElement as HTMLElement & WebkitElement;
  if (isFullscreen()) {
    if (d.exitFullscreen) void d.exitFullscreen();
    else d.webkitExitFullscreen?.();
  } else if (el.requestFullscreen) {
    void el.requestFullscreen().catch(() => {});
  } else {
    el.webkitRequestFullscreen?.();
  }
}

export function onFullscreenChange(listener: () => void): void {
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
}
