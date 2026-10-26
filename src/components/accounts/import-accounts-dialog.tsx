"use client";

import { useState, useTransition } from "react";
import { KeyRoundIcon } from "lucide-react";
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
import { importAccounts, type ImportAccountsResult } from "@/lib/actions/accounts";

const PLACEHOLDER = `00000000000000|matkhau|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|127.0.0.1:8080
00000000000001|matkhau2|BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB|127.0.0.1:8081`;

/**
 * Bulk import from the operator's Facebook export.
 *
 * Credentials are encrypted server-side (ACCOUNT_CREDENTIALS_KEY) before insert and
 * are never rendered back into the UI: only UIDs appear in the result.
 */
export function ImportAccountsDialog({ personaTypes }: { personaTypes: string[] }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState("");
  const [personaType, setPersonaType] = useState(personaTypes[0] ?? "me_bim");
  const [result, setResult] = useState<ImportAccountsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setResult(null);

    startTransition(async () => {
      const outcome = await importAccounts({ lines, personaType });

      if (!outcome.ok) {
        setError(outcome.error);
        toast.error(outcome.error);
        return;
      }

      setResult(outcome.data);
      toast.success(`Đã nhập ${outcome.data.created} tài khoản`);

      if (outcome.data.created > 0) setLines("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 sm:h-9">
          <KeyRoundIcon aria-hidden className="size-4" />
          Nhập account
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nhập account hàng loạt</DialogTitle>
          <DialogDescription>
            Mỗi dòng một account:{" "}
            <code className="text-[11px]">uid|mật khẩu|2FA secret|proxy</code>. Proxy có thể
            bỏ trống hoặc dạng <code className="text-[11px]">host:port:user:pass</code>. Mật khẩu và
            secret được mã hoá trước khi lưu.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="import-lines">Danh sách account</Label>
            <Textarea
              id="import-lines"
              value={lines}
              onChange={(event) => setLines(event.target.value)}
              placeholder={PLACEHOLDER}
              rows={7}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="import-persona">Persona cho nhóm này</Label>
            <Input
              id="import-persona"
              value={personaType}
              onChange={(event) => setPersonaType(event.target.value)}
              placeholder="vd: me_bim"
              list="import-persona-options"
            />
            <datalist id="import-persona-options">
              {personaTypes.map((persona) => (
                <option key={persona} value={persona} />
              ))}
            </datalist>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <div className="rounded-md border p-3 text-sm">
              <p>
                Đã nhập <strong>{result.created}</strong> · Trùng <strong>{result.duplicates}</strong>{" "}
                · Lỗi <strong>{result.issues.length}</strong>
              </p>
              {result.issues.length > 0 ? (
                <ul className="text-muted-foreground mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
                  {result.issues.map((issue) => (
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
          <Button onClick={submit} disabled={pending || lines.trim().length === 0} className="h-11 sm:h-9">
            {pending ? "Đang nhập…" : "Nhập account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
