const PATTERN_LABEL = {
  on_time: 'Usually responds right on time',
  delayed: 'Usually responds a bit after the prompt',
  prompt_needed: 'Often needs the follow-up nudge',
  no_data: 'Not enough data yet',
};

export default function ResponseTiming({ timing }) {
  if (!timing) return null;

  return (
    <div className="card">
      <h2>Response timing</h2>
      {timing.pattern === 'no_data' ? (
        <p className="muted">{PATTERN_LABEL.no_data}</p>
      ) : (
        <>
          <p className="response-timing-value">{timing.avgMinutes} min</p>
          <p className="muted">{PATTERN_LABEL[timing.pattern]}</p>
        </>
      )}
    </div>
  );
}
