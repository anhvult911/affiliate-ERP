"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Captured post images are arbitrary social CDN URLs. `unoptimized` keeps hosts
 * outside next.config's allow-list working, and a dead URL degrades to a
 * placeholder instead of a broken image.
 */
export function CaptureThumbnail({
  src,
  alt,
  className
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        className={cn(
          "bg-muted text-muted-foreground flex items-center justify-center overflow-hidden rounded-md",
          className
        )}
      >
        <ImageOffIcon className="size-4" aria-hidden />
        <span className="sr-only">Image unavailable</span>
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={160}
      height={160}
      sizes="96px"
      unoptimized
      onError={() => setFailed(true)}
      className={cn("rounded-md border object-cover", className)}
    />
  );
}
