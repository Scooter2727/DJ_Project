# Deck Relay

A React console that mirrors MIDI input from the Pioneer DDJ-FLX4.

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
