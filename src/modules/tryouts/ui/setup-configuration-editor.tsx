'use client';

import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import { Button } from '@/components/ui/button';
import type { SetupConfiguration, SetupCategory } from '../domain/setup-configuration';
import { toDateTimeLocalValue } from './tryout-basics';

type Named = { id: string; name: string };

export function DivisionEditor({
  divisions,
  addNew = false,
  selectedId,
}: {
  divisions: SetupConfiguration['divisions'];
  addNew?: boolean;
  selectedId?: string;
}) {
  const [id, setId] = useState(addNew ? '' : (selectedId ?? divisions[0]?.id ?? ''));
  const selected = divisions.find((row) => row.id === id);
  return (
    <div className="space-y-4">
      <label className="block">
        Division to edit
        <select className="w-full" value={id} onChange={(event) => setId(event.target.value)}>
          <option value="">Add a new division</option>
          {divisions.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      <div key={id} className="space-y-4">
        <input type="hidden" name="divisionId" value={id} />
        <label className="block">
          Division name
          <PersistentInput
            name="name"
            defaultValue={selected?.name ?? ''}
            placeholder={FIELD_EXAMPLES.division}
            required
            maxLength={160}
          />
        </label>
        <label className="block">
          Description (optional)
          <PersistentInput name="description" defaultValue={selected?.description ?? ''} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label>
            Minimum age (optional)
            <PersistentInput
              type="number"
              min={0}
              max={120}
              name="minAge"
              defaultValue={selected?.min_age ?? ''}
            />
          </label>
          <label>
            Maximum age (optional)
            <PersistentInput
              type="number"
              min={0}
              max={120}
              name="maxAge"
              defaultValue={selected?.max_age ?? ''}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

export function SessionEditor({
  sessions,
  divisions,
  positions,
  timezone,
  selectedId,
}: {
  sessions: SetupConfiguration['sessions'];
  divisions: Named[];
  positions: Named[];
  timezone: string;
  selectedId?: string;
}) {
  const [id, setId] = useState(selectedId ?? sessions[0]?.id ?? '');
  const selected = sessions.find((row) => row.id === id);
  return (
    <div className="space-y-4">
      <label className="block">
        Session to edit
        <select className="w-full" value={id} onChange={(event) => setId(event.target.value)}>
          <option value="">Add a new session</option>
          {sessions.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      <div key={id} className="space-y-4">
        <input type="hidden" name="sessionId" value={id} />
        <label className="block">
          Division
          <select
            className="w-full"
            name={id ? undefined : 'divisionId'}
            defaultValue={selected?.division_id ?? divisions[0]?.id ?? ''}
            disabled={Boolean(id)}
            required
          >
            <option value="" disabled>
              Select a division
            </option>
            {divisions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        {id ? (
          <>
            <input type="hidden" name="divisionId" value={selected?.division_id ?? ''} />
            <p className="text-sm text-[var(--color-text-muted)]">
              The division keeps this session connected to its athletes and scores. Create a new
              session to use a different division.
            </p>
          </>
        ) : null}
        <label className="block">
          Session name
          <PersistentInput
            name="name"
            defaultValue={selected?.name ?? ''}
            placeholder={FIELD_EXAMPLES.session}
            maxLength={160}
            required
          />
        </label>
        <p id="tryout-session-timezone-help" className="text-sm text-[var(--color-text-muted)]">
          Session times use {timezone}.
        </p>
        <label className="block">
          Starts
          <PersistentInput
            aria-describedby="tryout-session-timezone-help"
            name="startsAt"
            type="datetime-local"
            defaultValue={toDateTimeLocalValue(selected?.starts_at ?? null, timezone)}
            required
          />
        </label>
        <label className="block">
          Ends
          <PersistentInput
            aria-describedby="tryout-session-timezone-help"
            name="endsAt"
            type="datetime-local"
            defaultValue={toDateTimeLocalValue(selected?.ends_at ?? null, timezone)}
            required
          />
        </label>
        <label className="block">
          Location (optional)
          <PersistentInput name="location" defaultValue={selected?.location ?? ''} />
        </label>
        <label className="block">
          Capacity (optional)
          <PersistentInput
            name="capacity"
            type="number"
            min={1}
            defaultValue={selected?.capacity ?? ''}
          />
        </label>
        <NamedEditor
          key={`groups-${id}`}
          label="Group"
          rows={selected?.groups ?? []}
          prefix="group"
        />
        <NamedEditor key={`positions-${id}`} label="Position" rows={positions} prefix="position" />
      </div>
    </div>
  );
}

function NamedEditor({ label, rows, prefix }: { label: string; rows: Named[]; prefix: string }) {
  const [id, setId] = useState(rows[0]?.id ?? '');
  return (
    <div className="space-y-2">
      {rows.length ? (
        <label className="block">
          {label} to edit
          <select className="w-full" value={id} onChange={(event) => setId(event.target.value)}>
            <option value="">Add a new {label.toLowerCase()}</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <input type="hidden" name={`${prefix}Id`} value={id} />
      <label className="block">
        {label} (optional)
        <PersistentInput
          key={id}
          name={`${prefix}Name`}
          placeholder={prefix === 'group' ? FIELD_EXAMPLES.group : FIELD_EXAMPLES.position}
          defaultValue={rows.find((row) => row.id === id)?.name ?? ''}
        />
      </label>
    </div>
  );
}

export function RubricEditor({
  sessions,
  selectedId,
}: {
  sessions: SetupConfiguration['sessions'];
  selectedId?: string;
}) {
  const [id, setId] = useState(selectedId ?? sessions[0]?.id ?? '');
  const selected = sessions.find((row) => row.id === id);
  return (
    <div className="space-y-4">
      <label className="block">
        Session
        <select
          className="w-full"
          name="sessionId"
          value={id}
          onChange={(event) => setId(event.target.value)}
          required
        >
          <option value="" disabled>
            Select a session
          </option>
          {sessions.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      <RubricFields key={id} initial={selected?.rubric ?? null} />
    </div>
  );
}

function RubricFields({ initial }: { initial: SetupConfiguration['sessions'][number]['rubric'] }) {
  const [categories, setCategories] = useState<SetupCategory[]>(
    initial?.categories ?? [{ name: '', weight: 100, scaleMin: 1, scaleMax: 5 }],
  );
  const total = categories.reduce((sum, row) => sum + row.weight, 0);
  const update = (index: number, patch: Partial<SetupCategory>) =>
    setCategories((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-4">
      <label className="block">
        Rubric name
        <PersistentInput
          name="name"
          defaultValue={initial?.name ?? ''}
          placeholder={FIELD_EXAMPLES.rubric}
          maxLength={160}
          required
        />
      </label>
      <p className="text-sm text-[var(--color-text-muted)]">
        Changes apply to new evaluations. Existing evaluations keep the criteria and scoring scale
        they started with.
      </p>
      <input type="hidden" name="categories" value={JSON.stringify(categories)} />
      {categories.map((row, index) => (
        <fieldset
          key={index}
          className="space-y-3 rounded-lg border border-[var(--color-border)] p-4"
        >
          <legend>Category {index + 1}</legend>
          <label className="block">
            Category {index + 1} name
            <PersistentInput
              value={row.name}
              placeholder={FIELD_EXAMPLES.rubric.split(' and ')[0]}
              onChange={(event) => update(index, { name: event.target.value })}
              required
              maxLength={160}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              Category {index + 1} weight
              <PersistentInput
                type="number"
                min={1}
                max={100}
                step="any"
                value={row.weight}
                onChange={(event) => update(index, { weight: Number(event.target.value) })}
                required
              />
            </label>
            <label>
              Category {index + 1} scale
              <select
                className="w-full"
                value={row.scaleMax}
                onChange={(event) =>
                  update(index, { scaleMax: Number(event.target.value) as 5 | 10 })
                }
              >
                <option value={5}>1–5</option>
                <option value={10}>1–10</option>
              </select>
            </label>
          </div>
          <label className="block">
            Category {index + 1} description (optional)
            <PersistentInput
              value={row.description ?? ''}
              onChange={(event) => update(index, { description: event.target.value })}
            />
          </label>
          <label className="block">
            Category {index + 1} guidance (optional)
            <PersistentInput
              value={row.guidance ?? ''}
              onChange={(event) => update(index, { guidance: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={row.isPriority ?? false}
              onChange={(event) => update(index, { isPriority: event.target.checked })}
            />
            Priority category {index + 1}
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={categories.length === 1}
            onClick={() => setCategories((rows) => rows.filter((_, i) => i !== index))}
          >
            Remove category {index + 1}
          </Button>
        </fieldset>
      ))}
      <p role="status">Total weight: {total} / 100</p>
      {total !== 100 ? (
        <p className="text-sm text-[var(--color-destructive)]">
          Category weights must total 100 before saving.
        </p>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          setCategories((rows) => [...rows, { name: '', weight: 0, scaleMin: 1, scaleMax: 5 }])
        }
      >
        Add category
      </Button>
    </div>
  );
}

// React form actions reset uncontrolled fields even when the action returns an error.
// Keep edits until a successful redirect reloads the saved configuration.
function PersistentInput({
  defaultValue,
  value,
  onChange,
  ...props
}: ComponentProps<typeof Input>) {
  const [edited, setEdited] = useState(defaultValue ?? '');
  return (
    <Input
      {...props}
      value={value ?? edited}
      onChange={(event) => {
        setEdited(event.target.value);
        onChange?.(event);
      }}
    />
  );
}
