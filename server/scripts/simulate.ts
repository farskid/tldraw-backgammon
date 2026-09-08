/**
 * Plays a full random game against the HTTP API to exercise the rules engine
 * end-to-end (turn order, hits, bar entry, bearing off, game over).
 * Usage: npx tsx server/scripts/simulate.ts [roomId]
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

async function main() {
	console.log(`room: ${room}`)
	for (const color of ['w', 'b']) {
		const r = await post(`/api/rooms/${room}/join`, { playerId: players[color] })
		if (r.body.seat !== color) throw new Error(`expected seat ${color}, got ${r.body.seat}`)
	}

	let hits = 0
	let barEntries = 0
	let bearOffs = 0
	for (let step = 0; step < 3000; step++) {
		const state = await getState()
		if (state.phase === 'gameover') {
			console.log(`GAME OVER after ${step} steps: ${state.message}`)
			console.log(`hits=${hits} barEntries=${barEntries} bearOffs=${bearOffs}`)
			console.log(`off: w=${state.off.w} b=${state.off.b}`)
			if (state.off[state.winner!] !== 15) throw new Error('winner does not have 15 off')
			return
		}
		const playerId = players[state.turn]
		if (state.phase === 'rolling') {
			const r = await post(`/api/rooms/${room}/roll`, { playerId })
			if (!r.body.ok) throw new Error(`roll failed: ${JSON.stringify(r.body)}`)
			continue
		}
		if (state.phase === 'moving') {
			const moves = legalMoves(state)
			if (moves.length === 0) throw new Error('phase=moving but engine sees no legal moves')
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
	throw new Error('game did not finish within step limit')
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
