import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  PercentIcon,
  ShoppingBagIcon,
  TagIcon,
  WalletIcon
} from "lucide-react";

import { CopyButton } from "@/components/patterns/copy-button";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { ProductActiveSwitch } from "@/components/products/product-active-switch";
import { ProductDeleteDialog } from "@/components/products/product-delete-dialog";
import { ProductEditDialog } from "@/components/products/product-edit-dialog";
import { toProductFormDefaults } from "@/components/products/product-form-defaults";
import { ProductReviewGallery } from "@/components/products/product-review-gallery";
import { ProductTasksList } from "@/components/products/product-tasks-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getProduct,
  getProductRoi,
  getReviewImageUsage,
  listProductTasks
} from "@/lib/data/products";
import { formatDateTime, formatNumber, formatPercent, formatRelative, formatVnd } from "@/lib/format";
import { productIdSchema } from "@/lib/validations/product";

export const metadata: Metadata = { title: "Product details" };

export default async function ProductDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // A malformed UUID would make Postgres throw instead of returning "no rows".
  if (!productIdSchema.safeParse(id).success) notFound();

  const product = await getProduct(id);
  if (!product) notFound();

  const [roi, tasks, usage] = await Promise.all([
    getProductRoi(id),
    listProductTasks(id),
    getReviewImageUsage(id)
  ]);

  const defaults = toProductFormDefaults(product);
  const images = defaults.review_images;

  return (
    <div className="space-y-4 sm:space-y-6">
      <Link
        href="/products"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1 text-sm"
      >
        <ArrowLeftIcon className="size-4" />
        Affiliate Hub
      </Link>

      <PageHeader
        title={product.name}
        description={product.niche ? `Niche: ${product.niche}` : "Affiliate product"}
        actions={
          <>
            <ProductActiveSwitch
              productId={product.id}
              isActive={product.is_active}
              showLabel
              className="min-h-11"
            />
            <ProductEditDialog product={defaults} />
            <ProductDeleteDialog
              productId={product.id}
              productName={product.name}
              redirectTo="/products"
            />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Price" value={formatVnd(product.price)} icon={TagIcon} />
        <StatCard
          label="Commission"
          value={formatPercent(product.commission_rate)}
          icon={PercentIcon}
        />
        <StatCard label="Orders" value={formatNumber(roi.orders)} icon={ShoppingBagIcon} />
        <StatCard
          label="Settled commission"
          value={formatVnd(roi.settledCommission)}
          icon={WalletIcon}
          tone="success"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Affiliate link</CardTitle>
              <CardDescription>Posted with every comment for this product.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="bg-muted min-w-0 flex-1 truncate rounded-md px-3 py-2 font-mono text-xs">
                  {product.affiliate_short_link}
                </p>
                <CopyButton
                  value={product.affiliate_short_link}
                  label="Copy affiliate link"
                  size="icon"
                />
                <Button asChild variant="outline" size="icon">
                  <a
                    href={product.affiliate_short_link}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open affiliate link"
                  >
                    <ExternalLinkIcon />
                  </a>
                </Button>
              </div>

              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                {product.shopee_item_id ? (
                  <Badge variant="muted">Item {product.shopee_item_id}</Badge>
                ) : null}
                {product.niche ? <Badge variant="muted">{product.niche}</Badge> : null}
                <span>Updated {formatRelative(product.updated_at)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pros / cons</CardTitle>
              <CardDescription>Context the AI engine uses when drafting comments.</CardDescription>
            </CardHeader>
            <CardContent>
              {product.pros_cons_summary ? (
                <p className="text-sm whitespace-pre-line">{product.pros_cons_summary}</p>
              ) : (
                <p className="text-muted-foreground text-sm">No summary yet. Add one from Edit.</p>
              )}
            </CardContent>
          </Card>

          <ProductReviewGallery images={images} usage={usage} />

          <ProductTasksList tasks={tasks} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>ROI</CardTitle>
              <CardDescription>Aggregated from matched tasks and conversion postbacks.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-xs">Orders</p>
                <p className="text-sm font-medium tabular-nums">{formatNumber(roi.orders)}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-xs">Revenue</p>
                <p className="text-sm font-medium tabular-nums">{formatVnd(roi.revenue)}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-xs">Commission</p>
                <p className="text-sm font-medium tabular-nums">{formatVnd(roi.commission)}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-xs">Settled commission</p>
                <p className="text-sm font-medium tabular-nums">
                  {formatVnd(roi.settledCommission)}
                </p>
              </div>
            </CardContent>
            <CardContent className="text-muted-foreground border-t pt-3 text-xs">
              {formatNumber(roi.tasksTotal)} tasks · {formatNumber(roi.tasksCompleted)} completed ·{" "}
              {formatNumber(roi.tasksFailed)} failed
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-xs">Shopee item ID</span>
                <span className="truncate">{product.shopee_item_id ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-xs">Review images</span>
                <span className="tabular-nums">{formatNumber(images.length)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-xs">Created</span>
                <span className="text-xs">{formatDateTime(product.created_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-xs">Updated</span>
                <span className="text-xs">{formatDateTime(product.updated_at)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
