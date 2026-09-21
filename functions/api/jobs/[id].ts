import type { Env } from "../../lib/env";
import { getJob, queuePositionAhead, QUEUE_CEILING_MS } from "../../lib/jobs";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  const job = await getJob(env.DB, id);

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  // A queued/rendering job older than the ceiling gets treated as failed on
  // read, even if the consumer hasn't caught up to mark it yet — keeps the
  // poller from waiting forever if a job somehow never got picked up.
  const age = Date.now() - new Date(job.created_at).getTime();
  if ((job.status === "queued" || job.status === "rendering") && age > QUEUE_CEILING_MS) {
    return Response.json({
      id: job.id,
      status: "failed",
      error: "This is taking longer than expected — please try again.",
    });
  }

  const aheadInQueue = job.status === "queued" ? await queuePositionAhead(env.DB, job) : 0;

  return Response.json({
    id: job.id,
    status: job.status,
    error: job.error,
    aheadInQueue,
    downloadUrl: job.status === "done" ? `/api/jobs/${job.id}/download` : null,
  });
};
