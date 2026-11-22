# MAINSTAGE MIAMI

MAINSTAGE MIAMI is a rhythm game for the Pioneer DDJ-FLX4. Follow on-screen cues to mix two tracks with the knobs, jog wheels, and crossfader. The game includes an optional webcam-powered crowd hype meter.

## Run locally

Use Node.js 22 or newer. From the repository root:

```sh
npm --prefix frontend ci
npm run dev
```

Open the localhost URL printed by Vite. Use desktop Chrome or Edge for the DDJ-FLX4. Plug the controller in with a USB data cable, click **Connect** beneath **MIAMI**, and allow MIDI access. Once the button says **Connected**, turn a knob or choose **Start** to open the track selector.

You can also use **Start** without a controller. Use the arrow keys to browse the records and Enter to select one. The game has on-screen playback and crossfader controls, and AI Mix includes on-screen knobs.

## Play a preset mix

Select **VICE** for the bundled Alesso and Avicii mix. Spin the left jog wheel counterclockwise or click **Play track** to start Deck A. Deck B starts automatically at its scheduled cue. A well-timed clockwise spin on the right jog wheel earns optional bonus points.

## Play an AI Mix

1. Set `GEMINI_API_KEY` in `backend/.env.local`.
2. Install FFmpeg and `librosa==0.11.0`, then import the local music folders from the repository root.

   ```sh
   python3 backend/aiMix/importLibrary.py ~/Downloads
   ```

3. Select the **GEMINI** vinyl, choose a genre, then pick Song 1 and a compatible Song 2.
4. Gemini analyzes both audio files with the v3 system prompt. MAINSTAGE validates the resulting chart before opening the game. Use **Preview mix** to watch the transition, **Play challenge** to perform it, or **Download chart** to save the JSON.

The importer expects the `Rap`, `pop`, and `edm` folders. The API key, imported audio, and generated charts are ignored by Git. Each machine needs its own key and a local import of the song files for AI Mix. See the [backend setup and import notes](backend/README.md) for details.

## Verify the build

```sh
npm test
npm run build
npm --prefix frontend run preview
```
