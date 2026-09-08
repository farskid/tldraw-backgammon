import {
	BG_SHAPE_TYPE,
	CheckerStacks,
	Color,
	GameState,
	MoveFrom,
	MoveTo,
	bgShapeProps,
	buildBoardSpecs,
	confirmTurn,
	initialGameState,
	passTurn,
	rollDice,
	stageMove,
	startGame,
	undoStagedMove,
	updateStacks,
} from '@backgammon/shared'
import { InMemorySyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import {
	TLRecord,
	TLShape,
	createShapeId,
	createTLSchema,
	defaultBindingSchemas,
	defaultShapeSchemas,
} from '@tldraw/tlschema'
import { getIndices } from '@tldraw/utils'
import crypto from 'node:crypto'

export type Seat = Color | 'spectator'

export interface ActionResult {
	ok: boolean
	error?: string
}

const schema = createTLSchema({
	shapes: {
		...defaultShapeSchemas,
		[BG_SHAPE_TYPE]: { props: bgShapeProps },
	},
	bindings: defaultBindingSchemas,
})

/** Server RNG — dice are never rolled client-side. */
const rng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32

/** Whole-turn clock (roll + staged moves + OK) */
const TURN_MS = Number(process.env.TURN_MS ?? 30_000)
/** Pause after a roll with no legal moves, so both players can read the dice */
const STUCK_MS = Number(process.env.STUCK_MS ?? 2_500)

export class GameRoom {
	readonly storage = new InMemorySyncStorage<TLRecord>()
	readonly room: TLSocketRoom<TLRecord, void>
	readonly game: GameState = initialGameState()
	/** playerId holding each seat */
	private seats: Record<Color, string | null> = { w: null, b: null }
	/** sessionId → playerId for connected sockets */
	private sessions = new Map<string, string>()
	/** stable checker-id assignment, kept between renders for animation */
	private stacks: CheckerStacks = {}
	/** pending turn-clock or stuck-pause timer */
	private timer: NodeJS.Timeout | null = null
	/** invalidates stale timers whenever the clock is re-armed */
	private timerSerial = 0

	constructor(readonly id: string) {
		this.room = new TLSocketRoom<TLRecord, void>({
			schema,
			storage: this.storage,
			onSessionRemoved: (_room, args) => {
				const playerId = this.sessions.get(args.sessionId)
				this.sessions.delete(args.sessionId)
				if (!playerId) return
				// Free a seat only before the game has started; once playing, the
				// seat stays reserved so the same browser tab can reconnect.
				if (this.game.phase === 'waiting' && !this.hasConnection(playerId)) {
					for (const color of ['w', 'b'] as Color[]) {
						if (this.seats[color] === playerId) {
							this.seats[color] = null
							this.game.seats[color] = false
							this.game.message = 'A player left. Waiting for a second player…'
						}
					}
					this.syncBoard()
				}
			},
			log: {
				warn: (...args) => console.warn(`[room ${id}]`, ...args),
				error: (...args) => console.error(`[room ${id}]`, ...args),
			},
		})
		this.syncBoard()
	}

	private hasConnection(playerId: string): boolean {
		for (const pid of this.sessions.values()) {
			if (pid === playerId) return true
		}
		return false
	}

	seatOf(playerId: string): Seat {
		if (this.seats.w === playerId) return 'w'
		if (this.seats.b === playerId) return 'b'
		return 'spectator'
	}

	/** First two distinct players get the seats; everyone else is a readonly spectator. */
	join(playerId: string): Seat {
		const existing = this.seatOf(playerId)
		if (existing !== 'spectator') return existing
		for (const color of ['w', 'b'] as Color[]) {
			if (this.seats[color] === null) {
				this.seats[color] = playerId
				this.game.seats[color] = true
				if (this.game.phase === 'waiting' && this.seats.w && this.seats.b) {
					startGame(this.game, rng)
					this.armTimers(true)
				} else if (this.game.phase === 'waiting') {
					this.game.message = 'Waiting for a second player to join…'
				}
				this.syncBoard()
				return color
			}
		}
		return 'spectator'
	}

	/**
	 * (Re-)arm the server-side clock for the current phase. `newTurn` starts a
	 * fresh 30s deadline; otherwise the existing deadline keeps running. The
	 * clock is authoritative: expiry discards staged moves and passes the turn
	 * regardless of what clients display.
	 */
	private armTimers(newTurn: boolean): void {
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
		const serial = ++this.timerSerial
		const g = this.game

		if (g.phase === 'stuck') {
			g.turnDeadline = null
			this.timer = setTimeout(() => {
				if (serial !== this.timerSerial) return
				passTurn(g, 'noMoves')
				this.armTimers(true)
				this.syncBoard()
			}, STUCK_MS)
			return
		}

		if (g.phase !== 'rolling' && g.phase !== 'moving') {
			g.turnDeadline = null
			return
		}

		if (newTurn || g.turnDeadline === null) {
			g.turnDeadline = Date.now() + TURN_MS
		}
		const delay = Math.max(0, g.turnDeadline - Date.now())
		this.timer = setTimeout(() => {
			if (serial !== this.timerSerial) return
			passTurn(g, 'timeout')
			this.armTimers(true)
			this.syncBoard()
		}, delay)
	}

	registerSession(sessionId: string, playerId: string): void {
		this.sessions.set(sessionId, playerId)
	}

	/** Guard shared by all play actions */
	private turnCheck(playerId: string): ActionResult & { seat?: Color } {
		const seat = this.seatOf(playerId)
		if (seat === 'spectator') return { ok: false, error: 'Spectators cannot play.' }
		if (this.game.turn !== seat) return { ok: false, error: 'Not your turn.' }
		return { ok: true, seat }
	}

	roll(playerId: string): ActionResult {
		const check = this.turnCheck(playerId)
		if (!check.ok) return check
		if (this.game.phase !== 'rolling') return { ok: false, error: 'Not time to roll.' }
		rollDice(this.game, rng)
		// entering 'stuck' arms the pass-turn pause; otherwise the turn clock keeps running
		this.armTimers(false)
		this.syncBoard()
		return { ok: true }
	}

	stage(playerId: string, from: MoveFrom, to: MoveTo): ActionResult {
		const check = this.turnCheck(playerId)
		if (!check.ok) return check
		const result = stageMove(this.game, from, to)
		if (result.ok) this.syncBoard()
		return result
	}

	undo(playerId: string): ActionResult {
		const check = this.turnCheck(playerId)
		if (!check.ok) return check
		const result = undoStagedMove(this.game)
		if (result.ok) this.syncBoard()
		return result
	}

	confirm(playerId: string): ActionResult {
		const check = this.turnCheck(playerId)
		if (!check.ok) return check
		const result = confirmTurn(this.game)
		if (result.ok) {
			this.armTimers(true)
			this.syncBoard()
		}
		return result
	}

	/** Start a fresh game with the same seats (only after game over). */
	reset(playerId: string): ActionResult {
		const seat = this.seatOf(playerId)
		if (seat === 'spectator') return { ok: false, error: 'Spectators cannot play.' }
		if (this.game.phase !== 'gameover') return { ok: false, error: 'Game is still in progress.' }
		const fresh = initialGameState()
		Object.assign(this.game, fresh, { seats: { ...this.game.seats } })
		if (this.seats.w && this.seats.b) startGame(this.game, rng)
		this.armTimers(true)
		this.syncBoard()
		return { ok: true }
	}

	/**
	 * Re-render the whole board into the tldraw document. All board shapes are
	 * locked; clients connect readonly, so the server is the only writer.
	 */
	private syncBoard(): void {
		this.stacks = updateStacks(this.stacks, this.game)
		const specs = buildBoardSpecs(this.game, this.stacks)
		const indices = getIndices(specs.length)
		this.storage.transaction((txn) => {
			let pageId: string | null = null
			const staleIds: string[] = []
			const newIds = new Set(specs.map((s) => createShapeId(s.id) as string))
			for (const record of txn.values()) {
				if (record.typeName === 'page' && !pageId) pageId = record.id
				if (record.typeName === 'shape' && !newIds.has(record.id)) staleIds.push(record.id)
			}
			if (!pageId) throw new Error('room has no page record')
			for (const id of staleIds) txn.delete(id)
			specs.forEach((spec, i) => {
				const shape = {
					id: createShapeId(spec.id),
					typeName: 'shape',
					type: BG_SHAPE_TYPE,
					x: spec.x,
					y: spec.y,
					rotation: 0,
					index: indices[i],
					parentId: pageId,
					isLocked: true,
					opacity: 1,
					props: spec.props,
					meta: spec.meta,
				} as unknown as TLShape
				txn.set(shape.id, shape)
			})
		})
	}
}

const rooms = new Map<string, GameRoom>()

export function getOrCreateRoom(roomId: string): GameRoom {
	const sanitized = roomId.replace(/[^a-zA-Z0-9_-]/g, '_')
	let room = rooms.get(sanitized)
	if (!room) {
		console.log(`creating room ${sanitized}`)
		room = new GameRoom(sanitized)
		rooms.set(sanitized, room)
	}
	return room
}
