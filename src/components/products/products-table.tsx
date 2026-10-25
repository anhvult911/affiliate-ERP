import Link from "next/link";
import { ExternalLinkIcon, MoreHorizontalIcon, PencilIcon } from "lucide-react";

import { CopyButton } from "@/components/patterns/copy-button";
import { ProductActiveSwitch } from "@/components/products/product-active-switch";
import { ReviewThumbnail } from "@/components/products/review-thumbnail";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { ProductListItem } from "@/lib/data/products";
import { formatHostname, formatPercent, formatVnd } from "@/lib/format";

export function ProductsTable({ products }: { products: ProductListItem[] }) {
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14 pl-4">Image</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Niche</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Commission</TableHead>
            <TableHead>Affiliate link</TableHead>
            <TableHead>Active</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const firstImage = product.images[0];

            return (
              <TableRow key={product.id}>
                <TableCell className="pl-4">
                  <ReviewThumbnail
                    src={firstImage}
                    alt={`${product.name} review image`}
                    sizes="40px"
                    className="size-10"
                  />
                </TableCell>

                <TableCell className="max-w-[300px] whitespace-normal">
                  <Link
                    href={`/products/${product.id}`}
                    className="line-clamp-2 font-medium hover:underline"
                  >
                    {product.name}
                  </Link>
                  {product.shopee_item_id ? (
                    <p className="text-muted-foreground text-xs">Item {product.shopee_item_id}</p>
                  ) : null}
                </TableCell>

                <TableCell className="text-muted-foreground">
                  {product.niche ? product.niche : "—"}
                </TableCell>

                <TableCell className="tabular-nums">{formatVnd(product.price)}</TableCell>
                <TableCell className="tabular-nums">
                  {formatPercent(product.commission_rate)}
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground max-w-[160px] truncate text-xs">
                      {formatHostname(product.affiliate_short_link)}
                    </span>
                    <CopyButton
                      value={product.affiliate_short_link}
                      label="Copy affiliate link"
                      size="icon"
                    />
                  </div>
                </TableCell>

                <TableCell>
                  <ProductActiveSwitch productId={product.id} isActive={product.is_active} />
                </TableCell>

                <TableCell className="pr-4 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${product.name}`}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/products/${product.id}`}>
                          <PencilIcon />
                          Edit details
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href={product.affiliate_short_link} target="_blank" rel="noreferrer">
                          <ExternalLinkIcon />
                          Open on Shopee
                        </a>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
