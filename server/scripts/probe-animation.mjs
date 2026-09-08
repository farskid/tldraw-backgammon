/**
 * Headless verification that checker moves animate in the browser DOM.
 * Opens two pages (both seats), rolls, then samples every bg shape's inline
 * transform at 15ms while triggering a legal move via the HTTP API. A result
 * like "shape:checker-w4:7" means the checker passed through 7 distinct
 * positions, i.e. the server's interpolated animation frames arrived.
 *
 * Dev-only probe; not part of the app. Requires the dev servers running, a
 * Chrome binary, and `npm i --no-save playwright-core`.
 */
import { chromium } from 'playwright-core'

const room = `probe-${Math.random().toString(36).slice(2, 8)}`
const url = (n) => `http://localhost:5173/?room=${room}&probe=${n}`

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome' })
const ctx1 = await browser.newContext()
const ctx2 = await browser.newContext()
const p1 = await ctx1.newPage()
const p2 = await ctx2.newPage()

await p1.goto(url(1))
await p1.waitForSelector('.tl-shape[data-shape-type="bg"]', { timeout: 15000 })
await p2.goto(url(2))
await p2.waitForSelector('.tl-shape[data-shape-type="bg"]', { timeout: 15000 })
await p1.waitForTimeout(1500)

const result = await p1.evaluate(async (roomId) => {
	const post = (p, b) =>
		fetch(`/api/rooms/${roomId}/${p}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(b),
		}).then((r) => r.json())
	const getState = () => fetch(`/api/rooms/${roomId}/state`).then((r) => r.json())

	// find both playerIds: this page knows its own; ask the server whose turn it is
	const myPid = sessionStorage.getItem('bg-player-id')
	let st = await getState()
	if (st.phase === 'waiting') return { error: 'game did not start' }

	// sample all checker transforms, requerying so remounts don't matter
	const seen = new Map()
	const iv = setInterval(() => {
		document
			.querySelectorAll('.tl-shape[data-shape-type="bg"]:not(.tl-shape-background)')
			.forEach((e) => {
				const id = e.getAttribute('data-shape-id')
				if (!id || !id.includes('checker')) return
				if (!seen.has(id)) seen.set(id, new Set())
				seen.get(id).add(e.style.transform)
			})
	}, 15)

	// I may be either seat; try acting, and if it's not my turn report that
	if (st.phase === 'rolling') await post('roll', { playerId: myPid })
	st = await getState()
	let played = null
	if (st.phase === 'moving') {
		outer: for (const f of ['bar', ...Array.from({ length: 24 }, (_, i) => i)]) {
			for (const t of [...Array.from({ length: 24 }, (_, i) => i), 'off']) {
				const r = await post('move', { playerId: myPid, from: f, to: t })
				if (r.ok) {
					played = [f, t]
					break outer
				}
			}
		}
	}
	await new Promise((r) => setTimeout(r, 900))
	clearInterval(iv)
	const moved = [...seen.entries()]
		.filter(([, s]) => s.size > 1)
		.map(([id, s]) => `${id}:${s.size}`)
	return { phase: st.phase, turn: st.turn, played, moved, checkers: seen.size }
}, room)

console.log('page1 result:', JSON.stringify(result))

// if page1 wasn't the current player, run the same from page2
if (!result.played && !result.error) {
	const result2 = await p2.evaluate(async (roomId) => {
		const post = (p, b) =>
			fetch(`/api/rooms/${roomId}/${p}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(b),
			}).then((r) => r.json())
		const getState = () => fetch(`/api/rooms/${roomId}/state`).then((r) => r.json())
		const myPid = sessionStorage.getItem('bg-player-id')
		let st = await getState()
		const seen = new Map()
		const iv = setInterval(() => {
			document
				.querySelectorAll('.tl-shape[data-shape-type="bg"]:not(.tl-shape-background)')
				.forEach((e) => {
					const id = e.getAttribute('data-shape-id')
					if (!id || !id.includes('checker')) return
					if (!seen.has(id)) seen.set(id, new Set())
					seen.get(id).add(e.style.transform)
				})
		}, 15)
		if (st.phase === 'rolling') await post('roll', { playerId: myPid })
		st = await getState()
		let played = null
		if (st.phase === 'moving') {
			outer: for (const f of ['bar', ...Array.from({ length: 24 }, (_, i) => i)]) {
				for (const t of [...Array.from({ length: 24 }, (_, i) => i), 'off']) {
					const r = await post('move', { playerId: myPid, from: f, to: t })
					if (r.ok) {
						played = [f, t]
						break outer
					}
				}
			}
		}
		await new Promise((r) => setTimeout(r, 900))
		clearInterval(iv)
		const moved = [...seen.entries()]
			.filter(([, s]) => s.size > 1)
			.map(([id, s]) => `${id}:${s.size}`)
		return { phase: st.phase, turn: st.turn, played, moved, checkers: seen.size }
	}, room)
	console.log('page2 result:', JSON.stringify(result2))
}

await browser.close()
