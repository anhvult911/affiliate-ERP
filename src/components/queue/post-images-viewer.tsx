"use client";

import { useState } from "react";
import { ZoomInIcon } from "lucide-react";

import { ExternalImage } from "@/components/patterns/external-image";
import { ImageLightbox } from "@/components/patterns/image-lightbox";

export function PostImagesViewer({ images }: { images: string[] }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  if (images.length === 0) return null;

  return (
    <>
      <div className="snap-rail gap-2">
        {images.map((url, idx) => (
          <button
            key={url}
            type="button"
            onClick={() => {
              setSelectedIdx(idx);
              setLightboxOpen(true);
            }}
            className="group relative h-24 w-24 shrink-0 snap-start overflow-hidden rounded-md border text-left"
          >
            <ExternalImage src={url} alt="Captured post image" sizes="96px" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
              <ZoomInIcon className="size-5 text-white" />
            </div>
          </button>
        ))}
      </div>

      <ImageLightbox
        images={images}
        initialIndex={selectedIdx}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        title="Ảnh bài viết Facebook"
      />
    </>
  );
}
