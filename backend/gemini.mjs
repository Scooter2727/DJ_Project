import { readFileSync } from "node:fs";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.8-flash";

function setupValue(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  let config;
  try {
    config = readFileSync(new URL("./.env.local", import.meta.url), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  for (const line of config.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index < 0 || line.slice(0, index).trim() !== name) continue;
    return line.slice(index + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return undefined;
}

export async function requestGemini({ prompt, schema, systemInstruction, audio = [], signal }) {
  const key = setupValue("GEMINI_API_KEY");
  if (!key) return null;
  const model = setupValue("GEMINI_MODEL") || DEFAULT_MODEL;
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const generationConfig = { temperature: 0.25, maxOutputTokens: 6500 };
  if (schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = schema;
  }
  if (model.startsWith("gemini-3")) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  if (model.includes("2.5-flash")) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }, ...audio.flatMap(({ label, bytes }) => [
      { text: label }, { inlineData: { mimeType: "audio/mpeg", data: bytes.toString("base64") } },
    ])] }],
    generationConfig,
  };
  if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(payload),
    signal: signal ?? AbortSignal.timeout(75000),
  });
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}`);
  const body = await response.json();
  const candidate = body.candidates?.[0];
  const result = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? "").join("");
  if (!result) throw new Error("Gemini did not return content");
  return schema ? JSON.parse(result) : result;
}
