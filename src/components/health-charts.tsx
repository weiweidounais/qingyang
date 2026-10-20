export function TrendChart({
  values,
  color = "#9a88de",
  labels,
}: {
  values: number[];
  color?: string;
  labels?: string[];
}) {
  const min = Math.min(...values) - 0.4,
    max = Math.max(...values) + 0.4;
  const points = values
    .map(
      (v, i) =>
        `${12 + (i * 276) / Math.max(values.length - 1, 1)},${76 - ((v - min) / (max - min)) * 56}`,
    )
    .join(" ");
  return (
    <div className="trend-chart">
      <svg
        role="img"
        aria-label={
          values.length ? "趋势：" + values.join("、") : "暂无趋势记录"
        }
        viewBox="0 0 300 100"
        preserveAspectRatio="none"
      >
        <path
          d="M0 25h300M0 55h300M0 85h300"
          stroke="currentColor"
          strokeDasharray="3 5"
          opacity=".12"
        />
        {values.length > 0 && (
          <>
            <polygon
              points={`12,98 ${points} 288,98`}
              fill={color}
              opacity=".08"
            />
            <polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {values.map((v, i) => (
              <circle
                key={i}
                cx={12 + (i * 276) / Math.max(values.length - 1, 1)}
                cy={76 - ((v - min) / (max - min)) * 56}
                r="3"
                fill="white"
                stroke={color}
                strokeWidth="2"
              />
            ))}
          </>
        )}
      </svg>
      {labels && (
        <div className="chart-labels">
          {labels.map((x, i) => (
            <span key={i}>{x}</span>
          ))}
        </div>
      )}
    </div>
  );
}
export function ProgressRing({
  value,
  total = 1800,
}: {
  value: number;
  total?: number;
}) {
  const p = Math.min(value / total, 1);
  return (
    <div className="calorie-ring">
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <circle
          cx="110"
          cy="110"
          r="94"
          fill="none"
          stroke="white"
          strokeWidth="13"
          opacity=".65"
        />
        <circle
          cx="110"
          cy="110"
          r="94"
          fill="none"
          stroke="#9381dc"
          strokeWidth="13"
          strokeDasharray={`${p * 590.6} 590.6`}
          strokeLinecap="round"
          transform="rotate(-90 110 110)"
        />
        <circle cx="110" cy="110" r="76" fill="white" opacity=".78" />
      </svg>
      <div>
        <span>今日还可以摄入</span>
        <strong>{Math.max(total - value, 0).toLocaleString()}</strong>
        <small>千卡 / {total.toLocaleString()} 千卡</small>
      </div>
    </div>
  );
}
