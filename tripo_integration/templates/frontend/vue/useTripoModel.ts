// Vue 3 composable for Tripo generation.
//
// Usage (inside <script setup>):
//   const { generate, status, progress, glbUrl, error, isGenerating } = useTripoModel();
//   await generate({ prompt: "a red apple" });

import { onBeforeUnmount, ref, computed } from "vue";

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

  const status = ref<TripoStatus>("idle");
  const progress = ref(0);
  const glbUrl = ref<string | null>(null);
  const error = ref<string | null>(null);
  let abort: AbortController | null = null;

  onBeforeUnmount(() => abort?.abort());

  async function generate(input: TripoInput) {
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;

    status.value = "submitting";
    progress.value = 0;
    glbUrl.value = null;
    error.value = null;

    try {
      const createRes = await fetch(`${baseUrl}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
      if (!createRes.ok) {
        const body = await safeJson(createRes);
        throw new Error(body.error || `HTTP ${createRes.status}`);
      }
      const { taskId } = (await createRes.json()) as { taskId: string };

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (signal.aborted) return;
        await sleep(pollIntervalMs, signal);

        const res = await fetch(`${baseUrl}/status/${encodeURIComponent(taskId)}`, { signal });
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
        progress.value = body.progress ?? 0;
        status.value = normalizeStatus(body.status);

        if (body.status === "success" && body.glbUrl) {
          glbUrl.value = body.glbUrl;
          status.value = "success";
          return body.glbUrl;
        }
        if (body.error) throw new Error(body.error);
      }
      throw new Error("Task timed out");
    } catch (err) {
      if (signal.aborted) return;
      error.value = err instanceof Error ? err.message : String(err);
      status.value = "failed";
    }
  }

  const isGenerating = computed(
    () => status.value === "submitting" || status.value === "queued" || status.value === "running"
  );

  function cancel() {
    abort?.abort();
  }

  return { generate, cancel, status, progress, glbUrl, error, isGenerating };
}

function normalizeStatus(s: string): TripoStatus {
  if (s === "queued" || s === "running" || s === "success" || s === "failed") return s;
  return "running";
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
