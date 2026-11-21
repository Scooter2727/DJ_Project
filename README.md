# Deck Relay

A React console that mirrors MIDI input from the Pioneer DDJ-FLX4 and includes Crowd Factor, an on-device pose-tracking dance bonus.

## Run locally

Use Node.js 18 or newer. From the repository root, run:

```sh
cd frontend
npm install
npm run dev
```

Open the localhost URL printed by Vite in desktop Chrome or Edge. Plug the FLX4 into the computer using the controller's USB data port. Click **Connect DDJ-FLX4** and allow MIDI access. Move a fader or turn an EQ knob to check the connection. Select the Hot Cue pad mode on the controller to test the pad indicators.

If the controller does not appear, check that the cable supports data. If the MIDI input will not open, close other DJ software and reconnect.

The display follows MIDI messages as controls move. A dash means the app has yet to receive a value for that control. The Play indicator toggles with Play presses. The console displays controller input and does not play or mix audio.

## Crowd Factor

Click the page and grant front-camera access. A short beat starts, and countdown bars travel along the bottom toward the flick line. The bright band around the line is the timing window. Type a BPM from 60 to 180 in the number field and press Enter. Flick one hand above your shoulder as a bar reaches the line. An on-time flick raises the crowd meter, with a larger rise for a closer hit. Both arms above the shoulders on time multiplies that rise by 1.5. A missed bar adds nothing. A still hand, movement at or below the shoulders, or an off-beat flick lowers the meter. Finger shape does not add extra points.

Camera frames are processed locally in the browser and are not uploaded or recorded. Camera and MIDI access require `localhost` or HTTPS. The MediaPipe runtime and pose model are downloaded when the feature is first enabled, so the first start requires an internet connection.

Open `/vision-lab.html` to run the camera without a controller. The lab displays pose landmarks, detector metrics and gesture counts. Its sliders update detection thresholds immediately and can export the resulting configuration as JSON.

## Checks

```sh
cd frontend
npm test
npm run build
```
