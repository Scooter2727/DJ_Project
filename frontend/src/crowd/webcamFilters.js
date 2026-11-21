const POSE_FRESH_MS = 150;
const MASK_FRESH_MS = 180;
const MASK_INTERVAL_MS = 1000 / 15;
const CONFETTI_COLORS = ["#50eaff", "#ff49b4", "#ffe780", "#ae7dff", "#d7ff70"];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (start, end, progress) => start + (end - start) * progress;

function visible(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= 0.5;
}

function project(point, view) {
  const x = view.left + point.x * view.drawWidth;
  return { x: view.mirror ? view.width - x : x, y: view.top + point.y * view.drawHeight };
}

export function getHeadTransform(points, view) {
  const { leftEye, rightEye, leftEar, rightEar, nose } = points ?? {};
  if (!visible(leftEye) || !visible(rightEye)) return null;
  const eyes = [project(leftEye, view), project(rightEye, view)].sort((a, b) => a.x - b.x);
  const dx = eyes[1].x - eyes[0].x;
  const dy = eyes[1].y - eyes[0].y;
  const eyeWidth = Math.hypot(dx, dy);
  if (eyeWidth < 3) return null;

  const x = (eyes[0].x + eyes[1].x) / 2;
  const y = (eyes[0].y + eyes[1].y) / 2;
  const earWidth = visible(leftEar) && visible(rightEar)
    ? Math.abs(project(leftEar, view).x - project(rightEar, view).x) : 0;
  const width = clamp(earWidth * 1.02, eyeWidth * 2.15, eyeWidth * 2.85);
  const bridge = visible(nose) ? project(nose, view) : null;
  const turn = bridge ? clamp(((bridge.x - x) * dx + (bridge.y - y) * dy) / eyeWidth ** 2, -1, 1) : 0;

  return { x, y, width, angle: clamp(Math.atan2(dy, dx), -1.1, 1.1), turn };
}

export function getNeckTransform(points, view) {
  const { leftShoulder, rightShoulder } = points ?? {};
  if (!visible(leftShoulder) || !visible(rightShoulder)) return null;
  const [left, right] = [project(leftShoulder, view), project(rightShoulder, view)].sort((a, b) => a.x - b.x);
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const width = Math.hypot(dx, dy);
  if (width < 10 || dx < width * 0.4) return null;
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, width, angle: Math.atan2(dy, dx) };
}

function polygon(ctx, color, points) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fill();
}

const CAP_PIXELS = [
  "...........############.......",
  "........###hhhhhhhhhhhh###....",
  "......##hhhhhhhhpppppppppp##..",
  ".....#hhhhhhpppppppppppppppp#.",
  "....#hhhhppppppppppppppppppps#",
  "....#hpppppppppppppppppppppss#",
  "....#hppppppppppppppppppppsss#",
  "...#hppppppppp######pppppssss#",
  "...#hpppppppp#ssssss#pppsssss#",
  "...#hppppppp#ss....ss#pssssss#",
  ".###pppppppp#s......s#sssssss#",
  "#hhh#ppppppp#s......s#sssssss#",
  "#ppp#pppppppppppppppppsssssss#",
  ".###hhhhhhhhhhhhhhhhhhhhhhhhh#",
  "...#pppppppph#h#h#h#pppssssss#",
  "....#########################.",
];
const CAP_COLORS = { "#": "#160c23", h: "#a477ef", p: "#6940a6", s: "#43265e" };
const CHAIN_COLORS = { "#": "#4c2b0c", g: "#cf871f", y: "#f8c442", h: "#fff0a2" };

function drawPixelRows(ctx, rows, palette, left = 0, top = 0) {
  for (const [y, row] of rows.entries()) {
    for (const [x, pixel] of [...row].entries()) {
      const color = palette[pixel];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(left + x, top + y, 1, 1);
    }
  }
}

let capSprite;
let chainSprite;

function drawBackwardCap(ctx, turn) {
  if (!capSprite) {
    capSprite = document.createElement("canvas");
    capSprite.width = 30;
    capSprite.height = CAP_PIXELS.length;
    drawPixelRows(capSprite.getContext("2d"), CAP_PIXELS, CAP_COLORS);
  }
  ctx.translate(turn * 7, -29);
  ctx.scale((turn > 0 ? -1 : 1) * (1 - Math.abs(turn) * 0.12), 1);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(capSprite, -71, -57, 125, 62);
}

function drawGoldChain(ctx) {
  if (!chainSprite) {
    chainSprite = document.createElement("canvas");
    chainSprite.width = 29;
    chainSprite.height = 23;
    const sprite = chainSprite.getContext("2d");
    const link = [".####.", "#hyyy#", "#yg.g#", ".#gg#."];
    const narrowLink = ["..##..", ".#hy#.", ".#yg#.", "..##.."];
    for (let i = 0; i < 15; i += 1) {
      const angle = 0.1 + (Math.PI - 0.2) * i / 14;
      const x = Math.round(11.5 + Math.cos(angle) * 11.5);
      const y = Math.round(Math.sin(angle) * 18);
      drawPixelRows(sprite, i % 2 === 0 ? link : narrowLink, CHAIN_COLORS, x, y);
    }
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(chainSprite, -29, -21, 58, 40);
}

function drawLights(ctx, width, height, beat, intensity, still) {
  const phase = still ? 0 : beat;
  const pulse = still ? 0.95 : 0.94 + 0.06 * Math.cos(phase * Math.PI * 2);
  const halfWidth = width * 0.19;
  ctx.save();
  for (const [index, color] of ["#49e7ff", "#ff44bb", "#b582ff"].entries()) {
    const sourceX = width * (0.17 + index * 0.33);
    const beamX = sourceX + Math.sin(phase * 0.55 + index * 2) * width * 0.24;
    const glow = ctx.createRadialGradient(sourceX, 0, 3, sourceX, 0, height * 0.8);
    glow.addColorStop(0, color);
    glow.addColorStop(1, color + "00");
    ctx.globalAlpha = intensity * pulse * 0.12;
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = intensity * pulse * 0.24;
    polygon(ctx, color, [[sourceX - 4, 0], [sourceX + 4, 0], [beamX + halfWidth, height], [beamX - halfWidth, height]]);
  }
  ctx.restore();
}

function createConfetti(id) {
  let seed = id + 73;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  return Array.from({ length: 90 }, (_, index) => ({
    x: random(), delay: random() ** 2 * 1.8, speed: 0.24 + random() * 0.29,
    size: 3 + random() * 6, spin: (random() - 0.5) * 8, phase: random() * Math.PI * 2,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  }));
}

function drawConfetti(ctx, width, height, celebration, pieces) {
  ctx.globalAlpha = clamp((celebration.duration - celebration.elapsed) / 0.65, 0, 1);
  for (const piece of pieces) {
    const age = celebration.elapsed - piece.delay;
    if (age < 0 || age * piece.speed > 1.12) continue;
    const x = width * piece.x + Math.sin(age * 3.1 + piece.phase) * Math.min(age * 18, 18);
    const y = height * (age * piece.speed - 0.08);
    const flip = 0.22 + 0.78 * Math.abs(Math.cos(age * 5 + piece.phase));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(age * piece.spin + piece.phase);
    ctx.fillStyle = piece.color;
    ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * flip);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export function createWebcamFilters() {
  let points, head, neck, mask, maskPixels, background, confetti;
  let poseAt = -Infinity;
  let maskAt = -Infinity;
  let wantsMask = false;
  let maskReadFailed = false;
  let hatAlpha = 0;
  let chainAlpha = 0;
  let lightsAlpha = 0;

  function updatePose(landmarks, timestamp) {
    if (!landmarks) {
      points = null;
      return;
    }
    points = {
      nose: landmarks[0], leftEye: landmarks[2], rightEye: landmarks[5], leftEar: landmarks[7], rightEar: landmarks[8],
      leftShoulder: landmarks[11], rightShoulder: landmarks[12],
    };
    poseAt = timestamp;
  }

  function updateMask(person, timestamp) {
    if (!person) {
      maskAt = -Infinity;
      return;
    }
    if (!wantsMask || maskReadFailed || timestamp - maskAt < MASK_INTERVAL_MS) return;
    try {
      const { width, height } = person;
      const confidence = person.getAsFloat32Array();
      mask ??= document.createElement("canvas").getContext("2d");
      if (mask.canvas.width !== width || mask.canvas.height !== height || !maskPixels) {
        mask.canvas.width = width;
        mask.canvas.height = height;
        maskPixels = mask.createImageData(width, height);
      }
      for (let i = 0; i < confidence.length; i += 1) {
        maskPixels.data[i * 4 + 3] = clamp((confidence[i] - 0.2) / 0.6, 0, 1) * 255;
      }
      mask.putImageData(maskPixels, 0, 0);
      maskAt = timestamp;
    } catch {
      // GPU readback can fail on some devices. Keep pose scoring and accessories active.
      maskReadFailed = true;
    }
  }

  function drawBackground(ctx, view, hype, reducedMotion) {
    const { width, height, left, top, drawWidth, drawHeight, mirror } = view;
    background ??= document.createElement("canvas").getContext("2d");
    if (background.canvas.width !== width || background.canvas.height !== height) {
      background.canvas.width = width;
      background.canvas.height = height;
    }
    background.clearRect(0, 0, width, height);
    drawLights(background, width, height, hype.beat ?? 0, lightsAlpha, reducedMotion);
    const celebration = reducedMotion ? null : hype.celebration;
    if (celebration) {
      if (confetti?.id !== celebration.id) confetti = { id: celebration.id, pieces: createConfetti(celebration.id) };
      drawConfetti(background, width, height, celebration, confetti.pieces);
    } else {
      confetti = null;
    }

    background.save();
    background.globalCompositeOperation = "destination-out";
    if (mirror) {
      background.translate(width, 0);
      background.scale(-1, 1);
    }
    background.drawImage(mask.canvas, left, top, drawWidth, drawHeight);
    background.restore();
    ctx.drawImage(background.canvas, 0, 0);
  }

  function draw(ctx, view, hype, dt, reducedMotion) {
    const tier = hype?.tier ?? 0;
    const now = performance.now();
    const tracked = now - poseAt <= POSE_FRESH_MS ? points : null;
    const nextHead = getHeadTransform(tracked, view);
    const nextNeck = getNeckTransform(tracked, view);
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 22);
    if (nextHead) {
      head = head ? {
        x: lerp(head.x, nextHead.x, ease), y: lerp(head.y, nextHead.y, ease),
        width: lerp(head.width, nextHead.width, ease), angle: lerp(head.angle, nextHead.angle, ease),
        turn: lerp(head.turn, nextHead.turn, ease),
      } : nextHead;
    }
    if (nextNeck) {
      neck = neck ? {
        x: lerp(neck.x, nextNeck.x, ease), y: lerp(neck.y, nextNeck.y, ease),
        width: lerp(neck.width, nextNeck.width, ease), angle: lerp(neck.angle, nextNeck.angle, ease),
      } : nextNeck;
    }
    hatAlpha = lerp(hatAlpha, nextHead && tier >= 2 ? 1 : 0, ease);
    chainAlpha = lerp(chainAlpha, nextNeck && hype?.level > 25 ? 1 : 0, ease);
    lightsAlpha = lerp(lightsAlpha, tier === 3 ? 1 : 0, ease);
    wantsMask = lightsAlpha > 0.01;
    if (wantsMask && hype && mask && now - maskAt <= MASK_FRESH_MS) drawBackground(ctx, view, hype, reducedMotion);

    if (neck && chainAlpha > 0.01) {
      ctx.save();
      ctx.translate(neck.x, neck.y);
      ctx.rotate(neck.angle);
      ctx.scale(neck.width / 100, neck.width / 100);
      ctx.globalAlpha = chainAlpha;
      drawGoldChain(ctx);
      ctx.restore();
    } else if (!nextNeck) {
      neck = null;
    }
    if (head && hatAlpha > 0.01) {
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(head.angle);
      ctx.scale(head.width / 100, head.width / 100);
      ctx.globalAlpha = hatAlpha;
      drawBackwardCap(ctx, head.turn);
      ctx.restore();
    } else if (!nextHead) {
      head = null;
    }
  }

  function reset() {
    points = head = neck = confetti = null;
    poseAt = maskAt = -Infinity;
    hatAlpha = chainAlpha = lightsAlpha = 0;
    wantsMask = maskReadFailed = false;
  }

  return { updatePose, updateMask, draw, reset };
}
