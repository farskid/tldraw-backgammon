import type {} from '@tldraw/tlschema'
import { T } from '@tldraw/validate'

/**
 * A single custom tldraw shape type renders every element of the board.
 * The `kind` prop selects the visual. The server is the only writer of these
 * shapes; clients connect readonly and never edit them directly.
 */
export const BG_SHAPE_TYPE = 'bg' as const

// Register the custom shape type with tldraw's global shape map so that
// TLShape/TLRecord include it on both the client and the server.
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		bg: BgShapeProps
	}
}

export interface BgShapeProps {
	w: number
	h: number
	/** 'board' | 'zone' | 'point' | 'tray' | 'checker' | 'die' | 'label' | 'state' */
	kind: string
	fill: string
	stroke: string
	label: string
	/** die value, font size for labels, etc. */
	value: number
	/** triangle direction: 'up' | 'down' | 'none' */
	dir: string
}

/** Prop validators, shared by the client ShapeUtil and the server schema. */
export const bgShapeProps = {
	w: T.number,
	h: T.number,
	kind: T.string,
	fill: T.string,
	stroke: T.string,
	label: T.string,
	value: T.number,
	dir: T.string,
}
