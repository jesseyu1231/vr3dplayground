// Next.js Pages Router — GET /api/tripo/status/[taskId]
// Path: pages/api/tripo/status/[taskId].ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getTripoTask } from "@/lib/tripo-handler.mjs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const taskId = req.query.taskId;
    if (typeof taskId !== "string") return res.status(400).json({ error: "Invalid taskId" });
    const result = await getTripoTask(taskId);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}
