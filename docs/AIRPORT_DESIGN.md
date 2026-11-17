# Airways — Airport Tycoon design

The airline tycoon (tag `v1-airline`) pivots to an airport builder. You found a
new airport near a real city, build it from modules on an empty site, sign
contracts with real airlines, and watch individual passengers and real aircraft
move through it.

## Decisions (from the kickoff Q&A)

| Topic | Choice |
|---|---|
| Core loop | Modular site builder: place pre-built modules; no wall-by-wall building |
| Setting | Greenfield site near a real city; real airlines and aircraft |
| Passengers | Every passenger is an agent with a journey plus comforts |
| Look | Colourful isometric, fixed camera, stylised low-poly |
| Art | Modelled and rendered by scripts in Blender (`npm run art`) |
| Carried over | Board objectives, split-flap departure board, real data (airports, aircraft, airlines) |
| Dropped | Airline-side network play, decision cards, sound (for now) |

## What players say about airport builders

- **Airport CEO** (Very Positive): love starting from an empty field and "simply enjoying watching your airport work"; contract negotiation. Hate pathfinding bugs (staff and passengers getting stuck), clunky UI, late-game performance.
- **SimAirport**: love the balance "between making more money and managing bottlenecks such as check-in, security and boarding" and watching the airport evolve. Hate a confusing UI and tutorials, unrealistic scale ("way too many runways and security for a small number of gates"), and AI agents getting stuck.

### Pillars
1. **Never stuck.** Passengers navigate by precomputed flow fields per destination, so every reachable target is always reachable, and the build tool refuses layouts that disconnect a required step (and says why).
2. **Bottlenecks you can see.** Queues form visibly at check-in, security and gates; overlays colour congestion; every module shows throughput and wait time.
3. **Believable scale.** One runway handles a realistic number of movements; stands sized by real aircraft; one security lane handles a realistic flow.
4. **Clear UI.** Build menu by category, ghost placement with green/red validity, inline costs, a guided first day.
5. **Real world.** Real airlines bid for routes to real destinations; real aircraft (from published dimensions) taxi and park.

## Scale and time

- 1 tile = 5 m. A320 ≈ 7.5 tiles long; A380 ≈ 14.5. Runway compressed to 100 × 6 tiles.
- Fixed 2:1 isometric camera; everything rendered in 4 facings (grid axes).
- Clock: 1× = 1 game hour per real minute; 2×, 4×, 8× and pause. Board meetings every game week.

## Modules (v1)

| Area | Module | Notes |
|---|---|---|
| Airside | Runway | 100×6; needs a control tower to operate |
| | Taxiway | Paint 2-wide paths; aircraft route over them |
| | Stand S / M / L / XL | Size by wingspan class; connect to taxiway and a gate |
| | Control tower | Required for any traffic |
| Terminal | Terminal floor | Paint the building footprint; defines indoor space |
| | Entrance | Landside door; passengers arrive and leave here |
| | Check-in row | Queue + service; landside |
| | Security lane | Divides landside and airside |
| | Gate | Seating area linked to one stand (jet bridge drawn automatically) |
| | Food court, shop, toilets, seating | Comforts: revenue and satisfaction |
| | Baggage claim | Arrivals wait for bags here |
| Landside | Car park | Parking revenue |

## Passengers (agents)

Departures: arrive at an entrance 60–150 min before departure → check in (queue) → security (queue) → comforts by need (hunger, shopping, toilet, rest) → gate → board when called.
Arrivals: deplane at the gate → (toilets) → baggage claim → exit.
Satisfaction falls with queue time, crowding, unmet needs, missed flights; it feeds airline happiness and the airport rating.

## Airlines and flights

- Real airlines offer contracts based on the city's demand and your airport's rating: route, aircraft type, flights per day.
- Accepting assigns daily slots; aircraft land, taxi to a free stand of the right size, turn around (deplane, clean, board), push back, taxi out and depart.
- Not enough stands, a missing tower or long queues cause delays; airlines grow or cancel based on punctuality and passenger satisfaction.

## Economy

Revenue: landing fees (by aircraft weight), passenger fees, retail and food spend, parking.
Costs: construction, daily upkeep and staff per module, loan interest.
Board: weekly objectives with cash bonuses and confidence (carried over).

## Later
Baggage system, transfers, lounges, passport control, staff and vehicles, night curfews, multiple terminals and floors, rotating camera.
