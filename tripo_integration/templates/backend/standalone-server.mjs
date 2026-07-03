// Standalone Express server — use when the project has no backend yet.
// Run: npm install && npm start
// Listens on :8787 by default. Change PORT env var to override.

import express from "express";
import cors from "cors";
import { tripoRouter } from "./route-express.mjs";

const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.use(cors()); // permissive CORS: dev-friendly, hackathon-friendly
app.use(express.json({ limit: "25mb" })); // large limit so base64 images fit

app.use("/api/tripo", tripoRouter);

app.get("/", (_req, res) => {
  res.send("Tripo backend up. POST /api/tripo/generate");
});

app.listen(PORT, () => {
  console.log(`Tripo backend listening on http://localhost:${PORT}`);
});
