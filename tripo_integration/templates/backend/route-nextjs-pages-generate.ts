// Next.js Pages Router — POST /api/tripo/generate
// Path: pages/api/tripo/generate.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { createTripoTask, uploadImageToTripo } from "@/lib/tripo-handler.mjs";

export const config = {
  api: { bodyParser: { sizeLimit: "25mb" } }, // base64 images can be large
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { prompt, imageUrl, imageBase64, imageFormat } = req.body || {};
    let input: Parameters<typeof createTripoTask>[0];
    if (prompt) {
      input = { prompt };
    } else if (imageBase64) {
      const bytes = Buffer.from(imageBase64, "base64");
      const fmt = imageFormat || "png";
      const { image_token } = await uploadImageToTripo(bytes, `input.${fmt}`, `image/${fmt}`);
      input = { imageToken: image_token, imageFormat: fmt };
    } else if (imageUrl) {
      input = { imageUrl, imageFormat };
    } else {
      return res.status(400).json({ error: "Provide prompt, imageUrl, or imageBase64" });
    }
    const { task_id } = await createTripoTask(input);
    res.json({ taskId: task_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}
