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

## In-app audio challenge mode

Deck Relay loads the two bundled `mix1` tracks into its own Web Audio mixer. Rekordbox is not required. Connect the FLX4 and load `mix1`. Spin the left jog wheel counter-clockwise to start Deck A and begin the challenge; spin the right jog wheel clockwise to start Deck B. Jog starts are recorded as Play inputs. The crossfader controls the blend between the two tracks, while EQ and CFX shape each deck. The app scores the live performance against the reference timeline.

The bundled `mix1` sources are `frontend/public/mixes/mix1/deck-a.mp3` (Alesso — *Heroes (we could be)*) and `frontend/public/mixes/mix1/deck-b.mp3` (Avicii — *Levels (Radio Edit)*).

The display follows MIDI messages as controls move. A dash means the app has yet to receive a value for that control. The Play indicator toggles with Play presses. Jog wheels remain available for the game layer and can be mapped to scratching or seeking later.
