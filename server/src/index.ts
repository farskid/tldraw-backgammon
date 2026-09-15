import express from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { getOrCreateRoom } from './rooms'

const PORT = Number(process.env.PORT ?? 5858)

const app = express()
app.use(express.json())

app.post('/api/rooms/:roomId/join', (req, res) => {
	const { playerId } = req.body ?? {}
	if (typeof playerId !== 'string' || !playerId) {
		res.status(400).json({ ok: false, error: 'playerId required' })
		return
	}
	const room = getOrCreateRoom(req.params.roomId)
	const seat = room.join(playerId)
	res.json({ ok: true, seat })
})

app.post('/api/rooms/:roomId/roll', (req, res) => {
	const { playerId } = req.body ?? {}
	const room = getOrCreateRoom(req.params.roomId)
	const result = room.roll(String(playerId ?? ''))
	res.status(result.ok ? 200 : 422).json(result)
})

app.post('/api/rooms/:roomId/move', (req, res) => {
	const { playerId, from, to } = req.body ?? {}
	const validFrom = from === 'bar' || (typeof from === 'number' && from >= 0 && from <= 23)
	const validTo = to === 'off' || (typeof to === 'number' && to >= 0 && to <= 23)
	if (!validFrom || !validTo) {
		res.status(400).json({ ok: false, error: 'invalid from/to' })
		return
	}
	const room = getOrCreateRoom(req.params.roomId)
	const result = room.stage(String(playerId ?? ''), from, to)
	res.status(result.ok ? 200 : 422).json(result)
})

app.post('/api/rooms/:roomId/undo', (req, res) => {
	const { playerId } = req.body ?? {}
	const room = getOrCreateRoom(req.params.roomId)
	const result = room.undo(String(playerId ?? ''))
	res.status(result.ok ? 200 : 422).json(result)
})

app.post('/api/rooms/:roomId/confirm', (req, res) => {
	const { playerId } = req.body ?? {}
	const room = getOrCreateRoom(req.params.roomId)
	const result = room.confirm(String(playerId ?? ''))
	res.status(result.ok ? 200 : 422).json(result)
})

app.post('/api/rooms/:roomId/reset', (req, res) => {
	const { playerId } = req.body ?? {}
	const room = getOrCreateRoom(req.params.roomId)
	const result = room.reset(String(playerId ?? ''))
	res.status(result.ok ? 200 : 422).json(result)
})

// Debug: inspect the authoritative game state
app.get('/api/rooms/:roomId/state', (req, res) => {
	res.json(getOrCreateRoom(req.params.roomId).game)
})

// If the client has been built, serve it too (single-process "production" mode).
const distDir = path.resolve(import.meta.dirname, '../../client/dist')
if (existsSync(distDir)) {
	app.use(express.static(distDir))
	app.get(/^\/(?!api\/|connect\/).*/, (_req, res) => {
		res.sendFile(path.join(distDir, 'index.html'))
	})
}

const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
	const url = new URL(req.url ?? '', `http://${req.headers.host}`)
	const match = url.pathname.match(/^\/connect\/([^/]+)$/)
	if (!match) {
		socket.destroy()
		return
	}
	const roomId = match[1]
	// `sessionId` is appended automatically by the tldraw sync client;
	// `playerId` is ours, added to the uri by the client app.
	const sessionId = url.searchParams.get('sessionId')
	const playerId = url.searchParams.get('playerId')
	if (!sessionId || !playerId) {
		socket.destroy()
		return
	}
	wss.handleUpgrade(req, socket, head, (ws) => {
		const room = getOrCreateRoom(roomId)
		room.registerSession(sessionId, playerId)
		// Every client is readonly: the server is the only writer of the
		// document. Moves are proposed over the HTTP API and validated there.
		room.room.handleSocketConnect({ sessionId, socket: ws, isReadonly: true })
	})
})

server.listen(PORT, () => {
	console.log(`backgammon server listening on http://localhost:${PORT}`)
})
