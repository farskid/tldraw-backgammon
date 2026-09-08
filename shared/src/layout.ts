import { COLOR_NAME, Color, GameState, MoveFrom, MoveTo } from './game'
import { BgShapeProps } from './shape'
import { CheckerStacks } from './stacks'

/**
 * Board layout: converts a GameState into a flat list of shape specs.
 * The server turns these into tldraw shape records; the client uses the same
 * geometry helpers for click targets and move highlights.
 *
 * Screen arrangement (White's perspective):
 * - top row, left → right: indices 12..23 (points 13..24). Black's home is top-right.
 * - bottom row, left → right: indices 11..0 (points 12..1). White's home is bottom-right.
 */

export const PAD = 28
export const COL_W = 64
export const POINT_H = 250
export const MID_GAP = 116
export const BAR_W = 72
export const TRAY_W = 84
export const TRAY_GAP = 18
export const CHECKER_D = 52
export const DIE_SIZE = 46

export const BOARD_W = PAD * 2 + 12 * COL_W + BAR_W
export const BOARD_H = PAD * 2 + POINT_H * 2 + MID_GAP
export const TOTAL_W = BOARD_W + TRAY_GAP + TRAY_W

const BAR_X = PAD + 6 * COL_W

const FELT = '#2f5d47'
const WOOD = '#6d4a2f'
const WOOD_DARK = '#563a24'
const POINT_A = '#c9a36a'
const POINT_B = '#7a4a2b'
const WHITE_FILL = '#f3ead8'
const WHITE_STROKE = '#8a7a5c'
const BLACK_FILL = '#35322e'
const BLACK_STROKE = '#14120f'

export const CHECKER_COLORS: Record<Color, { fill: string; stroke: string }> = {
	w: { fill: WHITE_FILL, stroke: WHITE_STROKE },
	b: { fill: BLACK_FILL, stroke: BLACK_STROKE },
}

export interface BoardShapeSpec {
	/** stable id, without the `shape:` prefix */
	id: string
	x: number
	y: number
	props: BgShapeProps
	meta: Record<string, string>
}

/** x of the left edge of a display column (0..11, left to right; bar sits between 5 and 6) */
function colX(col: number): number {
	return PAD + col * COL_W + (col >= 6 ? BAR_W : 0)
}

/** display column (0..11) for a point index */
function pointCol(idx: number): number {
	return idx >= 12 ? idx - 12 : 11 - idx
}

function isTopRow(idx: number): boolean {
	return idx >= 12
}

/** Page-space center of a point, for highlights */
export function pointCenter(idx: number): { x: number; y: number } {
	const x = colX(pointCol(idx)) + COL_W / 2
	const y = isTopRow(idx) ? PAD + POINT_H / 2 : BOARD_H - PAD - POINT_H / 2
	return { x, y }
}

/** Page-space center of a color's bar stack, for highlights */
export function barCenter(color: Color): { x: number; y: number } {
	const x = BAR_X + BAR_W / 2
	const y = color === 'w' ? BOARD_H / 2 + 12 + CHECKER_D / 2 : BOARD_H / 2 - 12 - CHECKER_D / 2
	return { x, y }
}

/** Page-space center of a color's bear-off tray, for highlights */
export function trayCenter(color: Color): { x: number; y: number } {
	const x = BOARD_W + TRAY_GAP + TRAY_W / 2
	const y = color === 'b' ? PAD + POINT_H / 2 : BOARD_H - PAD - POINT_H / 2
	return { x, y }
}

export function moveSourceCenter(from: MoveFrom, color: Color): { x: number; y: number } {
	return from === 'bar' ? barCenter(color) : pointCenter(from)
}

export function moveTargetCenter(to: MoveTo, color: Color): { x: number; y: number } {
	return to === 'off' ? trayCenter(color) : pointCenter(to)
}

function props(partial: Partial<BgShapeProps>): BgShapeProps {
	return {
		w: 1,
		h: 1,
		kind: 'label',
		fill: '',
		stroke: '',
		label: '',
		value: 0,
		dir: 'none',
		...partial,
	}
}

/** Height of a flattened borne-off chip in the tray */
export const OFF_CHIP_H = 16

/**
 * Build the full list of shapes for the current game state.
 * Order in the list is z-order (first = back).
 *
 * `stacks` assigns a stable identity to every physical checker (see
 * stacks.ts); each checker becomes a shape with a stable id so that position
 * changes can be animated with a CSS transition on the client.
 */
export function buildBoardSpecs(state: GameState, stacks: CheckerStacks): BoardShapeSpec[] {
	const specs: BoardShapeSpec[] = []

	// Playing surface
	specs.push({
		id: 'board',
		x: 0,
		y: 0,
		props: props({ kind: 'board', w: BOARD_W, h: BOARD_H, fill: FELT, stroke: WOOD }),
		meta: {},
	})

	// Bar (also a click target for re-entering from the bar)
	specs.push({
		id: 'bar',
		x: BAR_X,
		y: PAD,
		props: props({ kind: 'zone', w: BAR_W, h: BOARD_H - PAD * 2, fill: WOOD, stroke: WOOD_DARK }),
		meta: { click: 'bar' },
	})

	// Points
	for (let idx = 0; idx < 24; idx++) {
		const top = isTopRow(idx)
		specs.push({
			id: `point-${idx}`,
			x: colX(pointCol(idx)),
			y: top ? PAD : BOARD_H - PAD - POINT_H,
			props: props({
				kind: 'point',
				w: COL_W,
				h: POINT_H,
				fill: idx % 2 === 0 ? POINT_A : POINT_B,
				stroke: WOOD_DARK,
				dir: top ? 'down' : 'up',
				// printed point number (from White's perspective)
				label: String(idx + 1),
			}),
			meta: { click: `point:${idx}` },
		})
	}

	// Bear-off trays
	for (const color of ['w', 'b'] as Color[]) {
		specs.push({
			id: `tray-${color}`,
			x: BOARD_W + TRAY_GAP,
			y: color === 'b' ? PAD : BOARD_H - PAD - POINT_H,
			props: props({
				kind: 'tray',
				w: TRAY_W,
				h: POINT_H,
				fill: color === 'b' ? BLACK_FILL : WHITE_FILL,
				stroke: WOOD_DARK,
				label: `${COLOR_NAME[color]} off`,
				value: state.off[color],
			}),
			meta: { click: 'off' },
		})
	}

	const checkerProps = (color: Color, w: number, h: number) =>
		props({
			kind: 'checker',
			w,
			h,
			fill: CHECKER_COLORS[color].fill,
			stroke: CHECKER_COLORS[color].stroke,
		})

	// Checkers on points; stacks compress when more than 5 pile up
	for (let idx = 0; idx < 24; idx++) {
		const ids = stacks[`p${idx}`] ?? []
		if (ids.length === 0) continue
		const top = isTopRow(idx)
		const cx = colX(pointCol(idx)) + (COL_W - CHECKER_D) / 2
		const spacing = ids.length <= 5 ? CHECKER_D : (POINT_H - CHECKER_D) / (ids.length - 1)
		ids.forEach((cid, k) => {
			const cy = top ? PAD + k * spacing : BOARD_H - PAD - CHECKER_D - k * spacing
			specs.push({
				id: `checker-${cid}`,
				x: cx,
				y: cy,
				props: checkerProps(cid[0] as Color, CHECKER_D, CHECKER_D),
				meta: { click: `point:${idx}` },
			})
		})
	}

	// Checkers on the bar (White below center, Black above)
	for (const color of ['w', 'b'] as Color[]) {
		const ids = stacks[`bar-${color}`] ?? []
		if (ids.length === 0) continue
		const bx = BAR_X + (BAR_W - CHECKER_D) / 2
		const span = BOARD_H / 2 - 12 - PAD - CHECKER_D
		const spacing = ids.length <= 1 ? 0 : Math.min(CHECKER_D, span / (ids.length - 1))
		ids.forEach((cid, k) => {
			const by =
				color === 'w'
					? BOARD_H / 2 + 12 + k * spacing
					: BOARD_H / 2 - 12 - CHECKER_D - k * spacing
			specs.push({
				id: `checker-${cid}`,
				x: bx,
				y: by,
				props: checkerProps(color, CHECKER_D, CHECKER_D),
				meta: { click: 'bar' },
			})
		})
	}

	// Borne-off checkers: flattened chips piling up in the tray. Same shape id
	// as on the board, so bearing off animates the checker into the tray.
	for (const color of ['w', 'b'] as Color[]) {
		const ids = stacks[`off-${color}`] ?? []
		const trayX = BOARD_W + TRAY_GAP + (TRAY_W - CHECKER_D) / 2
		const trayY = color === 'b' ? PAD : BOARD_H - PAD - POINT_H
		ids.forEach((cid, k) => {
			specs.push({
				id: `checker-${cid}`,
				x: trayX,
				y: trayY + POINT_H - 12 - OFF_CHIP_H - k * (OFF_CHIP_H - 1),
				props: checkerProps(color, CHECKER_D, OFF_CHIP_H),
				meta: { click: 'off' },
			})
		})
	}

	// Remaining dice, centered in the right half of the mid gap
	const diceCount = state.dice.length
	if (diceCount > 0) {
		const spacing = DIE_SIZE + 12
		const groupW = diceCount * spacing - 12
		const startX = BAR_X + BAR_W + (6 * COL_W - groupW) / 2
		const dieFill = CHECKER_COLORS[state.turn].fill
		const dieStroke = CHECKER_COLORS[state.turn].stroke
		state.dice.forEach((value, k) => {
			specs.push({
				id: `die-${k}`,
				x: startX + k * spacing,
				y: BOARD_H / 2 - DIE_SIZE / 2,
				props: props({
					kind: 'die',
					w: DIE_SIZE,
					h: DIE_SIZE,
					fill: dieFill,
					stroke: dieStroke,
					value,
				}),
				meta: {},
			})
		})
	}

	// Status banner above the board
	specs.push({
		id: 'msg',
		x: 0,
		y: -56,
		props: props({
			kind: 'label',
			w: BOARD_W,
			h: 36,
			label: state.message,
			fill: '#e8e0d0',
			value: 24,
		}),
		meta: {},
	})

	if (state.phase === 'gameover' && state.winner) {
		specs.push({
			id: 'winner',
			x: 0,
			y: BOARD_H / 2 - 40,
			props: props({
				kind: 'label',
				w: BOARD_W,
				h: 80,
				label: `${COLOR_NAME[state.winner]} wins! 🎉`,
				fill: '#ffd75e',
				value: 56,
			}),
			meta: {},
		})
	}

	// Invisible shape carrying the serialized game state for client HUDs
	specs.push({
		id: 'state',
		x: 0,
		y: -120,
		props: props({ kind: 'state', w: 1, h: 1 }),
		meta: { json: JSON.stringify(state) },
	})

	return specs
}
