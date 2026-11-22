import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { requestGemini } from "../gemini.mjs";
import { bestPair, buildInput, compileChart, responseSchema } from "./chart.mjs";

const ROOT = "/api/custom-mix";
const LIBRARY = new URL("./library/", import.meta.url);
const TRACK_LABELS = new URL("./tracks.json", import.meta.url);
const PROMPT = new URL("./systemPrompt.md", import.meta.url);
const GENRES = ["edm", "pop", "rap"];

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}
function json(res, status, value) {
  if (res.destroyed) return;
  res.writeHead(status, {"Content-Type":"application/json", "Cache-Control":"no-store"});
  res.end(JSON.stringify(value));
}
async function catalog() {
  try {
    const [library, labels] = await Promise.all([
      readFile(new URL("tracks.json", LIBRARY), "utf8"),
      readFile(TRACK_LABELS, "utf8"),
    ]);
    const titles = new Map(JSON.parse(labels).map(([id, , , title]) => [id, title]));
    return JSON.parse(library)
      .filter(track => /^[a-z0-9-]+\.mp3$/.test(track.file) && track.sections?.length > 0)
      .map(track => ({ ...track, title: titles.get(track.id) ?? track.title }));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}
function publicTrack(track, section = track.sections[0]) {
  return {
    id:track.id, title:track.title, artist:track.artist, genre:track.genre, bpm:section ? Math.round(section.bpm) : null,
    file:ROOT + "/audio/" + track.id, previewStartSeconds:section?.startSeconds ?? 0,
  };
}
async function bodyOf(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw failure(415,"Expected JSON.");
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 4096) throw failure(413,"Request too large.");
  }
  try {
    const value = JSON.parse(data);
    if (value && typeof value === "object") return value;
  } catch { /* Consistent response for malformed bodies. */ }
  throw failure(400,"Invalid request.");
}
const audioFile = track => new URL("audio/"+track.file,LIBRARY);

async function sendAudio(req, res, track) {
  const file = audioFile(track);
  const {size} = await stat(file);
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]),size-1) : size-1;
  if (start >= size || end < start) {
    res.writeHead(416,{"Content-Range":`bytes */${size}`}); res.end(); return;
  }
  res.writeHead(range ? 206 : 200, {
    "Content-Type":"audio/mpeg","Accept-Ranges":"bytes","Content-Length":end-start+1,
    ...(range ? {"Content-Range":`bytes ${start}-${end}/${size}`} : {}),
  });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(file,{start,end});
  res.on("close",()=>stream.destroy());
  stream.on("error",()=>res.destroy());
  stream.pipe(res);
}

async function generate(a, b, pair, requestModel, { fresh = false } = {}) {
  const systemInstruction = await readFile(PROMPT,"utf8");
  const input = buildInput(a,b,pair);
  const key = createHash("sha256").update(JSON.stringify(["ai-v1",a.fingerprint,b.fingerprint,input,systemInstruction])).digest("hex");
  const folder = new URL("plans/",LIBRARY);
  const file = new URL(key+".json",folder);
  if (!fresh) {
    try {
      const saved = JSON.parse(await readFile(file,"utf8"));
      return compileChart(saved.plan,a,b,pair);
    } catch (error) {
      if (error.code && error.code !== "ENOENT") throw error;
    }
  }
  const audio = await Promise.all([[a, "DECK_A_AUDIO"],[b,"DECK_B_AUDIO"]].map(async ([track,label]) => ({
    label,bytes:await readFile(audioFile(track)),
  })));
  let feedback = "";
  for (let attempt=0; attempt<2; attempt++) {
    let plan;
    try {
      plan = await requestModel({systemInstruction, audio, schema:responseSchema, prompt:[
        "Evaluate the two labeled audio recordings and produce the requested executable JSON chart.",
        "The measured beat times and playback origins in INPUT_JSON are fixed. Section downbeat and phrasing labels are unavailable, so listen to the source audio to evaluate phrasing.",
        "Use one control per action, leave a full beat of rest between actions, include both decks, and finish Deck B's EQ and filter at neutral.",
        "Use at least three meaningful actions. Do not move Deck B controls or the crossfader before Deck B enters.",
        "The allowed transition window may now span many bars, not just a few seconds. Use the room: stage a real multi-phase transition "
          + "(for example an early EQ cut, a filter sweep, then the crossfade swap) spread across the musically best part of the window "
          + "rather than clustering every action right at the start of the window.",
        "INPUT_JSON",JSON.stringify(input),feedback,
      ].join("\n")});
    } catch (error) {
      const providerStatus = /HTTP (\d{3})/.exec(error.message)?.[1];
      throw failure(providerStatus === "429" ? 429 : 502, providerStatus === "429"
        ? "Gemini's quota is temporarily exhausted. Try this pair again later."
        : "Gemini could not generate a chart. Try this pair again.");
    }
    if (!plan) throw failure(503,"Set GEMINI_API_KEY in backend/.env.local to enable AI Mix.");
    if (plan.status === "ineligible") throw failure(422,"Gemini rejected this pairing. "+String(plan.eligibility?.reason ?? "").slice(0,160));
    try {
      const result = compileChart(plan,a,b,pair);
      if (!fresh) {
        await mkdir(folder,{recursive:true});
        await writeFile(file,JSON.stringify(result,null,2)+"\n");
      }
      return result;
    } catch (error) {
      feedback = "Revise the chart to satisfy this validator: " + error.message;
    }
  }
  throw failure(422,"Gemini couldn't make a playable chart for this pair. "+feedback.replace("Revise the chart to satisfy this validator: ",""));
}

export function createAiMixMiddleware({requestModel=requestGemini, readCatalog=catalog} = {}) {
  const requests = new Map();
  return async (req,res,next) => {
    const url = new URL(req.url,"http://localhost");
    if (!url.pathname.startsWith(ROOT+"/")) return next();
    try {
      if (req.headers["sec-fetch-site"] === "cross-site") throw failure(403,"Open MAINSTAGE directly to use AI Mix.");
      const tracks = await readCatalog();
      const lookup = id => tracks.find(track => track.id === id);
      if (url.pathname === ROOT+"/catalog" && req.method === "GET") {
        const genre = url.searchParams.get("genre");
        if (!GENRES.includes(genre)) throw failure(400,"Select Rap, Pop or EDM.");
        return json(res,200,{tracks:tracks.filter(track => track.genre === genre).map(track=>publicTrack(track))});
      }
      if (url.pathname === ROOT+"/matches" && req.method === "GET") {
        const a = lookup(url.searchParams.get("trackId"));
        if (!a) throw failure(404,"Song not found.");
        const matches = tracks.flatMap(b => {
          const pair = bestPair(a,b);
          return pair ? [{pair,track:b}] : [];
        }).sort((x,y) => x.pair.score-y.pair.score).slice(0,5).map(({pair,track})=>({
          ...publicTrack(track,pair.b),
          reason: pair.shift < 0.1 ? "Matching tempo" : `${pair.shift.toFixed(1)}% tempo adjustment`,
        }));
        return json(res,200,{matches});
      }
      if (url.pathname === ROOT+"/plan" && req.method === "POST") {
        const body = await bodyOf(req);
        const a = lookup(body.trackAId), b = lookup(body.trackBId), pair = bestPair(a,b);
        if (!pair) throw failure(422,"These tracks don't have a compatible beat window.");
        if (body.fresh === true) return json(res,200,await generate(a,b,pair,requestModel,{fresh:true}));
        const key = a.fingerprint + "/" + b.fingerprint;
        let request = requests.get(key);
        if (!request) {
          request = generate(a,b,pair,requestModel).finally(()=>requests.delete(key));
          requests.set(key,request);
        }
        return json(res,200,await request);
      }
      if (url.pathname.startsWith(ROOT+"/audio/") && ["GET","HEAD"].includes(req.method)) {
        const track = lookup(url.pathname.slice((ROOT+"/audio/").length));
        if (!track) throw failure(404,"Song not found.");
        return await sendAudio(req,res,track);
      }
      throw failure(404,"AI Mix endpoint not found.");
    } catch (error) {
      return json(res,error.status ?? 500,{error:error.status ? error.message : "AI Mix could not load."});
    }
  };
}
