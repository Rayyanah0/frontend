/**
 * Browser notifications + in-app toast queue for expiry countdowns.
 * Permission denied is a silent no-op for OS notifications; in-app toasts
 * still work without permission.
 */

export function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

export function notificationsEnabled(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function sendNotification(title: string, body: string) {
  if (!notificationsEnabled()) return;
  try {
    new Notification(title, { body });
  } catch {
    // Some browsers throw if called without a user gesture after denial flips — ignore.
  }
}

export type InAppToast = { id: string; title: string; body: string; at: number };

const TOAST_KEY = "zenith.inAppToasts";

export function pushInAppToast(title: string, body: string) {
  if (typeof window === "undefined") return;
  const toast: InAppToast = { id: `t_${Date.now()}`, title, body, at: Date.now() };
  try {
    const prev = JSON.parse(localStorage.getItem(TOAST_KEY) ?? "[]") as InAppToast[];
    localStorage.setItem(TOAST_KEY, JSON.stringify([toast, ...prev].slice(0, 20)));
    window.dispatchEvent(new CustomEvent("zenith:toast", { detail: toast }));
  } catch {
    /* ignore quota */
  }
}

export function loadInAppToasts(): InAppToast[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(TOAST_KEY) ?? "[]") as InAppToast[];
  } catch {
    return [];
  }
}

export function notifyBoth(title: string, body: string) {
  pushInAppToast(title, body);
  sendNotification(title, body);
}
