/**
 * Plays a full random game against the HTTP API to exercise the rules engine
 * end-to-end (turn order, staging + confirm, hits, bar entry, bearing off,
 * the no-legal-moves pause, and game over).
 *
 * Run the server with fast timers for quick simulations:
 *   STUCK_MS=100 npm start -w server
 * Then: npx tsx server/scripts/simulate.ts [roomId]
 */
import { GameState, legalMoves } from '@backgammon/shared'

const BASE = 'http://localhost:5858'
const room = process.argv[2] ?? `sim-${Math.random().toString(36).slice(2, 8)}`
const players: Record<string, string> = { w: 'sim-white', b: 'sim-black' }

async function post(path: string, body: object) {
	const res = await fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return { status: res.status, body: await res.json() }
}

async function getState(): Promise<GameState> {
	const res = await fetch(`${BASE}/api/rooms/${room}/state`)
	return res.json()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
	console.log(`room: ${room}`)
	for (const color of ['w', 'b']) {
		const r = await post(`/api/rooms/${room}/join`, { playerId: players[color] })
		if (r.body.seat !== color) throw new Error(`expected seat ${color}, got ${r.body.seat}`)
	}

	let hits = 0
	let barEntries = 0
	let bearOffs = 0
	let stuckTurns = 0
	let undos = 0
	const deadline = Date.now() + 5 * 60_000
	while (Date.now() < deadline) {
		const state = await getState()
		if (state.phase === 'gameover') {
			console.log(`GAME OVER: ${state.message}`)
			console.log(
				`hits=${hits} barEntries=${barEntries} bearOffs=${bearOffs} stuckTurns=${stuckTurns} undos=${undos}`
			)
			console.log(`off: w=${state.off.w} b=${state.off.b}`)
			if (state.off[state.winner!] !== 15) throw new Error('winner does not have 15 off')
			return
		}
		const playerId = players[state.turn]
		if (state.phase === 'stuck') {
			// server passes the turn after the pause
			stuckTurns++
			await sleep(300)
			continue
		}
		if (state.phase === 'rolling') {
			const r = await post(`/api/rooms/${room}/roll`, { playerId })
			if (!r.body.ok) throw new Error(`roll failed: ${JSON.stringify(r.body)}`)
			continue
		}
		if (state.phase === 'moving') {
			const moves = legalMoves(state)
			if (moves.length === 0) {
				const r = await post(`/api/rooms/${room}/confirm`, { playerId })
				if (!r.body.ok) throw new Error(`confirm failed: ${JSON.stringify(r.body)}`)
				continue
			}
			// occasionally exercise undo
			if (state.staged.length > 0 && Math.random() < 0.05) {
				const r = await post(`/api/rooms/${room}/undo`, { playerId })
				if (!r.body.ok) throw new Error(`undo failed: ${JSON.stringify(r.body)}`)
				undos++
				continue
			}
			// confirm-too-early must be rejected while moves remain
			if (Math.random() < 0.03) {
				const r = await post(`/api/rooms/${room}/confirm`, { playerId })
				if (r.body.ok) throw new Error('confirm accepted despite remaining legal moves')
			}
			const move = moves[Math.floor(Math.random() * moves.length)]
			if (move.from === 'bar') barEntries++
			if (move.to === 'off') bearOffs++
			if (
				typeof move.to === 'number' &&
				state.points[move.to] &&
				state.points[move.to]!.color !== state.turn
			) {
				hits++
			}
			const r = await post(`/api/rooms/${room}/move`, {
				playerId,
				from: move.from,
				to: move.to,
			})
			if (!r.body.ok) {
				throw new Error(`legal move rejected: ${JSON.stringify(move)} → ${JSON.stringify(r.body)}`)
			}
			continue
		}
		throw new Error(`unexpected phase ${state.phase}`)
	}
	throw new Error('game did not finish within the time limit')
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
