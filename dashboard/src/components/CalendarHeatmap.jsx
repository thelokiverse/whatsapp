const STATUS_LABEL = {
  completed: 'Completed',
  skipped: 'Skipped',
  no_response: 'No response',
  in_progress: 'In progress',
  sent: 'Sent, no reply yet',
  pending: 'Pending',
  none: 'No plan',
};

export default function CalendarHeatmap({ calendar }) {
  return (
    <div>
      <div className="heatmap-grid">
        {calendar.map((day) => (
          <div
            key={day.date}
            className={`heatmap-cell status-${day.status}`}
            title={`${day.date}: ${STATUS_LABEL[day.status] || day.status}`}
          />
        ))}
      </div>
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
