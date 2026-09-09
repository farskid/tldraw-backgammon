import { Color, GameState } from './game'

/**
 * Assigns a stable identity to each of the 30 physical checkers ('w0'..'w14',
 * 'b0'..'b14') based on the previous assignment and the new game state. The
 * server keeps the assignment between renders so that a move relocates exactly
 * one shape id (two for a hit) — which is what makes CSS transform transitions
 * animate the checkers.
 *
 * Location keys: 'p0'..'p23' (points), 'bar-w', 'bar-b', 'off-w', 'off-b'.
 * Array order is stack order (index 0 = bottom of the stack).
 */
export type CheckerStacks = Record<string, string[]>

interface LocTarget {
	key: string
	color: Color
	count: number
}

function targets(state: GameState): LocTarget[] {
	const out: LocTarget[] = []
	for (let i = 0; i < 24; i++) {
		const p = state.points[i]
		out.push({ key: `p${i}`, color: p?.color ?? 'w', count: p?.count ?? 0 })
	}
	for (const color of ['w', 'b'] as Color[]) {
		out.push({ key: `bar-${color}`, color, count: state.bar[color] })
		out.push({ key: `off-${color}`, color, count: state.off[color] })
	}
	return out
}

export function updateStacks(prev: CheckerStacks, state: GameState): CheckerStacks {
	const locs = targets(state)
	const next: CheckerStacks = {}
	const surplus: Record<Color, string[]> = { w: [], b: [] }
	const seen = new Set<string>()

	// Pass 1: keep checkers that are already in the right place. Stacks shrink
	// from the top (end of the array), so we keep the prefix.
	for (const { key, color, count } of locs) {
		const keep: string[] = []
		for (const id of prev[key] ?? []) {
			if (seen.has(id)) continue
			seen.add(id)
			if (id[0] === color && keep.length < count) keep.push(id)
			else surplus[id[0] as Color].push(id)
		}
		next[key] = keep
	}

	// Any ids never assigned before (first render) go to the pool too.
	for (const color of ['w', 'b'] as Color[]) {
		for (let i = 0; i < 15; i++) {
			const id = `${color}${i}`
			if (!seen.has(id)) surplus[color].push(id)
		}
	}

	// Pass 2: fill deficits in deterministic order.
	for (const { key, color, count } of locs) {
		while (next[key].length < count) {
			const id = surplus[color].shift()
			if (!id) throw new Error(`checker accounting error at ${key}`)
			next[key].push(id)
		}
	}
	return next
}
