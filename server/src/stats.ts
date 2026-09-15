/**
 * Durable usage stats in a single SQLite file, via the Node 22 built-in
 * `node:sqlite` (no native module to compile — works as-is in node:22-slim).
 *
 * Zero-maintenance by design: the schema is created on boot with
 * CREATE TABLE IF NOT EXISTS, so there are no migrations to run. If the DB
 * can't be opened (bad path, read-only disk) the server logs loudly and keeps
 * running with stats disabled — gameplay never depends on the database.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync, StatementSync } from 'node:sqlite'

export type StatsEventType =
	| 'room_created'
	| 'player_joined'
	| 'spectator_joined'
	| 'game_started'
	| 'game_finished'

const DB_PATH = process.env.STATS_DB_PATH ?? './data/stats.sqlite'

let db: DatabaseSync | null = null
let insertEvent: StatementSync | null = null

try {
	mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true })
	db = new DatabaseSync(DB_PATH)
	// WAL keeps writes cheap and safe against a crash mid-write.
	db.exec('PRAGMA journal_mode = WAL')
	db.exec(`
		CREATE TABLE IF NOT EXISTS events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			room_id TEXT,
			player_id TEXT,
			detail TEXT,
			created_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
		CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
	`)
	insertEvent = db.prepare(
		'INSERT INTO events (type, room_id, player_id, detail, created_at) VALUES (?, ?, ?, ?, ?)'
	)
	console.log(`usage stats: recording to ${path.resolve(DB_PATH)}`)
} catch (err) {
	db = null
	insertEvent = null
	console.error(`usage stats DISABLED — could not open ${DB_PATH}:`, err)
}

/** Append one usage event. Never throws: a stats failure must not break a game. */
export function recordEvent(
	type: StatsEventType,
	fields: { roomId?: string; playerId?: string; detail?: string } = {}
): void {
	if (!insertEvent) return
	try {
		insertEvent.run(type, fields.roomId ?? null, fields.playerId ?? null, fields.detail ?? null, Date.now())
	} catch (err) {
		console.error('usage stats: failed to record event', type, err)
	}
}

export interface DurableStats {
	rooms_created: number
	games_started: number
	games_finished: number
	player_joins: number
	unique_players: number
	spectator_joins: number
	daily: { day: string; type: string; count: number }[]
	last_events: { type: string; room_id: string | null; player_id: string | null; detail: string | null; at: string }[]
}

/** Aggregates over the events table, or null when the DB is unavailable. */
export function getDurableStats(): DurableStats | null {
	if (!db) return null
	const count = (sql: string) => Number((db!.prepare(sql).get() as { n: number | bigint }).n)
	const daily = db
		.prepare(
			`SELECT date(created_at / 1000, 'unixepoch') AS day, type, COUNT(*) AS count
			 FROM events
			 WHERE created_at >= (unixepoch() - 14 * 86400) * 1000
			 GROUP BY day, type
			 ORDER BY day DESC, type`
		)
		.all() as { day: string; type: string; count: number }[]
	const last_events = (
		db
			.prepare(
				'SELECT type, room_id, player_id, detail, created_at FROM events ORDER BY id DESC LIMIT 20'
			)
			.all() as { type: string; room_id: string | null; player_id: string | null; detail: string | null; created_at: number }[]
	).map(({ created_at, ...rest }) => ({ ...rest, at: new Date(Number(created_at)).toISOString() }))
	return {
		rooms_created: count(`SELECT COUNT(*) AS n FROM events WHERE type = 'room_created'`),
		games_started: count(`SELECT COUNT(*) AS n FROM events WHERE type = 'game_started'`),
		games_finished: count(`SELECT COUNT(*) AS n FROM events WHERE type = 'game_finished'`),
		player_joins: count(`SELECT COUNT(*) AS n FROM events WHERE type = 'player_joined'`),
		unique_players: count(
			`SELECT COUNT(DISTINCT player_id) AS n FROM events WHERE type = 'player_joined'`
		),
		spectator_joins: count(`SELECT COUNT(*) AS n FROM events WHERE type = 'spectator_joined'`),
		daily: daily.map((r) => ({ ...r, count: Number(r.count) })),
		last_events,
	}
}
