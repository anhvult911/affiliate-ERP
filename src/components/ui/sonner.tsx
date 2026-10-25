"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Sonner wired to the app tokens. Mounted once in the root layout; used by the
 * realtime radar listener to announce fresh high-intent posts.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      position="top-center"
      richColors
      closeButton
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)"
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
