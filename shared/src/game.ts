/**
 * Backgammon rules engine. Pure functions over a plain GameState object.
 *
 * Board model: 24 points indexed 0..23 (absolute).
 * - White moves from high to low indices and bears off past index 0.
 *   White's home board is indices 0..5.
 * - Black moves from low to high indices and bears off past index 23.
 *   Black's home board is indices 18..23.
 * - Point 1 (as printed on a physical board, from White's perspective) is index 0.
 */

export type Color = 'w' | 'b'
export type Phase = 'waiting' | 'rolling' | 'moving' | 'gameover'

export interface PointState {
	color: Color
	count: number
}

export interface GameState {
	/** 24 points; null = empty */
	points: (PointState | null)[]
	/** checkers on the bar */
	bar: Record<Color, number>
	/** checkers borne off */
	off: Record<Color, number>
	turn: Color
	/** dice remaining to be played this turn (doubles appear 4 times) */
	dice: number[]
	/** the dice as rolled, for display */
	lastRoll: [number, number] | null
	phase: Phase
	winner: Color | null
	/** human-readable last event */
	message: string
	/** seat occupancy, for display only */
	seats: Record<Color, boolean>
}

export type MoveFrom = number | 'bar'
export type MoveTo = number | 'off'

export interface Move {
	from: MoveFrom
	to: MoveTo
	die: number
}

export const OPPONENT: Record<Color, Color> = { w: 'b', b: 'w' }
export const COLOR_NAME: Record<Color, string> = { w: 'White', b: 'Black' }

/** Direction of travel along the point indices */
const DIR: Record<Color, 1 | -1> = { w: -1, b: 1 }

export function initialGameState(): GameState {
	const points: (PointState | null)[] = new Array(24).fill(null)
	const put = (i: number, color: Color, count: number) => {
		points[i] = { color, count }
	}
	// Standard starting position
	put(23, 'w', 2)
	put(12, 'w', 5)
	put(7, 'w', 3)
	put(5, 'w', 5)
	put(0, 'b', 2)
	put(11, 'b', 5)
	put(16, 'b', 3)
	put(18, 'b', 5)
	return {
		points,
		bar: { w: 0, b: 0 },
		off: { w: 0, b: 0 },
		turn: 'w',
		dice: [],
		lastRoll: null,
		phase: 'waiting',
		winner: null,
		message: 'Waiting for a second player to join…',
		seats: { w: false, b: false },
	}
}

/** Returns a float in [0, 1). The server passes its own RNG so clients can never fake dice. */
export type Rng = () => number

const d6 = (rng: Rng) => 1 + Math.floor(rng() * 6)

/** Opening roll: one die each, higher goes first and plays both dice. Ties are re-rolled. */
export function startGame(state: GameState, rng: Rng): void {
	let dw = d6(rng)
	let db = d6(rng)
	while (dw === db) {
		dw = d6(rng)
		db = d6(rng)
	}
	state.turn = dw > db ? 'w' : 'b'
	state.lastRoll = [dw, db]
	state.dice = [dw, db]
	state.phase = 'moving'
	state.winner = null
	state.message = `Opening roll ${dw}-${db} — ${COLOR_NAME[state.turn]} starts.`
	skipTurnIfStuck(state)
}

export function rollDice(state: GameState, rng: Rng): void {
	const a = d6(rng)
	const b = d6(rng)
	state.lastRoll = [a, b]
	state.dice = a === b ? [a, a, a, a] : [a, b]
	state.phase = 'moving'
	state.message = `${COLOR_NAME[state.turn]} rolled ${a}-${b}.`
	skipTurnIfStuck(state)
}

function canLand(state: GameState, color: Color, idx: number): boolean {
	const p = state.points[idx]
	return !p || p.color === color || p.count === 1
}

/** The point a checker enters on from the bar for a given die */
function barEntryIndex(color: Color, die: number): number {
	return color === 'w' ? 24 - die : die - 1
}

function allInHome(state: GameState, color: Color): boolean {
	if (state.bar[color] > 0) return false
	for (let i = 0; i < 24; i++) {
		const p = state.points[i]
		if (!p || p.color !== color || p.count === 0) continue
		if (color === 'w' && i > 5) return false
		if (color === 'b' && i < 18) return false
	}
	return true
}

/** Exact die value needed to bear off from a point */
function bearOffDistance(color: Color, idx: number): number {
	return color === 'w' ? idx + 1 : 24 - idx
}

/** True if `color` has a checker further from the edge than `idx` within its home board */
function hasCheckerBehind(state: GameState, color: Color, idx: number): boolean {
	if (color === 'w') {
		for (let i = idx + 1; i <= 5; i++) {
			if (state.points[i]?.color === 'w') return true
		}
	} else {
		for (let i = idx - 1; i >= 18; i--) {
			if (state.points[i]?.color === 'b') return true
		}
	}
	return false
}

/**
 * All legal single-checker moves for the player to move, given the remaining dice.
 * POC simplification: we do not enforce the "must play the maximum number of dice"
 * rule when choosing between alternative plays; each individual move must be legal,
 * and the turn auto-ends when no legal move remains.
 */
export function legalMoves(state: GameState): Move[] {
	if (state.phase !== 'moving') return []
	const color = state.turn
	const moves: Move[] = []
	const uniqueDice = [...new Set(state.dice)]

	// Checkers on the bar must enter first
	if (state.bar[color] > 0) {
		for (const die of uniqueDice) {
			const idx = barEntryIndex(color, die)
			if (canLand(state, color, idx)) {
				moves.push({ from: 'bar', to: idx, die })
			}
		}
		return moves
	}

	const inHome = allInHome(state, color)
	for (let f = 0; f < 24; f++) {
		const p = state.points[f]
		if (!p || p.color !== color) continue
		for (const die of uniqueDice) {
			const target = f + DIR[color] * die
			if (target >= 0 && target <= 23) {
				if (canLand(state, color, target)) {
					moves.push({ from: f, to: target, die })
				}
			} else if (inHome) {
				const dist = bearOffDistance(color, f)
				if (die === dist || (die > dist && !hasCheckerBehind(state, color, f))) {
					moves.push({ from: f, to: 'off', die })
				}
			}
		}
	}
	return moves
}

export interface MoveResult {
	ok: boolean
	error?: string
}

/**
 * Validate and apply a from→to move for the player to move.
 * The die is chosen by the server: the smallest remaining die that legalizes the move.
 */
export function applyMove(state: GameState, from: MoveFrom, to: MoveTo): MoveResult {
	if (state.phase !== 'moving') {
		return { ok: false, error: 'Not in a moving phase (roll first).' }
	}
	const candidates = legalMoves(state).filter((m) => m.from === from && m.to === to)
	if (candidates.length === 0) {
		return { ok: false, error: 'Illegal move.' }
	}
	const move = candidates.reduce((a, b) => (a.die <= b.die ? a : b))
	const color = state.turn

	// consume the die
	const dieIdx = state.dice.indexOf(move.die)
	state.dice.splice(dieIdx, 1)

	// lift the checker
	if (move.from === 'bar') {
		state.bar[color]--
	} else {
		const p = state.points[move.from as number]!
		p.count--
		if (p.count === 0) state.points[move.from as number] = null
	}

	// place the checker
	if (move.to === 'off') {
		state.off[color]++
		state.message = `${COLOR_NAME[color]} bears off.`
		if (state.off[color] === 15) {
			state.phase = 'gameover'
			state.winner = color
			state.dice = []
			state.message = `${COLOR_NAME[color]} wins!`
			return { ok: true }
		}
	} else {
		const t = move.to as number
		const p = state.points[t]
		if (p && p.color !== color) {
			// hit a blot
			state.bar[p.color]++
			state.points[t] = { color, count: 1 }
			state.message = `${COLOR_NAME[color]} hits a blot!`
		} else if (p) {
			p.count++
			state.message = `${COLOR_NAME[color]} moves.`
		} else {
			state.points[t] = { color, count: 1 }
			state.message = `${COLOR_NAME[color]} moves.`
		}
	}

	if (state.dice.length === 0) {
		endTurn(state)
	} else {
		skipTurnIfStuck(state)
	}
	return { ok: true }
}

function endTurn(state: GameState): void {
	state.turn = OPPONENT[state.turn]
	state.dice = []
	state.phase = 'rolling'
	state.message += ` ${COLOR_NAME[state.turn]} to roll.`
}

/** If the player to move has dice but no legal move, forfeit the rest of the turn. */
function skipTurnIfStuck(state: GameState): void {
	if (state.phase === 'moving' && legalMoves(state).length === 0) {
		state.message += ` ${COLOR_NAME[state.turn]} has no legal moves.`
		endTurn(state)
	}
}
