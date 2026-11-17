# Airways — Airport Tycoon

Build an airport from an empty field near a real city. Lay out a runway,
taxiways and stands, paint a terminal and fill it with check-in, security,
gates and comforts, then sign real airlines and watch real aircraft and every
individual passenger move through it.

See [docs/AIRPORT_DESIGN.md](docs/AIRPORT_DESIGN.md) for the research and design.
The earlier airline tycoon is preserved at the git tag `v1-airline`.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests (building rules, pathfinding, a 48-hour simulation)
npm run build      # typecheck + production build
```

Controls: drag to pan (or WASD), scroll to zoom, R to rotate, B to bulldoze,
Space to pause, 1–4 for speed, Esc to cancel.

## Art

All sprites are modelled and rendered by Blender from code:

```bash
npm run art                       # render everything into public/sprites
blender --background --python art/build.py -- ac_A20N gate_   # only matching sprites
```

`art/build.py` builds stylised low-poly models (aircraft from real dimensions),
renders them with a fixed 2:1 isometric camera in four facings, and writes
`src/generated/sprites.json` with each sprite's anchor so the game can place it
on the tile grid. Aircraft get a second "livery mask" render that the game tints
with each airline's colour.

## Layout

- `art/` — Blender modelling and rendering script
- `src/data/` — real airports, aircraft types and airlines
- `src/game/` — simulation (no DOM): grid and building rules, flow-field and taxi pathfinding, flights and aircraft motion, passenger agents, economy, weekly board
- `src/render/` — PixiJS isometric renderer
- `src/ui/` — game controller, panels, departure board

Saves live in `localStorage` and are written every game day.
