export default function AlertBanner({ alerts }) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="alert-banner alert-banner-ok">
        <span>✓</span> On track - no action needed right now.
      </div>
    );
  }

  return (
    <div className="alert-banner-stack">
      {alerts.map((alert) => (
        <div key={alert.type} className="alert-banner alert-banner-warning">
          <span>⚠️</span> {alert.message}
        </div>
      ))}
    </div>
  );
}
