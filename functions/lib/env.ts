import type { QueueMessage } from "./jobs";

export interface Env {
  DB: D1Database;
  THUMBNAILS: R2Bucket;
  RENDER_QUEUE: Queue<QueueMessage>;
  ENVIRONMENT: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

export interface AdminData extends Record<string, unknown> {
  admin: { email: string };
}
