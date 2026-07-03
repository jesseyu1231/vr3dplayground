// Vanilla TS client for Tripo generation.
// Talks to the backend routes installed by this skill (default: /api/tripo).
//
// Usage:
//   const glbUrl = await generateTripoModel({ prompt: "a red apple" }, {
//     onProgress: (p) => console.log(`${p}%`),
//   });
//   // then load glbUrl with GLTFLoader — see viewer.ts

export type TripoInput =
  | { prompt: string }
  | { imageUrl: string; imageFormat?: "png" | "jpeg" | "webp" }
  | { imageBase64: string; imageFormat?: "png" | "jpeg" | "webp" };

export interface GenerateOptions {
  /** Backend base path. Default "/api/tripo". */
  baseUrl?: string;
  /** Polling interval in ms. Default 2000. */
  pollIntervalMs?: number;
  /** Timeout in ms. Default 5 minutes. */
  timeoutMs?: number;
  /** Called with 0–100 every poll. */
  onProgress?: (progress: number, status: string) => void;
  /** AbortSignal to cancel polling. */
  signal?: AbortSignal;
}

export async function generateTripoModel(
  input: TripoInput,
  options: GenerateOptions = {}
): Promise<string> {
  const baseUrl = options.baseUrl ?? "/api/tripo";
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;

  const createRes = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: options.signal,
  });
  if (!createRes.ok) {
    const err = await safeJson(createRes);
    throw new Error(err.error || `Tripo generate failed: HTTP ${createRes.status}`);
  }
  const { taskId } = (await createRes.json()) as { taskId: string };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await sleep(pollIntervalMs, options.signal);

    const statusRes = await fetch(`${baseUrl}/status/${encodeURIComponent(taskId)}`, {
      signal: options.signal,
    });
    if (!statusRes.ok) {
      const err = await safeJson(statusRes);
      throw new Error(err.error || `Tripo status failed: HTTP ${statusRes.status}`);
    }
    const body = (await statusRes.json()) as {
      status: string;
      progress: number;
      glbUrl?: string;
      error?: string;
    };
    options.onProgress?.(body.progress, body.status);

    if (body.status === "success" && body.glbUrl) return body.glbUrl;
    if (body.error) throw new Error(body.error);
  }
  throw new Error(`Tripo task ${taskId} timed out after ${timeoutMs}ms`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

async function safeJson(res: Response): Promise<{ error?: string }> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}
