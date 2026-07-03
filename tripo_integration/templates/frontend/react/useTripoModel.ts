// React hook for Tripo generation.
//
// Usage:
//   const { generate, status, progress, glbUrl, error, isGenerating } = useTripoModel();
//   generate({ prompt: "a red apple" });
//
// Later render <TripoViewer glbUrl={glbUrl} /> (see TripoViewer.tsx).

import { useCallback, useEffect, useRef, useState } from "react";

export type TripoInput =
  | { prompt: string }
  | { imageUrl: string; imageFormat?: "png" | "jpeg" | "webp" }
  | { imageBase64: string; imageFormat?: "png" | "jpeg" | "webp" };

export interface UseTripoModelOptions {
  baseUrl?: string;         // default "/api/tripo"
  pollIntervalMs?: number;  // default 2000
  timeoutMs?: number;       // default 5 minutes
}

export type TripoStatus =
  | "idle"
  | "submitting"
  | "queued"
  | "running"
  | "success"
  | "failed";

export function useTripoModel(options: UseTripoModelOptions = {}) {
  const { baseUrl = "/api/tripo", pollIntervalMs = 2000, timeoutMs = 5 * 60_000 } = options;

  const [status, setStatus] = useState<TripoStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = useCallback(
    async (input: TripoInput) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setStatus("submitting");
      setProgress(0);
      setGlbUrl(null);
      setError(null);

      try {
        const createRes = await fetch(`${baseUrl}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: abort.signal,
        });
        if (!createRes.ok) {
          const body = await safeJson(createRes);
          throw new Error(body.error || `HTTP ${createRes.status}`);
        }
        const { taskId } = (await createRes.json()) as { taskId: string };

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (abort.signal.aborted) return;
          await sleep(pollIntervalMs, abort.signal);

          const res = await fetch(`${baseUrl}/status/${encodeURIComponent(taskId)}`, {
            signal: abort.signal,
          });
          if (!res.ok) {
            const body = await safeJson(res);
            throw new Error(body.error || `HTTP ${res.status}`);
          }
          const body = (await res.json()) as {
            status: string;
            progress: number;
            glbUrl?: string;
            error?: string;
          };
          setProgress(body.progress ?? 0);
          setStatus(normalizeStatus(body.status));

          if (body.status === "success" && body.glbUrl) {
            setGlbUrl(body.glbUrl);
            setStatus("success");
            return body.glbUrl;
          }
          if (body.error) throw new Error(body.error);
        }
        throw new Error("Task timed out");
      } catch (err) {
        if (abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("failed");
      }
    },
    [baseUrl, pollIntervalMs, timeoutMs]
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return {
    generate,
    cancel,
    status,
    progress,
    glbUrl,
    error,
    isGenerating: status === "submitting" || status === "queued" || status === "running",
  };
}

function normalizeStatus(s: string): TripoStatus {
  if (s === "queued" || s === "running" || s === "success" || s === "failed") return s;
  return "running"; // treat "unknown" as still running
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
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
