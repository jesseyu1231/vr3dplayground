// Full minimal React example — prompt → generate → render.

import { useState } from "react";
import { useTripoModel } from "./useTripoModel";
import { TripoViewer } from "./TripoViewer";

export default function App() {
  const [prompt, setPrompt] = useState("a low-poly red apple");
  const { generate, status, progress, glbUrl, error, isGenerating } = useTripoModel();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ padding: 12, display: "flex", gap: 8 }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the model"
          style={{ flex: 1, padding: 8 }}
        />
        <button disabled={isGenerating} onClick={() => generate({ prompt })}>
          {isGenerating ? "Generating…" : "Generate"}
        </button>
      </div>
      <div style={{ padding: "4px 12px", fontSize: 13, color: "#08f" }}>
        {isGenerating && `${status} — ${progress}%`}
        {error && <span style={{ color: "#f44" }}>Error: {error}</span>}
      </div>
      <div style={{ flex: 1 }}>
        <TripoViewer glbUrl={glbUrl} />
      </div>
    </div>
  );
}
