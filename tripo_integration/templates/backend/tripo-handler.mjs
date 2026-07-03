// Tripo AI — framework-agnostic handler.
// Exposes three functions: createTripoTask, getTripoTask, uploadImageToTripo.
// Consumed by route adapters (Express, Next.js, Hono).
//
// API key is hardcoded on purpose for hackathon use.
// Rotate or remove this key after the event.

export const TRIPO_API_KEY = "tsk_dgUck16euLxZwpQWdZxx6ZJUOwm6WkBteCp-44gETVO";

const TRIPO_BASE = "https://api.tripo3d.ai/v2/openapi";

// Web-ready parameter recipe. These values bias output for realtime three.js rendering.
// See references/tripo-api.md §4 for rationale.
const WEB_READY_PARAMS = {
  model_version: "v3.1-20260211",
  face_limit: 10000,
  auto_size: true,
  texture: true,
  pbr: true,
  texture_quality: "standard",
};

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${TRIPO_API_KEY}`,
    ...extra,
  };
}

async function tripoFetch(path, init = {}) {
  const res = await fetch(`${TRIPO_BASE}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Tripo ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || body.code !== 0) {
    const msg = body.message || `HTTP ${res.status}`;
    const suggestion = body.suggestion ? ` — ${body.suggestion}` : "";
    throw new Error(`Tripo ${path} failed: ${msg}${suggestion}`);
  }
  return body.data;
}

/**
 * Upload an image to Tripo. Returns an image_token usable as file.file_token.
 * @param {Buffer | Blob | Uint8Array} bytes
 * @param {string} filename - e.g. "input.png"
 * @param {string} contentType - "image/png" | "image/jpeg" | "image/webp"
 * @returns {Promise<{ image_token: string }>}
 */
export async function uploadImageToTripo(bytes, filename, contentType) {
  const form = new FormData();
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: contentType });
  form.append("file", blob, filename);
  const data = await tripoFetch("/upload", {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  return data;
}

/**
 * Submit a generation task.
 *
 * Accepts one of:
 *   { prompt: string }                                   → text_to_model
 *   { imageUrl: string, imageFormat?: "png"|"jpeg"|"webp" } → image_to_model via URL
 *   { imageToken: string, imageFormat: "png"|"jpeg"|"webp" } → image_to_model via pre-uploaded token
 *
 * @returns {Promise<{ task_id: string }>}
 */
export async function createTripoTask(input) {
  const body = buildTaskBody(input);
  const data = await tripoFetch("/task", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return data;
}

function buildTaskBody(input) {
  if (input.prompt) {
    return {
      type: "text_to_model",
      prompt: input.prompt,
      ...WEB_READY_PARAMS,
    };
  }
  if (input.imageToken) {
    return {
      type: "image_to_model",
      file: { type: input.imageFormat || "png", file_token: input.imageToken },
      texture_alignment: "original_image",
      ...WEB_READY_PARAMS,
    };
  }
  if (input.imageUrl) {
    const fmt = input.imageFormat || inferFormatFromUrl(input.imageUrl);
    return {
      type: "image_to_model",
      file: { type: fmt, url: input.imageUrl },
      texture_alignment: "original_image",
      ...WEB_READY_PARAMS,
    };
  }
  throw new Error("createTripoTask requires one of: prompt, imageToken, imageUrl");
}

function inferFormatFromUrl(url) {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpeg";
  if (lower.endsWith(".webp")) return "webp";
  return "png";
}

/**
 * Fetch task status. Returns a normalized shape for the frontend:
 *   {
 *     status: "queued"|"running"|"success"|"failed"|"cancelled"|"unknown"|"banned"|"expired",
 *     progress: 0-100,
 *     glbUrl?: string,   // only when status === "success"
 *     error?: string,    // only when terminal failure
 *   }
 */
export async function getTripoTask(taskId) {
  const data = await tripoFetch(`/task/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: authHeaders(),
  });
  const status = data.status || "unknown";
  const progress = typeof data.progress === "number" ? data.progress : 0;
  const out = data.output || {};
  const glbUrl = status === "success" ? (out.pbr_model || out.model) : undefined;
  const error = ["failed", "cancelled", "banned", "expired"].includes(status)
    ? (data.error_msg || `task ${status}`)
    : undefined;
  return { status, progress, glbUrl, error };
}
