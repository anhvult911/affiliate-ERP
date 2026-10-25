import { redirect } from "next/navigation";

/** Root of the dashboard → the approval queue is the primary workspace. */
export default function DashboardIndexPage() {
  redirect("/queue");
}
