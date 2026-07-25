import { useEffect, useState } from 'react';
import { getRecipients, getRecipientStats, clearToken } from '../api';
import CalendarHeatmap from './CalendarHeatmap';

export default function Dashboard({ onLoggedOut }) {
  const [recipients, setRecipients] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getRecipients()
      .then((rows) => {
        setRecipients(rows);
        if (rows.length > 0) setSelectedId(rows[0].id);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    getRecipientStats(selectedId, days)
      .then(setStats)
      .catch((err) => setError(err.message));
  }, [selectedId, days]);

  function handleLogout() {
    clearToken();
    onLoggedOut();
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <h1>WhatsApp Flow</h1>
        <button className="link-button" onClick={handleLogout}>
          Log out
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {recipients.length === 0 ? (
        <p>No care recipients yet.</p>
      ) : (
        <>
          <div className="controls">
            <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value)}>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            <div className="day-toggle">
              {[7, 30].map((n) => (
                <button
                  key={n}
                  className={days === n ? 'active' : ''}
                  onClick={() => setDays(n)}
                >
                  Last {n} days
                </button>
              ))}
            </div>
          </div>

          {stats && (
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-value">{stats.adherencePct}%</span>
                <span className="stat-label">Adherence ({stats.days}d)</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{stats.currentStreak}</span>
                <span className="stat-label">Day streak</span>
              </div>

              <div className="card wide">
                <h2>Calendar</h2>
                <CalendarHeatmap calendar={stats.calendar} />
              </div>

              <div className="card wide">
                <h2>Most-skipped exercises</h2>
                {stats.mostSkipped.length === 0 ? (
                  <p className="muted">No skips in this range.</p>
                ) : (
                  <ul className="skip-list">
                    {stats.mostSkipped.map((ex) => (
                      <li key={ex.exerciseId}>
                        <span>{ex.name}</span>
                        <span className="skip-count">{ex.skipCount}x</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
