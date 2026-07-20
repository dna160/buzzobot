/**
 * @tempo/ui — the Tempo design-system component library.
 *
 * Presentational, theme-aware React components implementing docs/design.
 * Components are stateless/controlled so they compose in either Server or
 * Client component trees; the consumer owns state and data fetching.
 */

export { cn } from './utils/cn.js';
export { Button, type ButtonProps } from './components/Button.js';
export { Card, CardHeader, CardBody, type CardHeaderProps } from './components/Card.js';
export { Badge, type BadgeProps } from './components/Badge.js';
export { Sparkline, type SparklineProps } from './components/Sparkline.js';
export { DeltaPill, type DeltaPillProps, type GoodDirection } from './components/DeltaPill.js';
export { StatTile, type StatTileProps } from './components/StatTile.js';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentOption,
} from './components/SegmentedControl.js';
export { Table, THead, TBody, TR, TH, TD } from './components/Table.js';
export { Skeleton, StatTileSkeleton } from './components/Skeleton.js';
export { EmptyState, type EmptyStateProps } from './components/EmptyState.js';
