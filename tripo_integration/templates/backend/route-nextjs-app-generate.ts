// Next.js App Router — POST /api/tripo/generate
// Path: app/api/tripo/generate/route.ts
//
// Expects tripo-handler.mjs to live at lib/tripo-handler.mjs (adjust import if different).

import { NextRequest, NextResponse } from "next/server";
import { createTripoTask, uploadImageToTripo } from "@/lib/tripo-handler.mjs";

export const runtime = "nodejs"; // need Buffer / form-data / real fetch body streaming

export async function POST(req: NextRequest) {
  try {
    const { prompt, imageUrl, imageBase64, imageFormat } = await req.json();
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
      return NextResponse.json(
        { error: "Provide prompt, imageUrl, or imageBase64" },
        { status: 400 }
      );
    }
    const { task_id } = await createTripoTask(input);
    return NextResponse.json({ taskId: task_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
