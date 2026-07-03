// Next.js App Router — GET /api/tripo/status/[taskId]
// Path: app/api/tripo/status/[taskId]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getTripoTask } from "@/lib/tripo-handler.mjs";

export const runtime = "nodejs";

// Next 15 wraps params in a Promise; Next 14 passes a plain object.
// `await` handles both — plain objects resolve to themselves.
export async function GET(
  _req: NextRequest,
  { params }: { params: { taskId: string } | Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const result = await getTripoTask(taskId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
