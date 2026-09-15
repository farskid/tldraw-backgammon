import { useState } from 'react'
import { Game } from './Game'

function randomRoomId(): string {
	return Math.random().toString(36).slice(2, 8)
}

export function App() {
	const room = new URLSearchParams(location.search).get('room')
	const [draft, setDraft] = useState('')

	if (room) return <Game roomId={room} />

	const go = (id: string) => {
		if (!id.trim()) return
		location.search = `?room=${encodeURIComponent(id.trim())}`
	}

	return (
		<div className="lobby">
			<h1>🎲 tldraw backgammon</h1>
			<p>Play 2-player backgammon on a shared tldraw canvas.</p>
			<div className="lobby-form">
				<input
					placeholder="room id"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && go(draft)}
				/>
				<button onClick={() => go(draft)}>Join</button>
				<button onClick={() => go(randomRoomId())}>Create room</button>
			</div>
			<p className="lobby-hint">
				Open the same room URL in a second tab to play against yourself.
			</p>
		</div>
	)
}
