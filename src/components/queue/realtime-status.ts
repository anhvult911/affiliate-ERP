"use client";

import { useSyncExternalStore } from "react";

/**
 * Live-update state shared between the realtime listener (writer, mounted in the
 * app layout) and the badge in the queue header (reader).
 *
 * A dead subscription used to be invisible: the queue simply stopped refreshing.
 * Exposing the state turns that into something the operator — and a test — can
 * see.
 */
export type RealtimeStatus = "connecting" | "live" | "offline";

let currentStatus: RealtimeStatus = "connecting";
const listeners = new Set<() => void>();

export function setRealtimeStatus(next: RealtimeStatus) {
  if (next === currentStatus) return;
  currentStatus = next;
  for (const listener of listeners) listener();
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => currentStatus,
    () => "connecting" as RealtimeStatus
  );
}
