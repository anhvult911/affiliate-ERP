"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Thumbnail for images hosted by third parties (marketplace CDNs, social
 * platforms).
 *
 * Two deliberate choices:
 *
 * 1. `unoptimized` — the Next image optimizer would otherwise fetch the remote
 *    URL server-side. Marketplace and Facebook CDN links expire constantly, so a
 *    dead link turned into a 3-4 second stall per image and a 500 in the log; a
 *    queue of 25 posts with thumbnails was enough to make the whole dashboard
 *    feel frozen. Letting the browser fetch directly means a dead link costs one
 *    broken image, not the server.
 * 2. `onError` — a missing image shows a neutral placeholder instead of a broken
 *    icon, so a stale review photo never looks like a broken app.
 */
export function ExternalImage({
  src,
  alt,
  sizes,
  className,
  fallbackClassName
}: {
  src: string | null | undefined;
  alt: string;
  sizes?: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={cn("text-muted-foreground flex h-full w-full items-center justify-center", fallbackClassName)}>
        <ImageOffIcon className="size-5" aria-hidden />
        <span className="sr-only">{alt} (không tải được)</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
