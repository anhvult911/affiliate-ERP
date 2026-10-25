import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";

/** Unknown ids from detail routes (`notFound()`) land here, inside the app shell. */
export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <EmptyState
        icon={SearchXIcon}
        title="That record does not exist"
        description="It may have been deleted, or the link came from a stale tab or shared URL."
        action={
          <Button asChild size="lg">
            <Link href="/queue">Back to the approval queue</Link>
          </Button>
        }
        className="w-full max-w-lg"
      />
    </div>
  );
}
