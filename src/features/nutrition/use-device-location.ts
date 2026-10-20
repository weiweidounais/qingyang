"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export type DeviceFix = { latitude: number; longitude: number; accuracy: number; timestamp: number };

/** 用户主动启动；切页、隐藏、切账号及手动选城市时停止，迟到回调不生效。 */
export function useDeviceLocation(onSearchCenter: (fix: DeviceFix | null) => void, userId: string, enabled: boolean) {
  const [fix, setFix] = useState<DeviceFix | null>(null);
  const [watching, setWatching] = useState(false), [locating, setLocating] = useState(false), [error, setError] = useState("");
  const [permission, setPermission] = useState<PermissionState | "unknown">("unknown");
  const watch = useRef<number | null>(null), generation = useRef(0);
  const firstFixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const published = useRef<{ fix: DeviceFix; at: number } | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
    if (firstFixTimer.current) clearTimeout(firstFixTimer.current);
    firstFixTimer.current = null; published.current = null;
    setWatching(false); setLocating(false); setFix(null); setError("");
    onSearchCenter(null);
  }, [onSearchCenter]);
  const start = useCallback(() => {
    stop(); setError(""); setPermission("unknown");
    if (!enabled) return;
    if (!window.isSecureContext) {
      setError("此HTTP地址无法取得设备位置。手机请先完成HTTPS设置，再允许浏览器定位；城市中心仅用于手动搜索。");
      return;
    }
    if (!navigator.geolocation) { setError("当前浏览器不支持设备定位，请用Safari或Chrome打开。"); return; }
    const current = ++generation.current;
    async function readPermission() {
      try {
        const result = await navigator.permissions.query({ name: "geolocation" });
        if (current === generation.current) setPermission(result.state);
      } catch { if (current === generation.current) setPermission("unknown"); }
    }
    void readPermission();
    setWatching(true); setLocating(true);
    firstFixTimer.current = setTimeout(() => {
      if (current !== generation.current) return;
      stop(); setError("尚未获得设备位置，请检查浏览器和系统定位权限后重试。");
    }, 60000);
    let attempt = 0;
    function subscribe(highAccuracy: boolean) {
      const serial = ++attempt;
    try {
      watch.current = navigator.geolocation.watchPosition((position) => {
        if (current !== generation.current || serial !== attempt || document.hidden) return;
        const { latitude, longitude, accuracy } = position.coords;
        if (![latitude, longitude, accuracy, position.timestamp].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) return;
        if (firstFixTimer.current) clearTimeout(firstFixTimer.current);
        firstFixTimer.current = null;
        const next = { latitude, longitude, accuracy, timestamp: position.timestamp };
        setFix(next); setLocating(false); setError("");
        setPermission("granted");
        const last = published.current;
        const meters = last ? distance(last.fix, next) : Infinity;
        // 持续显示设备上报精度/时间；移动超过100米且距上次查询至少15秒才重查门店。
        if (!last || (meters >= 100 && Date.now() - last.at >= 15000)) {
          published.current = { fix: next, at: Date.now() };
          onSearchCenter(next);
        }
      }, (failure) => {
        if (current !== generation.current || serial !== attempt) return;
        void readPermission();
        if (failure.code === 3 && highAccuracy && !published.current) {
          if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
          watch.current = null;
          setError("高精度定位暂不可用，正在尝试普通精度的设备定位；成功后会显示实际精度。");
          subscribe(false);
          return;
        }
        stop();
        if (failure.code === 1) setPermission("denied");
        setError(failure.code === 1
          ? "定位权限被拒绝。请在浏览器网站权限及系统定位服务中允许定位，再点击重试；也可以用Safari或Chrome打开。"
          : failure.code === 3 ? highAccuracy
            ? "设备后续位置更新超时，实时定位已停止，请检查定位服务后重试。"
            : "浏览器的高精度和普通精度定位均未返回位置。请检查系统对当前浏览器的定位授权，并排查代理或网络对定位服务的影响。"
          : "设备暂时无法提供位置，请检查系统定位服务后重试；未用城市中心代替你的位置。");
      }, { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 15000 : 30000, maximumAge: 0 });
    } catch { stop(); setError("浏览器未能启动定位，请检查权限或换用Safari、Chrome。"); }
    }
    subscribe(true);
  }, [enabled, onSearchCenter, stop]);
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    const leave = () => stop();
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", leave);
    return () => { stop(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); };
  }, [stop, userId, enabled]);
  return { fix, watching, locating, error, permission, start, stop };
}
function distance(a: DeviceFix, b: DeviceFix) {
  const rad = Math.PI / 180;
  const q = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
}
