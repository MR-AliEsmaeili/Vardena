import type { ReactElement } from 'react';

/**
 * Tiny trend spark for the KPI cards (reference visual). Pure SVG, no
 * dependency; purely decorative (aria-hidden) because the exact values are
 * written in the card text itself.
 */
export function SparkLine({
  points,
  className = 'text-brand',
}: {
  points: number[];
  className?: string;
}): ReactElement {
  const width = 84;
  const height = 28;
  if (points.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden className={className} />
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coordinates = points.map((value, index) => {
    const x = index * step;
    const y = height - 3 - ((value - min) / span) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className={className}
    >
      <polyline
        points={coordinates.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
