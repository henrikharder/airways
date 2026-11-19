# Airways — Airport Tycoon

Build an airport from an empty field near a real city. Lay out a runway,
taxiways and stands, paint a terminal and fill it with check-in, security,
gates and comforts, then sign real airlines and watch real aircraft and every
individual passenger move through it.

**Play it at https://henrikharder.github.io/airways/** (deployed from `main` on every push).
Found a bug or have an idea? Use “Send feedback” in the pause menu, or open an issue.

See [docs/AIRPORT_DESIGN.md](docs/AIRPORT_DESIGN.md) for the research and design.
The earlier airline tycoon is preserved at the git tag `v1-airline`.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests, a two-week new-player run and a three-day large-airport soak
npm run build      # typecheck + production build
npm run e2e        # browser smoke test against the build (needs Chrome installed)
LONG=1 npx vitest run src/game/long.test.ts   # 60-day balance run (~3 min)
```

Controls: drag to pan (or WASD), scroll to zoom, R to rotate a building, Q/E to
turn the view, B to bulldoze, H for the crowding view, Space to pause, 1–4 for
speed, Esc for the menu. On touch screens: tap, drag, pinch to zoom, two fingers
to pan.

Start in the sandbox (with an optional guided tutorial), or pick a scenario with
a goal and a deadline.

## Art

All sprites are modelled and rendered by Blender from code:

```bash
npm run art                       # render everything into public/sprites
blender --background --python art/build.py -- ac_A20N gate_   # only matching sprites
```

`art/build.py` builds detailed stylised models (aircraft from real dimensions,
with a lofted fuselage), renders them in Cycles at 128 px per tile with a fixed
2:1 isometric camera in four facings, and writes `src/generated/sprites.json`
with each sprite's anchor so the game can place it on the tile grid. A shadow
catcher bakes soft ground shadows into each sprite. Aircraft get a "livery mask"
render that the game tints with each airline's colour, plus a separate ground
shadow that stays on the ground while they fly. Sprites are written as WebP. A full render takes about 10
minutes (the first Cycles run also compiles GPU kernels).

```bash
blender --background --python art/build.py -- zoom A20N   # close-up check renders into art/debug
blender --background --python art/build.py -- side        # side views of every aircraft
```

## Layout

- `art/` — Blender modelling and rendering script
- `src/data/` — real airports, aircraft types and airlines
- `src/game/` — simulation (no DOM): grid and building rules, flow-field and taxi pathfinding, flights and aircraft motion, passenger agents, economy, weekly board
- `src/render/` — PixiJS isometric renderer
- `src/ui/` — game controller, panels, departure board

Saves live in `localStorage` and are written every game day.
