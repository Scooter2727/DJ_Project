import React, { useEffect, useRef } from "react";

const ARM_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24];

export function PoseOverlay({ landmarks }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!landmarks) return;

    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = "#dbfa93";
    context.shadowBlur = 12;
    context.shadowColor = "#dbfa93";
    for (const [from, to] of ARM_CONNECTIONS) {
      const a = landmarks[from];
      const b = landmarks[to];
      if (!a || !b || (a.visibility ?? 1) < 0.5 || (b.visibility ?? 1) < 0.5) continue;
      context.beginPath();
      context.moveTo(a.x * width, a.y * height);
      context.lineTo(b.x * width, b.y * height);
      context.stroke();
    }

    context.shadowBlur = 8;
    for (const index of JOINTS) {
      const point = landmarks[index];
      if (!point || (point.visibility ?? 1) < 0.5) continue;
      context.beginPath();
      context.fillStyle = index === 15 || index === 16 ? "#ff7ee2" : "#101217";
      context.strokeStyle = "#dbfa93";
      context.lineWidth = 3;
      context.arc(point.x * width, point.y * height, index === 15 || index === 16 ? 7 : 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }, [landmarks]);

  return <canvas ref={canvasRef} className="pose-overlay" aria-hidden="true" />;
}
