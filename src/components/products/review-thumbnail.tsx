"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ImageOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Review images are arbitrary marketplace/CDN URLs. `unoptimized` skips the
 * Next image proxy so hosts outside next.config's allow-list still render, and
 * a broken URL degrades to a neutral placeholder instead of a broken icon.
 */
export function ReviewThumbnail({
  src,
  alt,
  sizes = "64px",
  className
}: {
  src?: string | null;
  alt: string;
  sizes?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

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
      sizes={sizes}
      unoptimized
      onError={() => setFailed(true)}
      className={cn("rounded-md object-cover", className)}
    />
  );
}
