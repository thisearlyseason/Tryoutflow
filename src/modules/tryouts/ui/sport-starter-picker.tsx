'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { sportEventStarters } from '../domain/sport-event-starters';
import type { SetupCategory } from '../domain/setup-configuration';

type Draft = { name: string; categories: SetupCategory[] };
export function SportStarterPicker({
  name,
  categories,
  onApply,
}: Draft & { onApply: (draft: Draft) => void }) {
  const [sport, setSport] = useState('Basketball');
  const [preview, setPreview] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ draft: Draft; applied: string } | null>(null);
  const [message, setMessage] = useState('');
  const starter = sportEventStarters.find((row) => row.sport === sport)!;
  const fingerprint = JSON.stringify({ name, categories });
  return (
    <section className="sport-starter" aria-label="Sport event starter">
      <h3>Start with a sport plan</h3>
      <p>
        Preview a complete plan, then copy its rubric into this draft. Nothing is saved until you
        save this step.
      </p>
      <label>
        Sport starter
        <select
          value={sport}
          onChange={(event) => {
            setSport(event.target.value);
            setPreview(null);
          }}
        >
          {sportEventStarters.map((row) => (
            <option key={row.sport}>{row.sport}</option>
          ))}
        </select>
      </label>
      <Button type="button" variant="secondary" onClick={() => setPreview(fingerprint)}>
        Preview starter
      </Button>
      {preview !== null && (
        <div className="sport-starter-preview">
          <h4>{starter.name}</h4>
          <ul>
            {starter.categories.map((row) => (
              <li key={row.name}>
                <strong>
                  {row.name} · {row.weight}%
                </strong>
                <p>{row.guidance}</p>
              </li>
            ))}
          </ul>
          <p>
            Suggested groups: {starter.groups.join(', ')}. Adapt group sizes to athlete numbers, age
            and staffing.
          </p>
          <h4>Rotation plan</h4>
          <ul>
            {starter.stations.map((row) => (
              <li key={row.name}>
                <strong>
                  {row.name} · {row.minutes} minutes
                </strong>
                <p>{row.instructions}</p>
              </li>
            ))}
          </ul>
          <h4>Separate objective measurements</h4>
          <ul>
            {starter.measurements.map((row) => (
              <li key={row.name}>
                <strong>
                  {row.name} ({row.unit})
                </strong>
                <p>{row.protocol}</p>
              </li>
            ))}
          </ul>
          <p>
            After saving the rubric: add suggested groups in Sessions, save each starter station in
            Stations, and review measurement templates in Performance. These records are not created
            by copying this rubric. Reserve warm-up, rest, transitions and accessibility
            adjustments.
          </p>
          <p>
            Copying replaces the current unsaved rubric fields. Existing evaluations retain their
            original rubric version.
          </p>
          <Button
            type="button"
            disabled={preview !== fingerprint}
            onClick={() => {
              const next = { name: starter.name, categories: structuredClone(starter.categories) };
              setUndo({
                draft: { name, categories: structuredClone(categories) },
                applied: JSON.stringify(next),
              });
              onApply(next);
              setPreview(null);
              setMessage('Starter copied to draft. Review and save, or undo.');
            }}
          >
            Copy rubric to draft
          </Button>
          {preview !== fingerprint && (
            <p role="alert">Your draft changed. Preview again before replacing it.</p>
          )}
          <Button type="button" variant="secondary" onClick={() => setPreview(null)}>
            Cancel preview
          </Button>
        </div>
      )}
      {undo && (
        <Button
          type="button"
          variant="secondary"
          disabled={undo.applied !== fingerprint}
          onClick={() => {
            onApply(undo.draft);
            setUndo(null);
            setPreview(null);
            setMessage('Previous unsaved rubric restored.');
          }}
        >
          Undo starter
        </Button>
      )}
      {undo && undo.applied !== fingerprint && (
        <p>
          You edited the copied rubric. Undo is disabled to preserve those edits; edit fields
          directly or preview another starter.
        </p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
