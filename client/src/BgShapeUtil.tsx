import { BG_SHAPE_TYPE, BgShapeProps, bgShapeProps } from '@backgammon/shared'
import { Geometry2d, RecordProps, Rectangle2d, SVGContainer, ShapeUtil, TLShape } from 'tldraw'

export type BgShape = TLShape<typeof BG_SHAPE_TYPE>

/** Pip positions on a 7x7 grid for die faces 1..6 */
const PIPS: Record<number, [number, number][]> = {
	1: [[3.5, 3.5]],
	2: [
		[2, 2],
		[5, 5],
	],
	3: [
		[2, 2],
		[3.5, 3.5],
		[5, 5],
	],
	4: [
		[2, 2],
		[5, 2],
		[2, 5],
		[5, 5],
	],
	5: [
		[2, 2],
		[5, 2],
		[3.5, 3.5],
		[2, 5],
		[5, 5],
	],
	6: [
		[2, 2],
		[5, 2],
		[2, 3.5],
		[5, 3.5],
		[2, 5],
		[5, 5],
	],
}

export class BgShapeUtil extends ShapeUtil<BgShape> {
	static override type = BG_SHAPE_TYPE
	static override props: RecordProps<BgShape> = bgShapeProps

	override getDefaultProps(): BgShapeProps {
		return {
			w: 1,
			h: 1,
			kind: 'label',
			fill: '',
			stroke: '',
			label: '',
			value: 0,
			dir: 'none',
		}
	}

	override canEdit() {
		return false
	}
	override canResize() {
		return false
	}
	override hideRotateHandle() {
		return true
	}
	override hideResizeHandles() {
		return true
	}
	override hideSelectionBoundsFg() {
		return true
	}
	override hideSelectionBoundsBg() {
		return true
	}

	override getGeometry(shape: BgShape): Geometry2d {
		return new Rectangle2d({
			width: Math.max(shape.props.w, 1),
			height: Math.max(shape.props.h, 1),
			isFilled: true,
		})
	}

	override component(shape: BgShape) {
		const { w, h, kind, fill, stroke, label, value, dir } = shape.props

		switch (kind) {
			case 'state':
				return null

			case 'board':
				return (
					<SVGContainer>
						<rect width={w} height={h} rx={16} fill={stroke} />
						<rect x={14} y={14} width={w - 28} height={h - 28} rx={8} fill={fill} />
					</SVGContainer>
				)

			case 'zone':
				return (
					<SVGContainer>
						<rect width={w} height={h} rx={8} fill={fill} stroke={stroke} strokeWidth={3} />
					</SVGContainer>
				)

			case 'point': {
				const pts =
					dir === 'down'
						? `2,0 ${w - 2},0 ${w / 2},${h}`
						: `2,${h} ${w - 2},${h} ${w / 2},0`
				const labelY = dir === 'down' ? 16 : h - 6
				return (
					<SVGContainer>
						<polygon points={pts} fill={fill} stroke={stroke} strokeWidth={1.5} />
						<text
							x={w / 2}
							y={labelY}
							textAnchor="middle"
							fontSize={13}
							fontFamily="sans-serif"
							fill="rgba(255,255,255,0.75)"
						>
							{label}
						</text>
					</SVGContainer>
				)
			}

			case 'tray':
				return (
					<SVGContainer>
						<rect
							width={w}
							height={h}
							rx={10}
							fill={fill}
							fillOpacity={0.25}
							stroke={stroke}
							strokeWidth={3}
						/>
						{/* count + label at the top; the borne-off chip pile grows from the bottom */}
						<text
							x={w / 2}
							y={32}
							textAnchor="middle"
							fontSize={26}
							fontWeight="bold"
							fontFamily="sans-serif"
							fill="#e8e0d0"
						>
							{value}
						</text>
						<text
							x={w / 2}
							y={52}
							textAnchor="middle"
							fontSize={12}
							fontFamily="sans-serif"
							fill="#e8e0d0"
						>
							{label}
						</text>
					</SVGContainer>
				)

			case 'checker': {
				// Round checker on the board; flattened ellipse when borne off in the tray.
				const rx = w / 2
				const ry = h / 2
				return (
					<SVGContainer>
						<ellipse
							cx={rx}
							cy={ry}
							rx={rx - 2}
							ry={Math.max(ry - 2, 3)}
							fill={fill}
							stroke={stroke}
							strokeWidth={2.5}
						/>
						{h > 30 && (
							<ellipse
								cx={rx}
								cy={ry}
								rx={rx - 9}
								ry={ry - 9}
								fill="none"
								stroke={stroke}
								strokeWidth={1.5}
								opacity={0.6}
							/>
						)}
						{label && (
							<text
								x={rx}
								y={ry + 6}
								textAnchor="middle"
								fontSize={20}
								fontWeight="bold"
								fontFamily="sans-serif"
								fill={fill === '#f3ead8' ? '#4a3c22' : '#e8e0d0'}
							>
								{label}
							</text>
						)}
					</SVGContainer>
				)
			}

			case 'die': {
				const pipFill = fill === '#f3ead8' ? '#35322e' : '#f3ead8'
				const unit = w / 7
				return (
					<SVGContainer>
						<rect width={w} height={h} rx={9} fill={fill} stroke={stroke} strokeWidth={2} />
						{(PIPS[value] ?? []).map(([px, py], i) => (
							<circle key={i} cx={px * unit} cy={py * unit} r={unit * 0.42} fill={pipFill} />
						))}
					</SVGContainer>
				)
			}

			case 'label':
				return (
					<SVGContainer>
						<text
							x={w / 2}
							y={h / 2}
							textAnchor="middle"
							dominantBaseline="central"
							fontSize={value || 20}
							fontWeight="bold"
							fontFamily="sans-serif"
							fill={fill || '#e8e0d0'}
						>
							{label}
						</text>
					</SVGContainer>
				)

			default:
				return null
		}
	}

	// Board shapes are locked and never selected, so no indicator is needed.
	override getIndicatorPath() {
		return undefined
	}
}
