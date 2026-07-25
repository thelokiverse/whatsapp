import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getRotation, getFilteredCatalog, swapExercise, approvePlan, sendTestMessage, generatePlan,
} from '../api';
import ExerciseCard from './ExerciseCard';

export default function PlanReview() {
  const { id: recipientId } = useParams();
  const [data, setData] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [swapTarget, setSwapTarget] = useState(null); // { dayOffset, exerciseIndex }

  function load() {
    setError(null);
    Promise.all([getRotation(recipientId), getFilteredCatalog(recipientId)])
      .then(([rotationData, catalogRows]) => {
        setData(rotationData);
        setCatalog(catalogRows);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, [recipientId]);

  async function handleSwap(dayOffset, exerciseIndex, newExerciseId) {
    setBusy(true);
    setError(null);
    try {
      await swapExercise(data.rotation.id, dayOffset, exerciseIndex, newExerciseId);
      setSwapTarget(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      await approvePlan(data.rotation.id);
      setMessage('Plan approved - it will start sending on schedule.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendTest() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await sendTestMessage(recipientId);
      setMessage('Test message sent - check WhatsApp for delivery.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await generatePlan(recipientId);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading plan...</p>;

  const { rotation, exercisesById } = data;

  return (
    <div className="plan-review">
      <div className="plan-review-header">
        <h2>Exercise plan</h2>
        <span className={`status-pill status-pill-${rotation.status}`}>{rotation.status}</span>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="success-message">{message}</p>}

      <div className="plan-actions">
        <button disabled={busy} onClick={handleSendTest}>Send test message</button>
        <button disabled={busy} className="secondary" onClick={handleRegenerate}>Regenerate plan</button>
        {rotation.status !== 'active' && (
          <button disabled={busy} onClick={handleApprove}>Approve plan</button>
        )}
      </div>

      <div className="plan-days">
        {rotation.daily_sequences.map((day) => (
          <div key={day.day_offset} className="plan-day">
            <h3>Day {day.day_offset + 1}</h3>
            <div className="plan-day-exercises">
              {day.exercise_ids.map((exerciseId, exerciseIndex) => {
                const exercise = exercisesById[exerciseId];
                const isSwapping =
                  swapTarget?.dayOffset === day.day_offset &&
                  swapTarget?.exerciseIndex === exerciseIndex;
                return (
                  <div key={`${day.day_offset}-${exerciseIndex}`}>
                    <ExerciseCard
                      exercise={exercise}
                      onSwap={() => setSwapTarget(isSwapping ? null : { dayOffset: day.day_offset, exerciseIndex })}
                    />
                    {isSwapping && (
                      <select
                        defaultValue=""
                        onChange={(e) => e.target.value && handleSwap(day.day_offset, exerciseIndex, e.target.value)}
                      >
                        <option value="" disabled>Choose a replacement...</option>
                        {catalog
                          .filter((c) => c.session_role === exercise?.session_role)
                          .map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
