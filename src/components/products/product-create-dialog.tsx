"use client";

import { useState, useTransition } from "react";
import { ClipboardCheckIcon, ClipboardPasteIcon, PlusIcon } from "lucide-react";
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
import { createProductsFromRows, previewProductLinks } from "@/lib/actions/products";
import type { PreviewRow } from "@/lib/products/link-resolver";
import { parsePrice } from "@/lib/products/parse-links";

const SAMPLE = `https://s.shopee.vn/abc123
https://s.lazada.vn/s.xyz789`;

type Draft = {
  link: string;
  name: string;
  price: string;
  niche: string;
  itemId: string | null;
  platform: string;
  /** What the resolver could not work out — shown, then cleared when the row is fixed. */
  hint: string | null;
};

function toDraft(row: PreviewRow): Draft {
  return {
    link: row.link,
    name: row.name ?? "",
    price: row.price === null ? "" : String(row.price),
    niche: row.niche ?? "",
    itemId: row.itemId,
    platform: row.platform === "other" ? "?" : row.platform,
    hint: row.error
  };
}

/**
 * Paste → resolve → review → save.
 *
 * Affiliate short codes carry no product data, and Shopee's product page is not
 * scrapable server-side (JS app, captcha, 403 on the v4 API). So the server expands the
 * redirect chain and fills what it proves — usually name + item id for slug links, only
 * the item id for `/product/<shop>/<item>` links. Anything still unknown becomes one
 * editable cell in the table, not eight fields in a form.
 */
function PasteLinksForm({ onClose }: { onClose: () => void }) {
  const [links, setLinks] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function check() {
    setError(null);

    startTransition(async () => {
      try {
        const outcome = await previewProductLinks({ links });
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }

        setDrafts(outcome.data.map(toDraft));
        const fillable = outcome.data.filter((row) => row.error === null).length;
        toast.success(`Đọc được ${fillable}/${outcome.data.length} link`);
      } catch {
        setError("Không kiểm tra được link — kiểm tra kết nối rồi thử lại.");
      }
    });
  }

  function update(index: number, patch: Partial<Draft>) {
    setDrafts((current) =>
      (current ?? []).map((draft, position) =>
        position === index
          ? {
              ...draft,
              ...patch,
              // Filling the name resolves the only blocking hint.
              hint: patch.name?.trim() ? null : draft.hint === null ? null : draft.hint
            }
          : draft
      )
    );
  }

  function save() {
    if (!drafts) return;

    const rows = drafts
      .filter((draft) => draft.name.trim().length > 0)
      .map((draft) => ({
        link: draft.link,
        name: draft.name.trim(),
        price: draft.price.trim() ? parsePrice(draft.price) : null,
        niche: draft.niche.trim() || null,
        itemId: draft.itemId
      }));

    if (rows.length === 0) {
      setError("Chưa dòng nào có tên sản phẩm — điền tên rồi lưu.");
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        const outcome = await createProductsFromRows({ rows });
        if (!outcome.ok) {
          setError(outcome.error);
          toast.error(outcome.error);
          return;
        }

        toast.success(`Đã tạo ${outcome.data.created} sản phẩm`);
        if (outcome.data.issues.length > 0) {
          setError(
            `${outcome.data.created} dòng đã lưu, ${outcome.data.skipped} dòng bị bỏ qua (trùng hoặc lỗi).`
          );
          return;
        }

        onClose();
      } catch {
        setError("Không lưu được — kiểm tra kết nối rồi thử lại.");
      }
    });
  }

  const readyCount = (drafts ?? []).filter((draft) => draft.name.trim().length > 0).length;

  return (
    <div className="space-y-3">
      {drafts === null ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="paste-links">Dán link affiliate (mỗi dòng một link)</Label>
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
              Dán link rút gọn cũng được — hệ thống mở link, tự lấy tên và mã sản phẩm, rồi
              cho anh sửa trong bảng trước khi lưu.
            </p>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="text-muted-foreground grid grid-cols-[1fr_6.5rem_6.5rem] gap-2 text-xs">
            <span>Tên sản phẩm</span>
            <span>Giá (VND)</span>
            <span>Ngách</span>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {drafts.map((draft, index) => {
              const firstMissingName = drafts.findIndex((row) => row.name.trim().length === 0);
              return (
              <div key={`${draft.link}-${index}`} className="space-y-1">
                <div className="grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-2">
                  <Input
                    value={draft.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    placeholder="Nhập tên sản phẩm"
                    aria-label={`Tên sản phẩm dòng ${index + 1}`}
                    autoFocus={index === firstMissingName}
                  />
                  <Input
                    value={draft.price}
                    onChange={(event) => update(index, { price: event.target.value })}
                    placeholder="249.000"
                    inputMode="numeric"
                    aria-label={`Giá dòng ${index + 1}`}
                  />
                  <Input
                    value={draft.niche}
                    onChange={(event) => update(index, { niche: event.target.value })}
                    placeholder="gia_dung"
                    aria-label={`Ngách dòng ${index + 1}`}
                  />
                </div>
                <p className="text-muted-foreground truncate text-[11px]">
                  {draft.platform} · {draft.itemId ? `#${draft.itemId}` : "chưa có mã"} · {draft.link}
                  {draft.hint ? <span className="text-destructive"> — {draft.hint}</span> : null}
                </p>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Đóng
        </Button>
        {drafts === null ? (
          <Button type="button" onClick={check} disabled={pending || links.trim().length === 0}>
            <ClipboardCheckIcon aria-hidden className="size-4" />
            {pending ? "Đang đọc link…" : "Kiểm tra link"}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => setDrafts(null)} disabled={pending}>
              Dán lại
            </Button>
            <Button type="button" onClick={save} disabled={pending || readyCount === 0}>
              {pending ? "Đang lưu…" : `Lưu ${readyCount} sản phẩm`}
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  );
}

type Mode = "single" | "paste";

export function ProductCreateDialog() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("single");

  // One close path for X, Escape, "Đóng" and a successful create: reopening always
  // lands on the same mode instead of remembering whichever button was used last.
  function requestClose() {
    setOpen(false);
    setMode("single");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else requestClose();
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
            Điền đầy đủ cho một sản phẩm, hoặc dán link (kể cả link rút gọn) để hệ thống tự
            điền tên, giá và mã sản phẩm.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2" role="tablist" aria-label="Cách nhập sản phẩm">
          <Button
            type="button"
            role="tab"
            aria-selected={mode === "single"}
            size="sm"
            variant={mode === "single" ? "default" : "outline"}
            onClick={() => setMode("single")}
          >
            Một sản phẩm
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={mode === "paste"}
            size="sm"
            variant={mode === "paste" ? "default" : "outline"}
            onClick={() => setMode("paste")}
          >
            <ClipboardPasteIcon aria-hidden className="size-4" />
            Dán nhiều link
          </Button>
        </div>

        {mode === "single" ? (
          <ProductForm onSuccess={requestClose} onCancel={requestClose} />
        ) : (
          <PasteLinksForm onClose={requestClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
