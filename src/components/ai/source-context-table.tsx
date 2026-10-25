import { Database, MessagesSquare } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { ResponsiveView } from "@/components/patterns/responsive-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { SOURCE_TYPE_LABEL } from "@/lib/constants";
import type { SourceContextRow } from "@/lib/data/ai-context";

function PresenceBadge({ label, value }: { label: string; value: string | null }) {
  const present = Boolean(value?.trim());
  return (
    <Badge variant={present ? "success" : "muted"}>
      {present ? `${label}: set` : `${label}: missing`}
    </Badge>
  );
}

export function SourceContextTable({ rows }: { rows: SourceContextRow[] }) {
  const withTone = rows.filter((row) => Boolean(row.tone_of_voice?.trim())).length;
  const withRules = rows.filter((row) => Boolean(row.group_rules?.trim())).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4" />
          Source context
        </CardTitle>
        <CardDescription>
          These fields are injected into every draft prompt. {withTone} of {rows.length} sources have
          a recorded tone of voice and {withRules} have group rules — missing values weaken the
          imitation and are called out to Gemini as such.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="No target sources yet"
            description="Add groups, fanpages or KOLs in the Radar module; their tone of voice and rules will appear here as prompt context."
          />
        ) : (
          <ResponsiveView
            desktop={
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Niche</TableHead>
                      <TableHead>Tone of voice</TableHead>
                      <TableHead>Group rules</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="max-w-[220px]">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-medium" title={row.name}>
                              {row.name}
                            </span>
                            {row.is_active ? null : <Badge variant="muted">Inactive</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>{SOURCE_TYPE_LABEL[row.source_type]}</TableCell>
                        <TableCell className="max-w-[160px] truncate" title={row.niche ?? undefined}>
                          {row.niche ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[260px] whitespace-normal">
                          <PresenceBadge label="Tone" value={row.tone_of_voice} />
                          {row.tone_of_voice ? (
                            <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                              {row.tone_of_voice}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[280px] whitespace-normal">
                          <PresenceBadge label="Rules" value={row.group_rules} />
                          {row.group_rules ? (
                            <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                              {row.group_rules}
                            </p>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            }
            mobile={
              <>
                {rows.map((row) => (
                  <div key={row.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate font-medium">{row.name}</p>
                      {row.is_active ? null : <Badge variant="muted">Inactive</Badge>}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {SOURCE_TYPE_LABEL[row.source_type]} · {row.niche ?? "No niche"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <PresenceBadge label="Tone" value={row.tone_of_voice} />
                      <PresenceBadge label="Rules" value={row.group_rules} />
                    </div>
                    {row.tone_of_voice ? (
                      <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">
                        Tone: {row.tone_of_voice}
                      </p>
                    ) : null}
                    {row.group_rules ? (
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        Rules: {row.group_rules}
                      </p>
                    ) : null}
                  </div>
                ))}
              </>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
