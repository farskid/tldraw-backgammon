# tldraw backgammon

A proof-of-concept 2-player backgammon game that (ab)uses [tldraw sync](https://tldraw.dev/docs/sync) multiplayer as the shared board. The server holds the authoritative game state and *renders the board as tldraw shapes*; clients connect to the sync room readonly and propose moves over a small HTTP API.

## Quick start

Requires Node 20.11+ and npm.

```bash
npm install
npm run dev
```

Then:

1. Open http://localhost:5173 and click **Create room** (or open `http://localhost:5173/?room=myroom` directly).
2. Copy the URL (there's a **Copy link** button in the HUD) and open it in a **second tab**. The first tab is White, the second is Black — the game starts automatically with an opening roll.
3. Play: when it's your turn, click **🎲 Roll dice**, then click one of your highlighted (yellow-ringed) checkers, then click a green-ringed destination. The board updates in both tabs in realtime.
4. Open the same URL in a **third tab** to see the spectator mode (seats are capped at 2).

> Two tabs in the same browser work because player identity is kept in `sessionStorage` (per tab).

### Production-ish single-process mode

```bash
npm run build
npm start -w server     # serves the built client + sync + API on http://localhost:5858
```

### Simulate a full game (rules smoke test)

With the server running:

```bash
npx tsx server/scripts/simulate.ts
```

Plays a complete random game through the HTTP API (join → roll → moves → bear off → game over) and fails if the server ever rejects a move the shared rules engine considers legal.

## Architecture

```
shared/   Rules engine + board layout + custom tldraw shape definition (pure TS, no I/O)
server/   Node: TLSocketRoom per room (tldraw sync), seat management, HTTP move API
client/   Vite + React: <Tldraw> with useSync, custom ShapeUtil, HUD overlay
```

### Server-authoritative moves, tldraw as the view

- The server keeps the match state (`GameState`) **in memory** per room, next to a `TLSocketRoom` (`@tldraw/sync-core`) backed by `InMemorySyncStorage`.
- Dice are rolled with the server's RNG (`crypto.randomInt`). Clients never supply dice or move legality.
- Clients propose actions over HTTP: `POST /api/rooms/:id/join | roll | move | reset`. The server validates seat, turn order, and move legality with the shared rules engine, then re-renders the board into the tldraw document via `storage.transaction(...)`. tldraw sync broadcasts the change to every connected client.
- An invisible shape (`shape:state`) carries the serialized game state in its `meta`, so client HUDs (turn, dice, bar/off counts, winner) update reactively through the same sync channel.

### Board pieces can't be tampered with

- **Every** WebSocket session is registered with `isReadonly: true` — the server is the only writer of the document, so free-form editing of checkers is impossible for both players and spectators.
- All board shapes are additionally `isLocked` and the editor instance is put in readonly mode, so nothing is selectable/draggable; the client hit-tests clicks (`getShapeAtPoint` with `hitLocked`) against shape `meta` to build move proposals.
- The whole board is a single custom shape type (`bg`) whose `kind` prop selects the visual (point, checker, die, tray, …). The shape props/validators live in `shared/` and are registered with both the client `ShapeUtil` and the server `createTLSchema`, as tldraw sync requires matching schemas.

### Seat cap

- The first two distinct players (per-tab `playerId`) to join a room get the White and Black seats; everyone after that is a readonly spectator with no move UI.
- Seats are held across reconnects once the game has started (same tab can refresh and resume). While still waiting for an opponent, a disconnect frees the seat.

### Backgammon rules covered (POC depth, but real)

- Standard starting position, opening roll (one die each, higher starts and plays both, ties re-rolled).
- Legal move generation per remaining die: blocked points (2+ opponent checkers), hitting blots, mandatory bar re-entry, bearing off (all checkers home; higher die allowed only from the highest occupied point), doubles = four moves.
- Turn order enforced; the turn ends automatically when no legal move remains (including "danced" bar entries). Win when all 15 checkers are borne off.
- **Simplifications:** no doubling cube, and the "must play the maximum number of dice / higher die" forced-play rule is not enforced when choosing *between* alternative plays — each individual move must still be legal.

### Notes / known limitations

- Rooms live in server memory only; restarting the server resets all games.
- No auth: seats are first-come-first-served by generated player id.
- `GET /api/rooms/:id/state` exposes the game state for debugging.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs server (`:5858`) and Vite client (`:5173`, proxies `/api` + `/connect`) together |
| `npm run build` | Builds the client and typechecks server + shared |
| `npm run typecheck` | Typechecks all three packages |
