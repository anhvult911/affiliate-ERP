"use client";

import { useRef, useState, useTransition } from "react";
import { FileUpIcon } from "lucide-react";
import { toast } from "sonner";

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
import { importProductsCsv, type ImportProductsResult } from "@/lib/actions/products";

const SAMPLE = `Tên sản phẩm;Link tiếp thị;Giá;Tỷ lệ hoa hồng;Ngành hàng
Máy hút sữa điện đôi;https://s.shopee.vn/abc123;890000;12.5;me_bim
Kệ nhựa 4 tầng;https://s.shopee.vn/def456;249000;8;decor`;

/**
 * Import from the affiliate program's own CSV export.
 *
 * The file is read in the browser and posted as text, so the server never has to
 * deal with multipart uploads and the operator can paste a few rows by hand.
 */
export function ImportProductsDialog() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [defaultNiche, setDefaultNiche] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportProductsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setResult(null);
    setError(null);
  }

  function submit() {
    setError(null);
    setResult(null);

    startTransition(async () => {
      const outcome = await importProductsCsv({ csv, defaultNiche: defaultNiche || undefined });

      if (!outcome.ok) {
        setError(outcome.error);
        toast.error(outcome.error);
        return;
      }

      setResult(outcome.data);
      toast.success(`Đã nhập ${outcome.data.created} sản phẩm`);
      if (outcome.data.created > 0) {
        setCsv("");
        setFileName(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 sm:h-9">
          <FileUpIcon aria-hidden className="size-4" />
          Nhập CSV
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nhập sản phẩm từ CSV</DialogTitle>
          <DialogDescription>
            File export từ Shopee/Lazada Affiliate. Cần cột <strong>Tên sản phẩm</strong> và{" "}
            <strong>Link tiếp thị</strong>; các cột Giá, Tỷ lệ hoa hồng, Ngành hàng là tuỳ chọn.
            Dấu phân cách <code>,</code> <code>;</code> hoặc tab đều được.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="csv-file">File CSV</Label>
            <Input
              id="csv-file"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            {fileName ? <p className="text-muted-foreground text-xs">{fileName}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="csv-text">Hoặc dán nội dung</Label>
            <Textarea
              id="csv-text"
              value={csv}
              onChange={(event) => {
                setCsv(event.target.value);
                setResult(null);
              }}
              rows={6}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={SAMPLE}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="csv-niche">Ngành hàng mặc định (nếu file không có)</Label>
            <Input
              id="csv-niche"
              value={defaultNiche}
              onChange={(event) => setDefaultNiche(event.target.value)}
              placeholder="vd: me_bim"
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <div className="rounded-md border p-3 text-sm">
              <p>
                Đã nhập <strong>{result.created}</strong> · Bỏ qua <strong>{result.skipped}</strong> · Lỗi{" "}
                <strong>{result.issues.length}</strong>
              </p>
              {result.issues.length > 0 ? (
                <ul className="text-muted-foreground mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
                  {result.issues.slice(0, 20).map((issue) => (
                    <li key={`${issue.line}-${issue.error}`}>
                      Dòng {issue.line}: {issue.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
            className="h-11 sm:h-9"
          >
            Đóng
          </Button>
          <Button onClick={submit} disabled={pending || csv.trim().length === 0} className="h-11 sm:h-9">
            {pending ? "Đang nhập…" : "Nhập CSV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
