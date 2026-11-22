import { JobDetailClient } from "@/components/job-detail";

// This route renders a specific job at request time; it is not statically
// prerenderable, so opt out of instant-navigation validation (Next 16
// "Cache Components" model: `dynamic = "force-dynamic"` no longer exists).
export const instant = false;

/** Server wrapper: unwraps the async route param, then renders the client view. */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobDetailClient id={id} />;
}
