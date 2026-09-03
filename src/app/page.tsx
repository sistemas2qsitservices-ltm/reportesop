import { listConnections } from "@/lib/catalog";
import ReportClient from "./report-client";

// The connection catalog is a Vercel secret and is intentionally read only at request time.
export const dynamic = "force-dynamic";

export default function Page() { return <ReportClient connections={listConnections()} />; }

