# tldraw backgammon

A proof-of-concept 2-player backgammon game that (ab)uses [tldraw sync](https://tldraw.dev/docs/sync) multiplayer as the shared board. The server holds the authoritative game state and *renders the board as tldraw shapes*; clients connect to the sync room readonly and propose moves over a small HTTP API.

## Live demo

**https://tldraw-backgammon.onrender.com** — click **Create room**, then open the room URL in a second tab to play both seats. (Free-tier host: the first request after idle can take ~a minute to cold-start, and a restart resets in-memory rooms.)

This is a non-commercial hobby POC. A [tldraw hobby license](https://tldraw.dev/get-a-license/hobby) `licenseKey` will be added once approved; until then the production build may log tldraw license warnings in the console — expected and acceptable for now. To bake in the key, set the `VITE_TLDRAW_LICENSE_KEY` environment variable at build time (see [Deployment](#deployment)).

## Quick start

Requires Node 20.11+ and npm.

```bash
npm install
npm run dev
```

Then:

1. Open http://localhost:5173 and click **Create room** (or open `http://localhost:5173/?room=myroom` directly).
2. Copy the URL (there's a **Copy link** button in the HUD) and open it in a **second tab**. The first tab is White, the second is Black — the game starts automatically with an opening roll. Your seat is shown as a colored checker chip in the HUD.
3. Play a turn — you have **30 seconds** for the whole turn (the HUD shows the countdown):
   - Click **🎲 Roll dice**, or check **Auto roll** to have the client roll for you as soon as it's your turn.
   - Drag a highlighted (yellow-ringed) checker onto a green-ringed point (or tap the checker, then the destination). Moves are **staged**: they appear on both boards immediately (animated), but stay provisional.
   - **↩ Undo** reverts the last staged move; **✓ OK** commits the turn and passes it (OK stays disabled while you still have playable dice).
   - If the clock runs out, staged moves are discarded and the turn passes. If a roll leaves you with no legal moves, the dice stay visible for a couple of seconds with a "No legal moves" notice, then the turn passes automatically.
4. Open the same URL in a **third tab** to see the spectator mode (seats are capped at 2).

> Two tabs in the same browser work because player identity is kept in `sessionStorage` (per tab).

### Production-ish single-process mode

```bash
npm run build
npm start -w server     # serves the built client + sync + API on http://localhost:5858
```

### Playing from a phone on your LAN

Run the single-process mode above and open `http://<your-LAN-IP>:5858/?room=myroom` on the phone. Plain HTTP over a LAN IP is not a "secure context", so the client avoids secure-context-only browser APIs (`crypto.randomUUID`, `navigator.clipboard`) and falls back to `crypto.getRandomValues` / `execCommand` — no HTTPS needed. An HTTPS tunnel (e.g. ngrok, cloudflared) still works if you prefer one.

## Deployment

The app is one long-running Node process (WebSocket sync + HTTP API + static client), so it needs a real server, not static hosting. It binds `process.env.PORT` (default 5858).

- **Render** (current live demo): `render.yaml` is a blueprint for a free web service — build `npm ci && npm run build`, start `npm start -w server`. Redeploys happen automatically on push to `main`; or use "Manual deploy" in the Render dashboard.
- **Fly.io / any Docker host**: `Dockerfile` + `fly.toml` are included (`fly launch --copy-config --no-deploy && fly deploy`).
- **License key**: set `VITE_TLDRAW_LICENSE_KEY` in the host's environment (it's a *build-time* variable — trigger a rebuild after setting it) to pass a tldraw license key to `<Tldraw licenseKey={...} />`.

## Usage stats

The server records usage events (`room_created`, `player_joined`, `spectator_joined`, `game_started`, `game_finished`) to a SQLite file so they survive restarts — rooms themselves stay in-memory. It uses Node 22's built-in `node:sqlite`: **no extra dependency, no native build, and the schema is auto-created on boot** (`CREATE TABLE IF NOT EXISTS`), so there is nothing to migrate or administer, ever.

| Env var | Meaning |
| --- | --- |
| `STATS_TOKEN` | Enables `GET /api/stats`. **Unset = the endpoint returns 404** (never public). |
| `STATS_DB_PATH` | SQLite file location. Default `./data/stats.sqlite` (created automatically); `fly.toml` sets `/data/stats.sqlite` on the mounted volume. |

Query it with the token as a Bearer header or `?token=`:

```bash
curl -H "Authorization: Bearer $STATS_TOKEN" https://<your-app>/api/stats
# or: curl "https://<your-app>/api/stats?token=$STATS_TOKEN"
```

The response has `live` (current rooms by phase, connected sockets, seated players, spectators) and `durable` (all-time totals from SQLite: rooms created, games started/finished, player joins + unique players, per-day counts for the last 14 days, and the last 20 raw events).

**Fly.io — one-time setup** (the only ops step; after this the stats persist across deploys, restarts, and machine stops):

```bash
fly volumes create stats_data --region arn --size 1
fly secrets set STATS_TOKEN=<pick-a-secret>
```

`fly.toml` already mounts the volume at `/data` and points `STATS_DB_PATH` there. Note: a Fly volume attaches to a single machine, which matches the single-machine in-memory-rooms design. On Render's free tier there is no persistent disk, so stats reset with each deploy there (the endpoint still works if you set `STATS_TOKEN`).

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
- Clients propose actions over HTTP: `POST /api/rooms/:id/join | roll | move | undo | confirm | reset`. The server validates seat, turn order, and move legality with the shared rules engine, then re-renders the board into the tldraw document via `storage.transaction(...)`. tldraw sync broadcasts the change to every connected client.
- An invisible shape (`shape:state`) carries the serialized game state in its `meta`, so client HUDs (turn, dice, bar/off counts, winner) update reactively through the same sync channel.

### Turn flow: stage → undo → confirm, on a 30s clock

- `move` **stages** a provisional move server-side: the board reflects it for both players, and the engine records how to revert it. `undo` reverts the last staged move; `confirm` commits the turn — it is rejected (and the OK button disabled) while a legal move can still be made with the remaining dice.
- The **turn clock is server-authoritative**: the server stores a deadline (synced to clients for display) and a timer; on expiry it reverts any staged moves and passes the turn. A slow client can't cheat the clock — expiry happens server-side regardless of what the client shows. Override for development with `TURN_MS=... npm run dev -w server`.
- A roll with **no legal moves** enters a short server-driven "stuck" phase (~2.5s, `STUCK_MS`): the dice stay visible with a "No legal moves" notice on both clients before the turn passes.

### Move animation & checker identity

- Every physical checker has a stable identity (`shared/src/stacks.ts` re-derives the assignment after each change), so a move updates one shape's position instead of deleting/recreating shapes. Borne-off checkers keep their shape id and render as a pile of flattened chips in the bear-off tray.
- The server animates position changes by writing ~6 interpolated frames over 300ms (`storage.transaction` per frame; the sync layer drops deep-equal puts, so only the moving checkers are broadcast). A short CSS `transform` transition on the client blends the steps into a smooth slide — verified headlessly with `server/scripts/probe-animation.mjs`.

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
- Turn order enforced; staged moves must be confirmed with OK, and a turn with no legal moves (a "dance") passes automatically after a short pause. Win when all 15 checkers are borne off (committed on confirm).
- **Simplifications:** no doubling cube, and the "must play the maximum number of dice / higher die" forced-play rule is not enforced when choosing *between* alternative plays — each individual move must still be legal.

### Notes / known limitations

- Rooms live in server memory only; restarting the server resets all games. (Usage *stats* do persist — see [Usage stats](#usage-stats).)
- No auth: seats are first-come-first-served by generated player id.
- `GET /api/rooms/:id/state` exposes the game state for debugging.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs server (`:5858`) and Vite client (`:5173`, proxies `/api` + `/connect`) together |
| `npm run build` | Builds the client and typechecks server + shared |
| `npm run typecheck` | Typechecks all three packages |
