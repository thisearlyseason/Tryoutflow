'use client';

import { useId } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Text,
  Tooltip,
} from 'recharts';
import {
  formatProfileScore,
  profileRows,
  type ProfileCriterion,
  type ProfileScale,
  type ProfileScore,
} from '../domain/athlete-profile';

// Recharts places null radar values at the center. Filter the rendered geometry,
// preserving all configured axes while ensuring missing observations are never zeroes.
function ProfilePolygon({
  points = [],
  stroke,
  fill,
  strokeDasharray,
}: {
  points?: readonly { x: number; y: number; value?: number | null }[];
  stroke?: string;
  fill?: string;
  strokeDasharray?: string;
}) {
  const observed = points.filter((point) => point.value !== null && point.value !== undefined);
  if (observed.length < 3) return <g />;
  return (
    <g>
      <polygon
        points={observed.map((point) => `${point.x},${point.y}`).join(' ')}
        stroke={stroke}
        fill={fill}
        fillOpacity={0.18}
        strokeWidth={2.5}
        strokeDasharray={strokeDasharray}
      />
      {observed.map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r={3.5} fill={stroke} />
      ))}
    </g>
  );
}

export type AthleteRadarChartProps = {
  criteria: readonly ProfileCriterion[];
  scores: readonly ProfileScore[];
  comparisonScores?: readonly ProfileScore[];
  scale?: ProfileScale;
  athleteName?: string;
  comparisonName?: string;
};

export function AthleteRadarChart({
  criteria,
  scores,
  comparisonScores,
  scale,
  athleteName = 'Athlete',
  comparisonName = 'Comparison athlete',
}: AthleteRadarChartProps) {
  const descriptionId = useId();
  const rows = profileRows(criteria, scores, comparisonScores, scale);
  const scoredCount = rows.filter((row) => row.value !== null).length;
  const comparisonCount = rows.filter((row) => row.comparisonValue !== null).length;
  const ready = scoredCount >= 3;
  const comparisonReady = comparisonScores !== undefined && comparisonCount >= 3;
  const numbered = rows.length > 12;
  const primary = 'var(--color-primary)';
  const secondary = 'var(--color-text)';
  return (
    <div className="radar-profile min-w-0" data-testid="athlete-radar-profile">
      {ready || comparisonReady ? (
        <>
          <p id={descriptionId} className="sr-only">
            Each axis uses its configured scale. Unscored criteria have no point. Focus the chart
            and use arrow keys for scores.
          </p>
          <div
            className="profile-plot h-[280px] min-w-0 sm:h-[300px]"
            data-testid="athlete-radar-plot"
          >
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <RadarChart
                data={rows}
                outerRadius="67%"
                accessibilityLayer
                aria-label={`${athleteName} Athlete Profile radar chart`}
                aria-describedby={descriptionId}
              >
                <PolarGrid stroke="var(--color-border)" />
                <PolarAngleAxis
                  dataKey="id"
                  tick={(props) => {
                    const row = rows.find((item) => item.id === props.payload.value);
                    const label = numbered ? String(row?.index) : (row?.name ?? '');
                    return (
                      <Text
                        x={props.x}
                        y={props.y}
                        textAnchor={props.textAnchor}
                        verticalAnchor="middle"
                        width={80}
                        maxLines={3}
                        fontSize={11}
                        fontWeight={600}
                        fill="var(--color-text)"
                      >
                        {label}
                      </Text>
                    );
                  }}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  ticks={[25, 50, 75, 100]}
                  tick={false}
                  axisLine={false}
                />
                <Tooltip
                  filterNull={false}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as (typeof rows)[number] | undefined;
                    if (!row) return null;
                    return (
                      <div
                        role="status"
                        className="max-w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text)] shadow-[var(--shadow-raised)]"
                      >
                        <p className="font-bold">{row.name}</p>
                        <p>
                          {athleteName}: {formatProfileScore(row.value, row.max)}
                        </p>
                        {comparisonScores && (
                          <p>
                            {comparisonName}: {formatProfileScore(row.comparisonValue, row.max)}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                {ready && (
                  <Radar
                    name={athleteName}
                    dataKey="normalized"
                    stroke={primary}
                    fill={primary}
                    shape={<ProfilePolygon />}
                    activeDot={false}
                    animationDuration={250}
                    isAnimationActive="auto"
                  />
                )}
                {comparisonReady && (
                  <Radar
                    name={comparisonName}
                    dataKey="comparisonNormalized"
                    stroke={secondary}
                    fill={secondary}
                    strokeDasharray="6 4"
                    shape={<ProfilePolygon />}
                    activeDot={false}
                    animationDuration={250}
                    isAnimationActive="auto"
                  />
                )}
              </RadarChart>
            </ResponsiveContainer>
          </div>
          {comparisonScores && (
            <div
              className="mb-3 flex flex-wrap gap-4 text-xs font-bold"
              aria-label="Profile legend"
            >
              <span>
                <span
                  aria-hidden="true"
                  style={{ borderColor: primary }}
                  className="mr-2 inline-block w-6 border-t-[3px]"
                />
                {athleteName}
              </span>
              <span>
                <span
                  aria-hidden="true"
                  style={{ borderColor: secondary }}
                  className="mr-2 inline-block w-6 border-t-[3px] border-dashed"
                />
                {comparisonName}
              </span>
            </div>
          )}
        </>
      ) : null}
      {!ready && (
        <p className="profile-empty">Score at least 3 criteria to generate the Athlete Profile.</p>
      )}
      {comparisonScores && !comparisonReady && (
        <p className="mb-3 text-sm">
          {comparisonName}: score at least 3 criteria to generate the comparison profile.
        </p>
      )}
      <table className="profile-score-table w-full table-fixed text-left text-sm">
        <caption className="sr-only">Individual criterion scores</caption>
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th scope="col" className="py-2">
              Criterion
            </th>
            <th scope="col" className="py-2 text-right break-words">
              {comparisonScores ? athleteName : 'Score'}
            </th>
            {comparisonScores && (
              <th scope="col" className="py-2 text-right break-words">
                {comparisonName}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-[var(--color-border)] last:border-0">
              <th scope="row" className="py-2 pr-2 font-medium break-words">
                {numbered ? `${row.index}. ` : ''}
                {row.name}
              </th>
              <td className="py-2 text-right tabular-nums">
                <span>{formatProfileScore(row.value, row.max)}</span>
                {row.normalized !== null && (
                  <span className="criterion-meter" aria-hidden="true">
                    <span style={{ width: `${row.normalized}%` }} />
                  </span>
                )}
              </td>
              {comparisonScores && (
                <td className="py-2 text-right tabular-nums">
                  {formatProfileScore(row.comparisonValue, row.max)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
