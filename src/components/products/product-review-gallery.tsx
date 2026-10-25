"use client";

import { useState } from "react";
import { ImagesIcon, ZoomInIcon } from "lucide-react";

import { ImageLightbox } from "@/components/patterns/image-lightbox";
import { ReviewThumbnail } from "@/components/products/review-thumbnail";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ProductReviewGallery({
  images,
  usage
}: {
  images: string[];
  usage: Record<string, number>;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Review images</CardTitle>
          <CardDescription>
            Real buyer photos attached to comments. The count shows how often each image was used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {images.length === 0 ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <ImagesIcon className="size-4" />
              No review images yet. Add them from Edit.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {images.map((url, index) => {
                const count = usage[url] ?? 0;

                return (
                  <figure key={`${url}-${index}`} className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedIdx(index);
                        setLightboxOpen(true);
                      }}
                      className="group bg-muted relative block aspect-square w-full overflow-hidden rounded-lg border text-left"
                    >
                      <ReviewThumbnail
                        src={url}
                        alt="Product review image"
                        sizes="(max-width: 640px) 45vw, 200px"
                        className="size-full"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                        <ZoomInIcon className="size-5 text-white" />
                      </div>
                    </button>
                    <figcaption className="text-muted-foreground text-xs">
                      Used {count} time{count === 1 ? "" : "s"}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ImageLightbox
        images={images}
        initialIndex={selectedIdx}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        title="Kho ảnh đánh giá sản phẩm"
      />
    </>
  );
}
