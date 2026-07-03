// Hono route for Tripo. Works on Node, Bun, Deno, and Cloudflare Workers.
// Mount with: app.route("/api/tripo", tripoRoutes);
//
// Note for Cloudflare Workers: move TRIPO_API_KEY into a wrangler secret and
// refactor tripo-handler.mjs to read from env, because Workers doesn't have a
// persistent filesystem. For plain Node/Bun, leave the hardcoded key as-is.

import { Hono } from "hono";
import { createTripoTask, getTripoTask, uploadImageToTripo } from "./tripo-handler.mjs";

export const tripoRoutes = new Hono();

tripoRoutes.post("/generate", async (c) => {
  try {
    const { prompt, imageUrl, imageBase64, imageFormat } = await c.req.json();
    let input: Parameters<typeof createTripoTask>[0];
    if (prompt) {
      input = { prompt };
    } else if (imageBase64) {
      const bytes = Uint8Array.from(atob(imageBase64), (ch) => ch.charCodeAt(0));
      const fmt = imageFormat || "png";
      const { image_token } = await uploadImageToTripo(bytes, `input.${fmt}`, `image/${fmt}`);
      input = { imageToken: image_token, imageFormat: fmt };
    } else if (imageUrl) {
      input = { imageUrl, imageFormat };
    } else {
      return c.json({ error: "Provide prompt, imageUrl, or imageBase64" }, 400);
    }
    const { task_id } = await createTripoTask(input);
    return c.json({ taskId: task_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

tripoRoutes.get("/status/:taskId", async (c) => {
  try {
    const result = await getTripoTask(c.req.param("taskId"));
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});
