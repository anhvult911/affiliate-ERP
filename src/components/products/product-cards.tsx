import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";

import { CopyButton } from "@/components/patterns/copy-button";
import { ProductActiveSwitch } from "@/components/products/product-active-switch";
import { ProductEditDialog } from "@/components/products/product-edit-dialog";
import { toProductFormDefaults } from "@/components/products/product-form-defaults";
import { ReviewThumbnail } from "@/components/products/review-thumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ProductListItem } from "@/lib/data/products";
import { formatPercent, formatVnd } from "@/lib/format";

export function ProductCards({ products }: { products: ProductListItem[] }) {
  return (
    <>
      {products.map((product) => (
        <Card key={product.id} className="gap-3 p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <ReviewThumbnail
              src={product.images[0]}
              alt={`${product.name} review image`}
              sizes="64px"
              className="size-16 shrink-0"
            />

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/products/${product.id}`} className="flex min-h-11 items-center hover:underline">
                  <span className="line-clamp-2 text-sm font-medium">{product.name}</span>
                </Link>
                <ProductActiveSwitch
                  productId={product.id}
                  isActive={product.is_active}
                  className="shrink-0"
                />
              </div>

              {product.niche ? (
                <Badge variant="muted" className="capitalize">
                  {product.niche}
                </Badge>
              ) : null}

              <p className="text-sm font-medium tabular-nums">
                {formatVnd(product.price)}
                <span className="text-muted-foreground font-normal"> · </span>
                {formatPercent(product.commission_rate)}
              </p>
            </div>
          </div>

          {product.images.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {product.images.slice(0, 3).map((url, index) => (
                <div
                  key={`${url}-${index}`}
                  className="bg-muted aspect-square overflow-hidden rounded-lg border"
                >
                  <ReviewThumbnail
                    src={url}
                    alt={`${product.name} review image`}
                    sizes="64px"
                    className="size-full"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">No review images yet.</p>
          )}

          <div className="grid gap-2">
            <ProductEditDialog
              product={toProductFormDefaults(product)}
              triggerClassName="w-full sm:w-full"
            />
            <CopyButton
              value={product.affiliate_short_link}
              label="Copy link"
              size="block"
              variant="outline"
            />
            <Button asChild variant="outline" size="block">
              <a href={product.affiliate_short_link} target="_blank" rel="noreferrer">
                <ExternalLinkIcon />
                Open on Shopee
              </a>
            </Button>
          </div>
        </Card>
      ))}
    </>
  );
}
