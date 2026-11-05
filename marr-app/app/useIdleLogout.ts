"use client";

import { useEffect } from "react";
import { IDLE_TIMEOUT_MINUTES } from "@/lib/sessionRules";

const IDLE_LIMIT_MS = IDLE_TIMEOUT_MINUTES * 60_000;
const CHECK_EVERY_MS = 15_000;
const PING_EVERY_MS = 30_000;
const STORAGE_KEY = "marr_last_activity"; // shared between tabs, so working in one keeps the others signed in
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/**
 * Sends the user to the login page after 30 minutes without mouse, keyboard or touch. Activity with no
 * request behind it, such as typing into a long form, is reported to the server with a light request,
 * because the server decides when a session has expired (lib/auth.ts).
 */
export function useIdleLogout(enabled: boolean, onExpired: () => void) {
  useEffect(() => {
    if (!enabled) return;

    let lastActivity = Date.now(); // used when the browser blocks storage
    const read = () => {
      try {
        return Math.max(lastActivity, Number(localStorage.getItem(STORAGE_KEY)) || 0);
      } catch {
        return lastActivity;
      }
    };
    const write = (time: number) => {
      lastActivity = time;
      try {
        localStorage.setItem(STORAGE_KEY, String(time));
      } catch {
        // This tab's own time is still kept.
      }
    };

    let expired = false;
    const expire = () => {
      if (expired) return;
      expired = true;
      onExpired();
    };
    const isIdle = () => Date.now() - read() >= IDLE_LIMIT_MS;

    write(Date.now()); // opening a page after logging in counts as activity
    let lastPing = Date.now();

    const onActivity = () => {
      if (isIdle()) {
        expire(); // e.g. the computer just woke from sleep: this event must not revive the session
        return;
      }
      const now = Date.now();
      write(now);
      if (now - lastPing < PING_EVERY_MS) return;
      lastPing = now;
      fetch("/api/auth/me")
        .then((res) => {
          if (res.status === 401) expire();
        })
        .catch(() => {});
    };

    const timer = setInterval(() => {
      if (isIdle()) expire();
    }, CHECK_EVERY_MS);
    for (const name of EVENTS) window.addEventListener(name, onActivity, { passive: true });

    return () => {
      clearInterval(timer);
      for (const name of EVENTS) window.removeEventListener(name, onActivity);
    };
  }, [enabled, onExpired]);
}
