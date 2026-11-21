import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeDance, createDanceState } from "./danceScorer.js";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const MEDIAPIPE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const EMPTY_METRICS = { detected: false, score: 0, crowd: 0, burst: 0, motion: 0, raised: 0, armsUp: 0, flickPulse: 0, pumpPulse: 0 };
const EMPTY_GESTURES = { leftFlick: false, rightFlick: false, leftPump: false, rightPump: false };

export function usePoseTracker({ videoRef, config, maxFps = 15, onFrame, onMask }) {
  const [snapshot, setSnapshot] = useState({
    status: "off",
    message: "Camera is off",
    cameraActive: false,
    landmarks: null,
    metrics: EMPTY_METRICS,
    gestures: EMPTY_GESTURES,
    inferenceMs: 0,
  });
  const mounted = useRef(true);
  const request = useRef(null);
  const stream = useRef(null);
  const landmarker = useRef(null);
  const animation = useRef(null);
  const lastVideoTime = useRef(-1);
  const lastInferenceAt = useRef(0);
  const danceState = useRef(createDanceState());
  const configRef = useRef(config);
  const onFrameRef = useRef(onFrame);
  const onMaskRef = useRef(onMask);
  const outputSegmentationMasks = Boolean(onMask);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { onMaskRef.current = onMask; }, [onMask]);

  const stop = useCallback(() => {
    request.current = null;
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    landmarker.current?.close();
    landmarker.current = null;
    danceState.current = createDanceState();
    lastVideoTime.current = -1;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mounted.current) setSnapshot({
      status: "off",
      message: "Camera is off",
      cameraActive: false,
      landmarks: null,
      metrics: EMPTY_METRICS,
      gestures: EMPTY_GESTURES,
      inferenceMs: 0,
    });
  }, [videoRef]);

  const start = useCallback(async () => {
    if (request.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setSnapshot(current => ({ ...current, status: "error", message: "Camera needs HTTPS or localhost." }));
      return;
    }

    const attempt = {};
    request.current = attempt;
    let cameraReady = false;
    try {
      setSnapshot(current => ({ ...current, status: "loading", message: "Requesting camera…" }));
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      if (request.current !== attempt) {
        cameraStream.getTracks().forEach(track => track.stop());
        return;
      }
      const video = videoRef.current;
      stream.current = cameraStream;
      video.srcObject = cameraStream;
      await video.play();
      if (request.current !== attempt) return;
      cameraReady = true;

      setSnapshot(current => ({ ...current, status: "loading", cameraActive: true, message: "Loading pose model…" }));
      // Keep this as a browser-side CDN import so the app can build even when
      // the optional MediaPipe package has not been installed locally yet.
      const { FilesetResolver, PoseLandmarker } = await import(/* @vite-ignore */ MEDIAPIPE_MODULE_URL);
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      if (request.current !== attempt) return;
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks,
      };
      let tracker;
      try {
        tracker = await PoseLandmarker.createFromOptions(vision, options);
      } catch {
        if (request.current !== attempt) return;
        const cpuOptions = {
          ...options,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        };
        try {
          tracker = await PoseLandmarker.createFromOptions(vision, cpuOptions);
        } catch (error) {
          if (!outputSegmentationMasks || request.current !== attempt) throw error;
          tracker = await PoseLandmarker.createFromOptions(vision, { ...cpuOptions, outputSegmentationMasks: false });
        }
      }
      if (request.current !== attempt) {
        tracker.close();
        return;
      }
      landmarker.current = tracker;
      setSnapshot(current => ({ ...current, status: "tracking", message: "Pose model ready" }));

      const loop = now => {
        if (request.current !== attempt) return;
        const activeVideo = videoRef.current;
        const interval = 1000 / maxFps;
        if (
          landmarker.current
          && activeVideo?.readyState >= 2
          && activeVideo.currentTime !== lastVideoTime.current
          && now - lastInferenceAt.current >= interval
        ) {
          lastVideoTime.current = activeVideo.currentTime;
          lastInferenceAt.current = now;
          const started = performance.now();
          landmarker.current.detectForVideo(activeVideo, now, result => {
            if (request.current !== attempt) return;
            const landmarks = result.landmarks?.[0] ?? null;
            const analyzed = analyzeDance(landmarks, now, danceState.current, configRef.current);
            danceState.current = analyzed.state;
            const next = {
              status: landmarks ? "tracking" : "no-pose",
              message: landmarks ? "Dancer tracked" : "Step back so your arms are visible",
              cameraActive: true,
              landmarks,
              metrics: analyzed.metrics,
              gestures: analyzed.gestures,
              flickAt: analyzed.flickAt,
              timestamp: now,
              inferenceMs: performance.now() - started,
            };
            if (mounted.current) setSnapshot(next);
            onFrameRef.current?.(next);
            // MediaPipe owns the mask and releases it when this callback returns.
            onMaskRef.current?.(landmarks ? result.segmentationMasks?.[0] : null, now);
          });
        }
        if (request.current === attempt) animation.current = requestAnimationFrame(loop);
      };
      animation.current = requestAnimationFrame(loop);
    } catch (error) {
      if (request.current !== attempt) return;
      if (!cameraReady) stop();
      const denied = error?.name === "NotAllowedError";
      if (mounted.current) setSnapshot(current => ({
        ...current,
        status: "error",
        message: cameraReady
          ? `Pose tracking unavailable: ${error?.message || "Unknown error"}`
          : denied ? "Camera permission was denied." : `Camera could not start: ${error?.message || "Unknown error"}`,
      }));
    }
  }, [maxFps, outputSegmentationMasks, stop, videoRef]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);

  return { ...snapshot, start, stop };
}
