import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRecipients, getRecipientStats } from '../api';
import CalendarHeatmap from './CalendarHeatmap';
import AlertBanner from './AlertBanner';
import AdherenceTrend from './AdherenceTrend';
import ResponseTiming from './ResponseTiming';

export default function Dashboard() {
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

  return (
    <div className="dashboard-content">
      {error && <p className="error">{error}</p>}

      {recipients.length === 0 ? (
        <p>
          No care recipients yet. <Link to="/onboard">Add one</Link> to get started.
        </p>
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

            {selectedId && (
              <Link className="link-button" to={`/recipients/${selectedId}/plan`}>
                View exercise plan
              </Link>
            )}
          </div>

          {stats && (
            <>
              <AlertBanner alerts={stats.alerts} />

              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-value">{stats.currentStreak}</span>
                  <span className="stat-label">Day streak</span>
                </div>

                <AdherenceTrend trend={stats.adherenceTrend} />
                <ResponseTiming timing={stats.responseTiming} />

                <div className="card wide">
                  <h2>Calendar</h2>
                  <CalendarHeatmap calendar={stats.calendar} />
                </div>

                <div className="card wide">
                  <h2>Most-skipped exercises</h2>
                  {stats.mostSkipped.length === 0 ? (
                    <p className="muted">No skips worth flagging in this range.</p>
                  ) : (
                    <ul className="skip-list">
                      {stats.mostSkipped.map((ex) => (
                        <li key={ex.exerciseId} title={ex.framing}>
                          <span>{ex.name}</span>
                          <span className="skip-count">{ex.skipCount}x</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
