import {
	BOARD_H,
	COLOR_NAME,
	GameState,
	MoveFrom,
	MoveTo,
	TOTAL_W,
	legalMoves,
	moveSourceCenter,
	moveTargetCenter,
} from '@backgammon/shared'
import { useSync } from '@tldraw/sync'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	Box,
	Editor,
	TLAssetStore,
	TLEventInfo,
	Tldraw,
	createShapeId,
	defaultBindingUtils,
	defaultShapeUtils,
	useEditor,
	useValue,
} from 'tldraw'
import { BgShapeUtil } from './BgShapeUtil'
import {
	Seat,
	confirmTurn,
	getPlayerId,
	joinRoom,
	resetGame,
	rollDice,
	sendMove,
	undoMove,
} from './api'

const STATE_SHAPE_ID = createShapeId('state')

/** navigator.clipboard is secure-context-only; fall back to execCommand on plain http://LAN_IP. */
function copyText(text: string) {
	if (navigator.clipboard) {
		navigator.clipboard.writeText(text).catch(() => {})
		return
	}
	const el = document.createElement('textarea')
	el.value = text
	el.style.position = 'fixed'
	el.style.opacity = '0'
	document.body.appendChild(el)
	el.select()
	document.execCommand('copy')
	el.remove()
}

// No images/videos in this app; the board is drawn entirely by the server.
const noAssets: TLAssetStore = {
	upload: async () => {
		throw new Error('asset uploads are disabled')
	},
	resolve: () => null,
}

export function Game({ roomId }: { roomId: string }) {
	const playerId = useMemo(getPlayerId, [])
	const [seat, setSeat] = useState<Seat | null>(null)

	useEffect(() => {
		let cancelled = false
		joinRoom(roomId, playerId).then((res) => {
			if (!cancelled) setSeat(res.seat)
		})
		return () => {
			cancelled = true
		}
	}, [roomId, playerId])

	const store = useSync({
		uri: `${location.origin.replace(/^http/, 'ws')}/connect/${roomId}?playerId=${playerId}`,
		assets: noAssets,
		shapeUtils: useMemo(() => [...defaultShapeUtils, BgShapeUtil], []),
		bindingUtils: useMemo(() => [...defaultBindingUtils], []),
	})

	const onMount = useCallback((editor: Editor) => {
		// The server is authoritative: the whole document is readonly for everyone.
		editor.updateInstanceState({ isReadonly: true })
		editor.zoomToBounds(new Box(-30, -150, TOTAL_W + 60, BOARD_H + 210), {
			inset: 0,
			immediate: true,
		})
	}, [])

	return (
		<div className="game-root">
			<Tldraw store={store} shapeUtils={[BgShapeUtil]} hideUi onMount={onMount}>
				<GameOverlay roomId={roomId} playerId={playerId} seat={seat} />
			</Tldraw>
		</div>
	)
}

function GameOverlay({
	roomId,
	playerId,
	seat,
}: {
	roomId: string
	playerId: string
	seat: Seat | null
}) {
	const editor = useEditor()
	const [selected, setSelected] = useState<MoveFrom | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const state = useValue(
		'game-state',
		() => {
			const shape = editor.getShape(STATE_SHAPE_ID)
			const json = shape?.meta?.json
			return typeof json === 'string' ? (JSON.parse(json) as GameState) : null
		},
		[editor]
	)

	const camera = useValue('camera', () => editor.getCamera(), [editor])

	const flashError = useCallback((message: string) => {
		setError(message)
		window.setTimeout(() => setError(null), 2500)
	}, [])

	const myTurn = !!state && seat !== null && seat !== 'spectator' && state.turn === seat
	const moves = useMemo(
		() => (state && myTurn && state.phase === 'moving' ? legalMoves(state) : []),
		[state, myTurn]
	)

	// Clear a stale selection when the turn/dice change under us
	useEffect(() => {
		if (selected !== null && !moves.some((m) => m.from === selected)) {
			setSelected(null)
		}
	}, [moves, selected])

	// refs so the pointer handler always sees the latest values
	const movesRef = useRef(moves)
	movesRef.current = moves
	const selectedRef = useRef(selected)
	selectedRef.current = selected
	const busyRef = useRef(busy)
	busyRef.current = busy

	useEffect(() => {
		const onEvent = (info: TLEventInfo) => {
			if (info.name !== 'pointer_down') return
			if (info.button !== 0) return
			if (busyRef.current) return
			const currentMoves = movesRef.current
			if (currentMoves.length === 0) return

			const point = editor.inputs.currentPagePoint
			const shape = editor.getShapeAtPoint(point, { hitInside: true, hitLocked: true })
			const click = shape?.meta?.click
			if (typeof click !== 'string') {
				setSelected(null)
				return
			}

			let clickedFrom: MoveFrom | null = null
			let clickedTo: MoveTo | null = null
			if (click === 'bar') {
				clickedFrom = 'bar'
			} else if (click === 'off') {
				clickedTo = 'off'
			} else if (click.startsWith('point:')) {
				const idx = Number(click.slice(6))
				clickedFrom = idx
				clickedTo = idx
			}

			const from = selectedRef.current
			// Second click: try to complete a move from the selected source
			if (
				from !== null &&
				clickedTo !== null &&
				currentMoves.some((m) => m.from === from && m.to === clickedTo)
			) {
				setBusy(true)
				sendMove(roomId, playerId, from, clickedTo)
					.then((res) => {
						if (!res.ok) flashError(res.error ?? 'Move rejected.')
					})
					.catch(() => flashError('Network error.'))
					.finally(() => setBusy(false))
				setSelected(null)
				return
			}

			// First click (or re-click): select a source that has legal moves
			if (clickedFrom !== null && currentMoves.some((m) => m.from === clickedFrom)) {
				setSelected((prev) => (prev === clickedFrom ? null : clickedFrom))
			} else {
				setSelected(null)
			}
		}
		editor.on('event', onEvent)
		return () => {
			editor.off('event', onEvent)
		}
	}, [editor, roomId, playerId, flashError])

	if (!state) return null

	const toScreen = (p: { x: number; y: number }) => ({
		x: (p.x + camera.x) * camera.z,
		y: (p.y + camera.y) * camera.z,
	})

	const sources = [...new Set(moves.map((m) => m.from))]
	const targets =
		selected !== null
			? [...new Set(moves.filter((m) => m.from === selected).map((m) => m.to))]
			: []
	const seatColor = seat === 'w' || seat === 'b' ? seat : null

	return (
		<>
			{/* move highlights */}
			<svg className="highlight-layer">
				{selected === null &&
					seatColor &&
					sources.map((from) => {
						const c = toScreen(moveSourceCenter(from, seatColor))
						return (
							<circle
								key={`s-${from}`}
								cx={c.x}
								cy={c.y}
								r={32 * camera.z}
								className="ring ring-source"
							/>
						)
					})}
				{selected !== null && seatColor && (
					<circle
						cx={toScreen(moveSourceCenter(selected, seatColor)).x}
						cy={toScreen(moveSourceCenter(selected, seatColor)).y}
						r={32 * camera.z}
						className="ring ring-selected"
					/>
				)}
				{seatColor &&
					targets.map((to) => {
						const c = toScreen(moveTargetCenter(to, seatColor))
						return (
							<circle
								key={`t-${to}`}
								cx={c.x}
								cy={c.y}
								r={32 * camera.z}
								className="ring ring-target"
							/>
						)
					})}
			</svg>

			{/* HUD */}
			<div className="hud">
				<div className="hud-row hud-title">
					<span>Room {roomId}</span>
					<button
						className="hud-btn hud-btn-small"
						onClick={() => copyText(location.href)}
					>
						Copy link
					</button>
				</div>
				<div className="hud-row">
					{seat === null ? (
						'Joining…'
					) : seat === 'spectator' ? (
						'You are spectating (seats are full)'
					) : (
						<>
							<span className={`chip chip-${seat}`} aria-label={COLOR_NAME[seat]} />
							<b>You</b>
						</>
					)}
				</div>
				<div className="hud-row hud-status">{state.message}</div>
				{state.phase !== 'waiting' && state.phase !== 'gameover' && (
					<div className="hud-row">
						Turn: <span className={`chip chip-${state.turn}`} />
						<b>{COLOR_NAME[state.turn]}</b>
						{state.turnDeadline !== null && <Countdown deadline={state.turnDeadline} />}
						{state.lastRoll && (
							<span>
								· 🎲 {state.lastRoll[0]}-{state.lastRoll[1]}
							</span>
						)}
					</div>
				)}
				<div className="hud-row">
					Bar — White: {state.bar.w}, Black: {state.bar.b} · Off — White: {state.off.w}, Black:{' '}
					{state.off.b}
				</div>
				{myTurn && state.phase === 'rolling' && (
					<button
						className="hud-btn"
						disabled={busy}
						onClick={() => {
							setBusy(true)
							rollDice(roomId, playerId)
								.then((res) => {
									if (!res.ok) flashError(res.error ?? 'Roll rejected.')
								})
								.catch(() => flashError('Network error.'))
								.finally(() => setBusy(false))
						}}
					>
						🎲 Roll dice
					</button>
				)}
				{myTurn && state.phase === 'moving' && (
					<>
						<div className="hud-row">
							<button
								className="hud-btn hud-btn-secondary"
								disabled={busy || state.staged.length === 0}
								onClick={() => {
									setBusy(true)
									undoMove(roomId, playerId)
										.then((res) => {
											if (!res.ok) flashError(res.error ?? 'Undo rejected.')
										})
										.catch(() => flashError('Network error.'))
										.finally(() => setBusy(false))
								}}
							>
								↩ Undo
							</button>
							<button
								className="hud-btn"
								disabled={busy || moves.length > 0}
								title={moves.length > 0 ? 'Play your remaining dice first' : 'End your turn'}
								onClick={() => {
									setBusy(true)
									confirmTurn(roomId, playerId)
										.then((res) => {
											if (!res.ok) flashError(res.error ?? 'Confirm rejected.')
										})
										.catch(() => flashError('Network error.'))
										.finally(() => setBusy(false))
								}}
							>
								✓ OK
							</button>
						</div>
						<div className="hud-hint">
							{moves.length === 0
								? 'No moves left — press OK to end your turn.'
								: selected === null
									? 'Click one of your highlighted checkers…'
									: 'Now click a highlighted destination.'}
						</div>
					</>
				)}
				{state.phase === 'stuck' && (
					<div className="hud-hint">No legal moves — passing the turn…</div>
				)}
				{state.phase === 'gameover' && seat !== 'spectator' && seat !== null && (
					<button
						className="hud-btn"
						disabled={busy}
						onClick={() => {
							setBusy(true)
							resetGame(roomId, playerId)
								.catch(() => flashError('Network error.'))
								.finally(() => setBusy(false))
						}}
					>
						New game
					</button>
				)}
			</div>

			{error && <div className="toast">{error}</div>}
		</>
	)
}

/**
 * Displays the remaining turn time. The deadline is a server timestamp — the
 * server ends the turn on expiry regardless of what this shows.
 */
function Countdown({ deadline }: { deadline: number }) {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		const t = window.setInterval(() => setNow(Date.now()), 250)
		return () => window.clearInterval(t)
	}, [])
	const secs = Math.max(0, Math.ceil((deadline - now) / 1000))
	return <span className={secs <= 10 ? 'clock clock-low' : 'clock'}>⏱ {secs}s</span>
}
