"use client";

import { useState, useTransition } from "react";
import { ClipboardPasteIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { ProductForm } from "@/components/products/product-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProductsFromLinks, type ImportProductsResult } from "@/lib/actions/products";

const SAMPLE = `https://shopee.vn/May-loc-khong-khi-Xiaomi-Elite-i.123456789.987654321 | Máy lọc không khí Xiaomi | 1.290.000 | gia_dung
https://s.shopee.vn/abc123 | Kệ nhựa 4 tầng | 249000 | decor`;

/**
 * Paste-many-links form.
 *
 * Ten products through the eight-field form is eighty inputs where several are already
 * inside the URL. Here the operator pastes one link per line and the server derives the
 * name and item id; `link | tên | giá | ngách` is only needed when the link is shortened
 * (s.shopee.vn) or the price matters for the copy.
 */
function PasteLinksForm({ onDone }: { onDone: () => void }) {
  const [links, setLinks] = useState("");
  const [defaultNiche, setDefaultNiche] = useState("");
  const [result, setResult] = useState<ImportProductsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setResult(null);

    startTransition(async () => {
      const outcome = await createProductsFromLinks({
        links,
        defaultNiche: defaultNiche || undefined
      });

      if (!outcome.ok) {
        setError(outcome.error);
        toast.error(outcome.error);
        return;
      }

      setResult(outcome.data);
      toast.success(`Đã tạo ${outcome.data.created} sản phẩm`);

      if (outcome.data.created > 0) {
        setLinks("");
        if (outcome.data.issues.length === 0) onDone();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="paste-links">Mỗi dòng một link affiliate</Label>
        <Textarea
          id="paste-links"
          value={links}
          onChange={(event) => setLinks(event.target.value)}
          rows={8}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder={SAMPLE}
        />
        <p className="text-muted-foreground text-xs">
          Chỉ cần link — tên và mã sản phẩm lấy từ URL. Thêm{" "}
          <code>| tên | giá | ngách</code> sau link khi link rút gọn hoặc muốn điền giá ngay.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="paste-niche">Ngách mặc định (tuỳ chọn)</Label>
        <Input
          id="paste-niche"
          value={defaultNiche}
          onChange={(event) => setDefaultNiche(event.target.value)}
          placeholder="gia_dung, me_bim, decor…"
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {result ? (
        <Alert>
          <AlertDescription>
            Đã tạo <strong>{result.created}</strong> sản phẩm
            {result.skipped > 0 ? <> · bỏ qua {result.skipped}</> : null}.
            {result.issues.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs">
                {result.issues.slice(0, 6).map((issue) => (
                  <li key={`${issue.line}-${issue.error}`}>
                    Dòng {issue.line}: {issue.error}
                  </li>
                ))}
                {result.issues.length > 6 ? (
                  <li>…và {result.issues.length - 6} dòng khác</li>
                ) : null}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Đóng
        </Button>
        <Button type="button" onClick={submit} disabled={pending || links.trim().length === 0}>
          {pending ? "Đang tạo…" : "Tạo sản phẩm"}
        </Button>
      </DialogFooter>
    </div>
  );
}

type Mode = "single" | "paste";

export function ProductCreateDialog() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("single");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setMode("single");
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" className="w-full sm:w-auto">
          <PlusIcon />
          Thêm sản phẩm
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Thêm sản phẩm</DialogTitle>
          <DialogDescription>
            Điền đầy đủ cho một sản phẩm, hoặc dán nhiều link Shopee để hệ thống tự tách
            tên và mã sản phẩm.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "single" ? "default" : "outline"}
            onClick={() => setMode("single")}
          >
            Một sản phẩm
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "paste" ? "default" : "outline"}
            onClick={() => setMode("paste")}
          >
            <ClipboardPasteIcon aria-hidden className="size-4" />
            Dán nhiều link
          </Button>
        </div>

        {mode === "single" ? (
          <ProductForm onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} />
        ) : (
          <PasteLinksForm onDone={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
