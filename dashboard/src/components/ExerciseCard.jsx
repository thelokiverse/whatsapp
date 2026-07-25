import { exerciseGifUrl } from '../api';

const ROLE_LABEL = { warmup: 'Warm-up', main: 'Main', cooldown: 'Cool-down' };

export default function ExerciseCard({ exercise, onSwap }) {
  if (!exercise) return null;

  return (
    <div className="exercise-card">
      {exercise.gif_url && (
        <img className="exercise-gif" src={exerciseGifUrl(exercise.id)} alt={exercise.name} />
      )}
      <div className="exercise-card-body">
        <span className={`role-badge role-${exercise.session_role}`}>
          {ROLE_LABEL[exercise.session_role] || exercise.session_role}
        </span>
        <h4>{exercise.name}</h4>
        <p>{exercise.simple_instruction}</p>
        <p className="muted">{exercise.duration_or_reps}</p>
        {!exercise.gif_url && <p className="muted">No demo video available for this one.</p>}
        {onSwap && (
          <button className="link-button" onClick={onSwap}>
            Swap
          </button>
        )}
      </div>
    </div>
  );
}
