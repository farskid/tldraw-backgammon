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
/** 'stuck' = rolled but has no legal move; the server passes the turn after a short pause */
export type Phase = 'waiting' | 'rolling' | 'moving' | 'stuck' | 'gameover'

export interface PointState {
	color: Color
	count: number
}

/** A provisional move made this turn, with enough info to revert it. */
export interface StagedMove {
	from: MoveFrom
	to: MoveTo
	die: number
	/** whether this move hit an opponent blot (sent it to the bar) */
	hit: boolean
}

export interface GameState {
	/** 24 points; null = empty. Reflects the staged (provisional) position. */
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
	/** provisional moves made this turn, awaiting OK / undo */
	staged: StagedMove[]
	/** epoch ms when the current turn expires (server-set); null = no clock running */
	turnDeadline: number | null
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
		staged: [],
		turnDeadline: null,
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
	state.staged = []
	state.phase = 'moving'
	state.winner = null
	state.message = `Opening roll ${dw}-${db} — ${COLOR_NAME[state.turn]} starts.`
	markStuckIfNoMoves(state)
}

export function rollDice(state: GameState, rng: Rng): void {
	const a = d6(rng)
	const b = d6(rng)
	state.lastRoll = [a, b]
	state.dice = a === b ? [a, a, a, a] : [a, b]
	state.phase = 'moving'
	state.message = `${COLOR_NAME[state.turn]} rolled ${a}-${b}.`
	markStuckIfNoMoves(state)
}

/**
 * If the roll leaves the player with no legal move at all, enter the 'stuck'
 * phase: the dice stay visible and the server passes the turn after a short,
 * server-driven pause so both players can see what happened.
 */
function markStuckIfNoMoves(state: GameState): void {
	if (state.phase === 'moving' && legalMoves(state).length === 0) {
		state.phase = 'stuck'
		state.message += ` No legal moves!`
	}
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
 * Validate and stage a from→to move for the player to move. The move is
 * applied to the board immediately (so both players can see it) but stays
 * provisional until confirmTurn commits it. The die is chosen by the server:
 * the smallest remaining die that legalizes the move.
 */
export function stageMove(state: GameState, from: MoveFrom, to: MoveTo): MoveResult {
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
	let hit = false
	if (move.to === 'off') {
		state.off[color]++
		state.message = `${COLOR_NAME[color]} bears off.`
	} else {
		const t = move.to as number
		const p = state.points[t]
		if (p && p.color !== color) {
			// hit a blot
			hit = true
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

	state.staged.push({ from: move.from, to: move.to, die: move.die, hit })

	if (state.dice.length === 0) {
		state.message += ' Press OK to end the turn.'
	} else if (legalMoves(state).length === 0) {
		state.message += ' No more moves — press OK.'
	}
	return { ok: true }
}

/** Revert the most recently staged move (board + dice). */
function revertLastStaged(state: GameState): void {
	const move = state.staged.pop()
	if (!move) return
	const color = state.turn

	// take the checker back off its destination
	if (move.to === 'off') {
		state.off[color]--
	} else {
		const t = move.to as number
		const p = state.points[t]!
		p.count--
		if (p.count === 0) state.points[t] = null
		if (move.hit) {
			// restore the opponent blot from the bar
			state.bar[OPPONENT[color]]--
			state.points[t] = { color: OPPONENT[color], count: 1 }
		}
	}

	// put it back where it came from
	if (move.from === 'bar') {
		state.bar[color]++
	} else {
		const f = move.from as number
		const p = state.points[f]
		if (p) p.count++
		else state.points[f] = { color, count: 1 }
	}

	// give the die back
	state.dice.push(move.die)
}

/** Undo the last staged move of the current turn. */
export function undoStagedMove(state: GameState): MoveResult {
	if (state.phase !== 'moving') return { ok: false, error: 'Nothing to undo.' }
	if (state.staged.length === 0) return { ok: false, error: 'No staged moves to undo.' }
	revertLastStaged(state)
	state.message = `${COLOR_NAME[state.turn]} undoes a move.`
	return { ok: true }
}

/**
 * Commit the staged moves and pass the turn. Rejected while a legal move can
 * still be made with the remaining dice.
 */
export function confirmTurn(state: GameState): MoveResult {
	if (state.phase !== 'moving') {
		return { ok: false, error: 'Roll before confirming.' }
	}
	if (legalMoves(state).length > 0) {
		return { ok: false, error: 'You must play your remaining dice.' }
	}
	const color = state.turn
	state.staged = []
	if (state.off[color] === 15) {
		state.phase = 'gameover'
		state.winner = color
		state.dice = []
		state.message = `${COLOR_NAME[color]} wins!`
		return { ok: true }
	}
	state.message = `${COLOR_NAME[color]} ends the turn.`
	endTurn(state)
	return { ok: true }
}

/**
 * Forfeit the rest of the turn: discard any unconfirmed staged moves and pass
 * to the opponent. Used by the server for turn-clock expiry and for the pause
 * after a roll with no legal moves.
 */
export function passTurn(state: GameState, reason: 'timeout' | 'noMoves'): void {
	if (state.phase !== 'rolling' && state.phase !== 'moving' && state.phase !== 'stuck') return
	while (state.staged.length > 0) revertLastStaged(state)
	state.message =
		reason === 'timeout'
			? `${COLOR_NAME[state.turn]} ran out of time.`
			: `${COLOR_NAME[state.turn]} cannot move.`
	endTurn(state)
}

function endTurn(state: GameState): void {
	state.turn = OPPONENT[state.turn]
	state.dice = []
	state.staged = []
	state.phase = 'rolling'
	state.message += ` ${COLOR_NAME[state.turn]} to roll.`
}
