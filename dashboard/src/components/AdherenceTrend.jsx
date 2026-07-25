const ARROW = { up: '↑', down: '↓', flat: '→' };

export default function AdherenceTrend({ trend }) {
  if (!trend) return null;

  return (
    <div className="card">
      <h2>Adherence trend</h2>
      <div className="trend-comparison">
        <div className="trend-bar-group">
          <div className="trend-row-header">
            <span className="trend-label">Last week</span>
            <span className="trend-value">{trend.lastWeek}%</span>
          </div>
          <div className="trend-bar-track">
            <div className="trend-bar" style={{ width: `${trend.lastWeek}%` }} />
          </div>
        </div>
        <div className="trend-bar-group">
          <div className="trend-row-header">
            <span className="trend-label">This week</span>
            <span className="trend-value">
              {trend.thisWeek}% <span className={`trend-arrow trend-arrow-${trend.direction}`}>{ARROW[trend.direction]}</span>
            </span>
          </div>
          <div className="trend-bar-track">
            <div className="trend-bar trend-bar-current" style={{ width: `${trend.thisWeek}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
