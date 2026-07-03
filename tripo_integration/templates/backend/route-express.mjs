// Express router for Tripo.
// Mount with: app.use('/api/tripo', tripoRouter);
//
// Endpoints:
//   POST /api/tripo/generate        → { taskId }
//     body: { prompt?: string, imageUrl?: string, imageBase64?: string, imageFormat?: "png"|"jpeg"|"webp" }
//   GET  /api/tripo/status/:taskId  → { status, progress, glbUrl?, error? }

import { Router } from "express";
import { createTripoTask, getTripoTask, uploadImageToTripo } from "./tripo-handler.mjs";

export const tripoRouter = Router();

tripoRouter.post("/generate", async (req, res) => {
  try {
    const { prompt, imageUrl, imageBase64, imageFormat } = req.body || {};
    let input;
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
    res.status(500).json({ error: err.message });
  }
});

tripoRouter.get("/status/:taskId", async (req, res) => {
  try {
    const result = await getTripoTask(req.params.taskId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
