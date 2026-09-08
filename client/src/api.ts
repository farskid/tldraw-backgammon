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

export function resetGame(roomId: string, playerId: string) {
	return post(`/api/rooms/${roomId}/reset`, { playerId })
}

export function getPlayerId(): string {
	// sessionStorage is per-tab, so two tabs in the same browser get different
	// player ids — handy for local testing.
	let id = sessionStorage.getItem('bg-player-id')
	if (!id) {
		id = crypto.randomUUID()
		sessionStorage.setItem('bg-player-id', id)
	}
	return id
}
