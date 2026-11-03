# Airways ✈

A browser airline tycoon. Found a startup airline at a real airport and compete
with 23 real airlines (British Airways, Emirates, SAS, Delta, Ryanair, …) across
~110 real airports with 19 real aircraft types.

See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for the research on existing
airline games and the feature set derived from it.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine + balance tests
npm run build      # typecheck + production build to dist/
```

Balance report (profitable opportunities per hub):

```bash
BALANCE=1 npx vitest run src/engine/balance-report.test.ts --disableConsoleIntercept
```

## Layout

- `src/data/` — real airports, aircraft types and airlines
- `src/engine/` — simulation (no DOM): demand model, daily sim, AI rivals, events, actions, route planner estimates
- `src/ui/` — map (D3 + canvas), side-panel views, app controller

Saves live in `localStorage` (autosave every game week) and can be exported/imported as JSON.
