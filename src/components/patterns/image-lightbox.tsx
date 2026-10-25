"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";

export function ImageLightbox({
  images,
  initialIndex = 0,
  open,
  onOpenChange,
  title
}: {
  images: string[];
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);

  // Sync index when initialIndex changes or modal opens
  useEffect(() => {
    if (open) {
      setCurrentIndex(Math.max(0, Math.min(initialIndex, images.length - 1)));
      setZoom(1);
    }
  }, [open, initialIndex, images.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onOpenChange(false);
      } else if (e.key === "ArrowLeft" && images.length > 1) {
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
        setZoom(1);
      } else if (e.key === "ArrowRight" && images.length > 1) {
        setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
        setZoom(1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, images.length, onOpenChange]);

  if (!open || images.length === 0) return null;

  const currentUrl = images[currentIndex];

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.5, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.5, 0.5));
  const handleZoomReset = () => setZoom(1);

  const prevImage = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    setZoom(1);
  };

  const nextImage = () => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    setZoom(1);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/90 p-4 backdrop-blur-md animate-in fade-in-0 duration-200"
    >
      {/* Top Header Bar */}
      <div className="flex w-full items-center justify-between gap-3 text-white">
        <div className="flex items-center gap-2 truncate text-sm">
          <span className="font-semibold">{title ?? "Xem ảnh chi tiết"}</span>
          {images.length > 1 ? (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs tabular-nums text-white/90">
              {currentIndex + 1} / {images.length}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Zoom controls */}
          <div className="flex items-center rounded-lg bg-white/10 p-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-white hover:bg-white/20 hover:text-white"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              title="Thu nhỏ"
            >
              <ZoomOutIcon className="size-4" />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums font-mono text-white/80">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-white hover:bg-white/20 hover:text-white"
              onClick={handleZoomIn}
              disabled={zoom >= 3}
              title="Phóng to"
            >
              <ZoomInIcon className="size-4" />
            </Button>
            {zoom !== 1 ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-white hover:bg-white/20 hover:text-white"
                onClick={handleZoomReset}
                title="Về cỡ gốc"
              >
                <RotateCcwIcon className="size-3.5" />
              </Button>
            ) : null}
          </div>

          {currentUrl ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-white hover:bg-white/20 hover:text-white"
              asChild
            >
              <a href={currentUrl} target="_blank" rel="noreferrer" title="Mở ảnh gốc trong tab mới">
                <ExternalLinkIcon className="size-4" />
              </a>
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-white hover:bg-white/20 hover:text-white"
            onClick={() => onOpenChange(false)}
            aria-label="Đóng"
          >
            <XIcon className="size-5" />
          </Button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div
        className="relative flex h-full w-full flex-1 items-center justify-center overflow-hidden py-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onOpenChange(false);
        }}
      >
        {/* Navigation Arrows */}
        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={prevImage}
              className="absolute left-2 z-10 flex size-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-all hover:bg-white/25 active:scale-95"
              aria-label="Ảnh trước"
            >
              <ChevronLeftIcon className="size-6" />
            </button>
            <button
              type="button"
              onClick={nextImage}
              className="absolute right-2 z-10 flex size-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-all hover:bg-white/25 active:scale-95"
              aria-label="Ảnh tiếp theo"
            >
              <ChevronRightIcon className="size-6" />
            </button>
          </>
        ) : null}

        {currentUrl ? (
          <div
            className="relative transition-transform duration-150 ease-out"
            style={{
              transform: `scale(${zoom})`,
              maxHeight: "82dvh",
              maxWidth: "92vw",
              width: "100%",
              height: "100%"
            }}
          >
            <Image
              src={currentUrl}
              alt="Preview"
              fill
              unoptimized
              className="select-none object-contain"
            />
          </div>
        ) : null}
      </div>

      {/* Bottom Thumbnail Strip */}
      {images.length > 1 ? (
        <div className="snap-rail max-w-xl gap-2 pb-safe pt-2">
          {images.map((url, idx) => (
            <button
              key={`${url}-${idx}`}
              type="button"
              onClick={() => {
                setCurrentIndex(idx);
                setZoom(1);
              }}
              className={`relative size-12 shrink-0 overflow-hidden rounded-md border-2 transition-all ${
                currentIndex === idx ? "border-primary ring-2 ring-primary/50" : "border-white/20 opacity-60 hover:opacity-100"
              }`}
            >
              <Image src={url} alt={`Thumb ${idx + 1}`} fill unoptimized className="object-cover" />
            </button>
          ))}
        </div>
      ) : (
        <div className="pb-safe" />
      )}
    </div>
  );
}
