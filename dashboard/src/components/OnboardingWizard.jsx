import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mapMedicalConditions, createRecipient, generatePlan } from '../api';

const ACTIVITY_LEVELS = [
  { value: 'not_active', label: 'Not active' },
  { value: 'somewhat_active', label: 'Somewhat active' },
  { value: 'very_active', label: 'Very active' },
];

const STEPS = ['basic_info', 'health_profile', 'tag_confirmation', 'consent', 'generating'];

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: '',
    phoneNumber: '',
    age: '',
    heightCm: '',
    weightKg: '',
    activityLevel: 'somewhat_active',
    medicalConditionsText: '',
    preferredTime: '19:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    consentGiven: false,
  });
  const [mappedTags, setMappedTags] = useState([]);

  const step = STEPS[stepIndex];

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function goNext() {
    setError(null);
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function goBack() {
    setError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function handleMapConditions() {
    if (!form.medicalConditionsText.trim()) {
      setMappedTags([]);
      goNext();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { tags } = await mapMedicalConditions(form.medicalConditionsText);
      setMappedTags(tags);
      goNext();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleTag(tag) {
    setMappedTags((tags) =>
      tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
    );
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setStepIndex(STEPS.indexOf('generating'));
    try {
      const recipient = await createRecipient({
        name: form.name,
        phoneNumber: form.phoneNumber,
        age: Number(form.age),
        heightCm: form.heightCm ? Number(form.heightCm) : null,
        weightKg: form.weightKg ? Number(form.weightKg) : null,
        activityLevel: form.activityLevel,
        medicalConditions: mappedTags,
        preferredTime: form.preferredTime,
        timezone: form.timezone,
        consentGiven: form.consentGiven,
      });
      await generatePlan(recipient.id);
      navigate(`/recipients/${recipient.id}/plan`, { replace: true });
    } catch (err) {
      setError(err.message);
      setStepIndex(STEPS.indexOf('consent'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wizard">
      <h2>Add a new recipient</h2>
      {error && <p className="error">{error}</p>}

      {step === 'basic_info' && (
        <div className="wizard-step">
          <label>
            Name
            <input value={form.name} onChange={(e) => updateField('name', e.target.value)} />
          </label>
          <label>
            WhatsApp number (E.164 format)
            <input
              placeholder="+15551234567"
              value={form.phoneNumber}
              onChange={(e) => updateField('phoneNumber', e.target.value)}
            />
            <span className="field-hint">Include the country code, e.g. +1 555 123 4567 → +15551234567</span>
          </label>
          <label>
            Age
            <input
              type="number"
              min="1"
              value={form.age}
              onChange={(e) => updateField('age', e.target.value)}
            />
          </label>
          <div className="wizard-actions">
            <button
              disabled={!form.name || !form.phoneNumber || !form.age}
              onClick={goNext}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'health_profile' && (
        <div className="wizard-step">
          <label>
            Height (cm)
            <input
              type="number"
              value={form.heightCm}
              onChange={(e) => updateField('heightCm', e.target.value)}
            />
          </label>
          <label>
            Weight (kg)
            <input
              type="number"
              value={form.weightKg}
              onChange={(e) => updateField('weightKg', e.target.value)}
            />
          </label>
          <label>
            Current activity level
            <select
              value={form.activityLevel}
              onChange={(e) => updateField('activityLevel', e.target.value)}
            >
              {ACTIVITY_LEVELS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Medical conditions (plain English - e.g. "knee pain, gets dizzy sometimes")
            <textarea
              rows={3}
              value={form.medicalConditionsText}
              onChange={(e) => updateField('medicalConditionsText', e.target.value)}
            />
          </label>
          <div className="wizard-actions">
            <button className="secondary" onClick={goBack}>Back</button>
            <button disabled={busy} onClick={handleMapConditions}>
              {busy ? 'Checking...' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {step === 'tag_confirmation' && (
        <div className="wizard-step">
          <p>
            Based on what you described, these safety tags will apply. Review and edit before
            continuing - this affects which exercises are considered safe.
          </p>
          {mappedTags.length === 0 ? (
            <p className="muted">No safety tags identified - the exercise selection won't be restricted.</p>
          ) : (
            <ul className="tag-list">
              {mappedTags.map((tag) => (
                <li key={tag} className="tag-chip">
                  {tag.replace(/_/g, ' ')}
                  <button type="button" onClick={() => toggleTag(tag)} aria-label={`Remove ${tag}`}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="wizard-actions">
            <button className="secondary" onClick={goBack}>Back</button>
            <button onClick={goNext}>Confirm and continue</button>
          </div>
        </div>
      )}

      {step === 'consent' && (
        <div className="wizard-step">
          <label>
            Preferred workout time
            <input
              type="time"
              value={form.preferredTime}
              onChange={(e) => updateField('preferredTime', e.target.value)}
            />
          </label>
          <label>
            Timezone
            <input
              value={form.timezone}
              onChange={(e) => updateField('timezone', e.target.value)}
            />
          </label>
          <label className="consent-check">
            <input
              type="checkbox"
              checked={form.consentGiven}
              onChange={(e) => updateField('consentGiven', e.target.checked)}
            />
            I have explained this system to {form.name || 'them'} and they've agreed to receive
            these messages.
          </label>
          <div className="wizard-actions">
            <button className="secondary" onClick={goBack}>Back</button>
            <button disabled={!form.consentGiven || busy} onClick={handleGenerate}>
              Generate exercise plan
            </button>
          </div>
        </div>
      )}

      {step === 'generating' && (
        <div className="wizard-step">
          <p>Generating a personalized 4-week exercise plan - this can take a minute or two...</p>
        </div>
      )}
    </div>
  );
}
