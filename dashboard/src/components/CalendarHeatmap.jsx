const STATUS_LABEL = {
  completed: 'Completed',
  skipped: 'Skipped',
  no_response: 'No response',
  in_progress: 'In progress',
  sent: 'Sent, no reply yet',
  pending: 'Pending',
  none: 'No plan',
  before_start: 'Not yet added',
};

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function CalendarHeatmap({ calendar }) {
  const allEmpty = calendar.every((d) => d.status === 'none' || d.status === 'before_start');
  const leadingPadding = calendar.length > 0 ? calendar[0].dayOfWeek : 0;

  return (
    <div>
      <div className="heatmap-weekdays">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
      <div className="heatmap-grid">
        {Array.from({ length: leadingPadding }).map((_, i) => (
          <div key={`pad-${i}`} className="heatmap-cell heatmap-cell-spacer" />
        ))}
        {calendar.map((day) => (
          <div
            key={day.date}
            className={`heatmap-cell status-${day.status}`}
            title={`${day.date}: ${STATUS_LABEL[day.status] || day.status}`}
          />
        ))}
      </div>
      {allEmpty && (
        <p className="muted heatmap-empty-note">No activity yet in this range.</p>
      )}
      <div className="heatmap-legend">
        {['completed', 'skipped', 'no_response', 'none'].map((status) => (
          <span key={status} className="legend-item">
            <span className={`legend-swatch status-${status}`} />
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>
    </div>
  );
}
