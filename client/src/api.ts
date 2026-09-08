import { MoveFrom, MoveTo } from '@backgammon/shared'

export type Seat = 'w' | 'b' | 'spectator'

async function post(path: string, body: object): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
	const res = await fetch(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return res.json()
}

export function joinRoom(roomId: string, playerId: string) {
	return post(`/api/rooms/${roomId}/join`, { playerId }) as Promise<{ ok: boolean; seat: Seat }>
}

export function rollDice(roomId: string, playerId: string) {
	return post(`/api/rooms/${roomId}/roll`, { playerId })
}

export function sendMove(roomId: string, playerId: string, from: MoveFrom, to: MoveTo) {
	return post(`/api/rooms/${roomId}/move`, { playerId, from, to })
}

export function undoMove(roomId: string, playerId: string) {
	return post(`/api/rooms/${roomId}/undo`, { playerId })
}

export function confirmTurn(roomId: string, playerId: string) {
	return post(`/api/rooms/${roomId}/confirm`, { playerId })
}

export function resetGame(roomId: string, playerId: string) {
	return post(`/api/rooms/${roomId}/reset`, { playerId })
}

/**
 * UUID v4 that also works on insecure origins (e.g. http://192.168.x.x):
 * crypto.randomUUID is secure-context-only, but getRandomValues is not.
 */
function generateUuid(): string {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
	if (typeof crypto.getRandomValues === 'function') {
		const bytes = crypto.getRandomValues(new Uint8Array(16))
		bytes[6] = (bytes[6] & 0x0f) | 0x40
		bytes[8] = (bytes[8] & 0x3f) | 0x80
		const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
	}
	// last-resort fallback for very old browsers
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
	})
}

export function getPlayerId(): string {
	// sessionStorage is per-tab, so two tabs in the same browser get different
	// player ids — handy for local testing.
	let id = sessionStorage.getItem('bg-player-id')
	if (!id) {
		id = generateUuid()
		sessionStorage.setItem('bg-player-id', id)
	}
	return id
}
