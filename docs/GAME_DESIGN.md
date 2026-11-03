# Airways — Game Design

A browser-based airline tycoon. You found a startup airline at a real airport and
compete against real airlines for real city pairs.

## 1. Research: what players say about existing games

| Game | Reception | Loved | Hated |
|---|---|---|---|
| **Airline Manager 4** (Trophy Games, F2P) | Steam: Mostly Positive (~3.2k reviews) | Slick UI, real aircraft, long-term empire building | Flights run in **real time** ("a 5 hour flight takes 5 hours of your time"); **no schedules**, every landed plane must be re-dispatched by hand; pay real money to skip time; unrealistic demand means "biggest plane on the longest route" always wins (1,000+ A380 fleets) |
| **Airline Tycoon 2** (Kalypso) | Steam: Mostly Negative | Tongue-in-cheek tone | Only 8 fictional aircraft, shallow, confusing UI, rage-quit tutorial, arbitrary 8-hour workday, opaque finances |
| **Airline Tycoon Deluxe** (Spellbound, 1998) | Steam: Very Positive | Humour, rivals who actively sabotage you, real planes, fast intuitive flight management, "simple on the outside, deep underneath" | Dated graphics and stereotypes |
| **Airport CEO** | Steam: Very Positive (~7.7k) | Detail, watching your operation run, contract negotiation | Bugs, unintuitive GUI, performance late-game |
| **Aerobiz / Supersonic** (Koei, SNES) | Cult classic | Real cities, real aircraft, world events, "depth without being opaque", hard AI rivals | Steep learning curve |
| **AirlineSim / AirwaySim / Airline Club** (browser) | Niche but loyal | Real scheduling, competitive markets, passenger choice driven by price + quality + loyalty + connections (no flat "X demand A→B") | Steep learning curve, slow multiplayer pacing |

Sources: Steam community reviews (most-helpful, positive and negative) for AM4,
Airline Tycoon 2 and Airport CEO; OneMileAtATime "Airline management simulator
games"; Airline Club developer posts; Aerobiz retrospectives (MobyGames, LP Archive).

### Design pillars derived from the research

1. **You control time.** Pause and 4 speeds. Never wait for real-world hours, never pay to skip.
2. **Set it and run it.** Assign aircraft to a route and they fly an automatic rotation. Manage the network, not individual take-offs.
3. **Right plane, right route.** Demand is finite and price-sensitive. A 500-seat A380 on a thin route bleeds money; an A220 on a busy short route prints it.
4. **Real world.** Real IATA airports, real aircraft types with realistic seats/range/burn, real airlines as rivals.
5. **Rivals fight back.** AI airlines adjust fares, and pile onto markets where you're making money.
6. **Transparent depth.** Every number has an explanation: route planner shows demand, competitors and projected profit before you commit.
7. **Personality.** Witty news ticker and world events (Airline Tycoon's charm) without stereotypes.
8. **No pay-to-win, no grind walls.** It's a single-player game.

## 2. Feature set

### v1 (this build)
- **Startup**: choose airline name, 2-letter code, livery colour, hub (any of ~120 real airports), difficulty (starting cash).
- **World map**: D3 Natural Earth projection, zoom/pan, airports sized by traffic, great-circle routes, animated aircraft.
- **Time**: pause + 4 speeds; daily economic tick; aircraft animate along their rotation.
- **Aircraft market**: ~20 real types (ATR 72 → A380). Buy new, **lease** (low upfront), or buy **used** (random listings, older = cheaper but costlier to maintain). Sell anytime.
- **Cabin config**: Economy / Business split per aircraft.
- **Routes**: open from any base; assign aircraft; frequency derives from block time + turnaround; per-class fares with suggested fare.
- **Demand model**: gravity model (metro population × wealth × tourism ÷ distance), short-haul ground-transport penalty, price elasticity per class.
- **Passenger choice**: market share by price, frequency, quality (aircraft comfort/age, service level), reputation and local brand awareness.
- **Connections**: hub-and-spoke transfer passengers flow through your bases.
- **Costs**: fuel (fluctuating oil price), crew, maintenance (rises with age), airport/landing fees, lease, overhead, interest.
- **Bases**: open extra bases at other airports.
- **Finance**: loans with credit-rating-based interest, daily P&L, monthly history chart, company value.
- **Marketing & service**: marketing budget grows awareness; service level (catering etc.) affects quality and cost.
- **AI rivals**: ~15 real airlines with real hubs and routes; weekly fare adjustments; aggressive entry into your profitable markets; occasional new routes.
- **Events**: fuel spikes, strikes, ash clouds, sporting events, tourism booms, recessions — with witty news.
- **Goals**: onboarding checklist + milestone achievements + leaderboard vs real airlines.
- **Save/Load**: autosave to localStorage, export/import file.

### v2: immersion (built)
Driven by the same research: Airport CEO players love watching the operation run; Airline Tycoon Deluxe and Aerobiz are loved for rivals and events that force choices; AM4 reviewers ask for liveries, cabin design and personalisation.
- **Living map**: day/night terminator with city lights, take-off/landing pulses, contrails, floating revenue on landing, routes coloured by livery / profit / load and sized by passengers, flat or 3D globe.
- **Flight cards**: hover any aircraft for flight number, altitude, speed, passengers, ETA; click to follow it with the camera.
- **Departure boards**: split-flap boards built from every airline's live schedule (your hub on the overview, any airport on its page).
- **Decision cards**: crew pay disputes, charters, manufacturer deals, fuel hedges, audits, influencers, sustainable fuel, ash-cloud rerouting, and rival fare wars / route entries with in-character (fictional spokesperson) quotes.
- **Board meetings**: quarterly objectives with cash rewards; board confidence can get you fired.
- **Brand**: livery designer (5 patterns, any colours, fleet repaint cost), procedural side-view art for every aircraft type, visual seat-map cabin configurator.
- **Passenger reviews** that react to fares, aircraft comfort, service and crowding.
- **Celebrations**: delivery-day roll-outs, milestone confetti; **rival profiles** with threat level and clashes.
- **Sound**: synthesized jet whoosh, cash chime, split-flap clatter, PA chime, ambience (mute toggle).

### Later (backlog)
- Airport slots and curfews at congested hubs (LHR, JFK, HND).
- Cargo / belly freight.
- Alliances and codeshares with AI airlines.
- Staff, unions and training.
- Stock market / IPO / acquisitions of rivals.
- Premium economy & first class; lounges.
- Aircraft delivery queues and new-type launches over time.
- Scenarios (e.g. "1978 deregulation", "Rebuild after bankruptcy").
- Multiplayer.
