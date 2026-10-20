'use client';

import { FeedbackButton } from '@/components/ui/button';

import { Fragment, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, LoaderCircle, Plus, Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { saveTalent } from '../application/actions';
import type { TalentTable } from '../domain/schemas';
export type Field = {
  name: string;
  section?: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'checkbox' | 'date' | 'datetime-local' | 'url' | 'select';
  required?: boolean;
  options?: readonly { value: string; label: string }[];
  help?: string;
  step?: string;
};
const recordNames: Record<TalentTable, string> = {
  event_notices: 'notice',
  event_fees: 'ledger entry',
  athlete_corrections: 'response',
  participant_links: 'access',
  athlete_sport_profiles: 'profile',
  evaluator_sport_profiles: 'profile',
  performance_metrics: 'metric',
  performance_results: 'measurement',
  scouting_records: 'report',
  tryout_stations: 'station',
  roster_scenarios: 'scenario',
  roster_scenario_members: 'selection',
};
function recordName(table: TalentTable, kind?: unknown) {
  if (table === 'scouting_records')
    return (
      (
        {
          task: 'follow-up',
          goal: 'goal',
          video: 'video reference',
          watchlist: 'watchlist entry',
          report: 'report',
        } as Record<string, string>
      )[String(kind ?? 'report')] ?? 'report'
    );
  return recordNames[table];
}
export function RecordForm({
  slug,
  table,
  fields,
  initial = {},
  id,
  version = 0,
  title = 'Add record',
  defaults = {},
  onDirtyChange,
  onBusyChange,
  hideTitle = false,
}: {
  slug: string;
  table: TalentTable;
  fields: readonly Field[];
  initial?: Record<string, unknown>;
  id?: string;
  version?: number;
  title?: string;
  defaults?: Record<string, unknown>;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  hideTitle?: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const [recordId, setRecordId] = useState(() => id ?? crypto.randomUUID());
  const [values, setValues] = useState<Record<string, unknown>>({ ...defaults, ...initial });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || saved) return;
    submitting.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setErrors({});
    setMessage('Saving…');
    try {
      const result = await saveTalent(slug, { table, id: recordId, version, values });
      setMessage(result.message);
      setErrors(result.errors ?? {});
      if (result.ok) {
        setSaved(true);
        onDirtyChange?.(false);
        router.refresh();
      } else {
        requestAnimationFrame(() =>
          formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        );
      }
    } catch {
      setMessage('Could not reach the server. Your entries remain here. Try again.');
    } finally {
      setBusy(false);
      submitting.current = false;
      onBusyChange?.(false);
    }
  }
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onChange={() => onDirtyChange?.(true)}
      className="talent-form"
      aria-busy={busy}
    >
      {!hideTitle && <h3>{title}</h3>}
      <p className="talent-form-hint">Fields marked * are required.</p>
      <fieldset disabled={busy || saved} className="talent-fieldset">
        <div className="talent-form-grid">
          {fields.map((f, index) => (
            <Fragment key={f.name}>
              {f.section && f.section !== fields[index - 1]?.section && (
                <div className="talent-form-section talent-wide">
                  {hideTitle ? <h3>{f.section}</h3> : <h4>{f.section}</h4>}
                </div>
              )}
              <label
                key={f.name}
                className={
                  f.type === 'checkbox'
                    ? 'talent-checkbox-field talent-wide'
                    : f.type === 'textarea'
                      ? 'talent-wide'
                      : ''
                }
              >
                <span>
                  {f.label}
                  {f.required ? ' *' : ''}
                </span>
                {f.type === 'textarea' ? (
                  <textarea
                    aria-label={f.label}
                    aria-invalid={!!errors[f.name]}
                    aria-describedby={
                      [
                        f.help && `${formId}-${f.name}-help`,
                        errors[f.name] && `${formId}-${f.name}-error`,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    required={f.required}
                    rows={3}
                    maxLength={8000}
                    value={String(values[f.name] ?? '')}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  />
                ) : f.type === 'select' ? (
                  <select
                    aria-label={f.label}
                    aria-invalid={!!errors[f.name]}
                    aria-describedby={
                      [
                        f.help && `${formId}-${f.name}-help`,
                        errors[f.name] && `${formId}-${f.name}-error`,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    value={String(values[f.name] ?? '')}
                    required={f.required}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  >
                    {!f.required && <option value="">Not specified</option>}
                    {f.required && (
                      <option value="" disabled>
                        Select…
                      </option>
                    )}
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'checkbox' ? (
                  <input
                    aria-label={f.label}
                    aria-invalid={!!errors[f.name]}
                    aria-describedby={
                      [
                        f.help && `${formId}-${f.name}-help`,
                        errors[f.name] && `${formId}-${f.name}-error`,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    type="checkbox"
                    checked={Boolean(values[f.name])}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })}
                  />
                ) : (
                  <input
                    aria-label={f.label}
                    aria-invalid={!!errors[f.name]}
                    aria-describedby={
                      [
                        f.help && `${formId}-${f.name}-help`,
                        errors[f.name] && `${formId}-${f.name}-error`,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    type={f.type ?? 'text'}
                    step={f.step ?? (f.type === 'number' ? 'any' : undefined)}
                    required={f.required}
                    value={
                      f.type === 'datetime-local'
                        ? String(values[f.name] ?? '').slice(0, 16)
                        : String(values[f.name] ?? '')
                    }
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [f.name]:
                          f.type === 'datetime-local' && e.target.value
                            ? `${e.target.value}:00Z`
                            : e.target.value,
                      })
                    }
                  />
                )}{' '}
                {f.help && <small id={`${formId}-${f.name}-help`}>{f.help}</small>}
                {errors[f.name] && (
                  <strong id={`${formId}-${f.name}-error`} className="talent-error">
                    {errors[f.name]}
                  </strong>
                )}
              </label>
            </Fragment>
          ))}
        </div>
      </fieldset>
      <div className="talent-form-footer">
        <FeedbackButton
          busy={busy}
          className="button-primary"
          disabled={busy || saved}
          type="submit"
        >
          {busy ? (
            <LoaderCircle size={16} className="talent-spin" aria-hidden="true" />
          ) : saved ? (
            <Check size={16} aria-hidden="true" />
          ) : null}
          {busy
            ? 'Saving…'
            : saved
              ? 'Saved'
              : version
                ? 'Save changes'
                : `Save ${recordName(table, values.kind)}`}
        </FeedbackButton>
        {saved && !id && (
          <FeedbackButton
            className="button-secondary"
            type="button"
            onClick={() => {
              setRecordId(crypto.randomUUID());
              setValues({ ...defaults, ...initial });
              setSaved(false);
              setMessage('');
            }}
          >
            Add another
          </FeedbackButton>
        )}
        <p
          role={Object.keys(errors).length ? 'alert' : 'status'}
          className={
            saved ? 'talent-save-success' : Object.keys(errors).length ? 'talent-error' : ''
          }
        >
          {message}
        </p>
      </div>
    </form>
  );
}
export function EditRecord({
  triggerClassName = 'button-secondary',
  ...props
}: React.ComponentProps<typeof RecordForm> & { triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  function changeOpen(next: boolean) {
    if (!next && busy) return;
    if (!next && dirty) {
      setConfirmClose(true);
      return;
    }
    setOpen(next);
    setConfirmClose(false);
  }
  const title = props.title ?? 'Edit record';
  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger className={`talent-edit-trigger talent-no-print ${triggerClassName}`}>
        {props.id ? <Pencil size={15} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
        {title}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="talent-dialog-overlay" />
        <Dialog.Content
          className="talent-dialog-content"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <header className="talent-dialog-header">
            <div>
              <p className="eyebrow">
                {props.id
                  ? 'Update details'
                  : `New ${recordName(props.table, props.defaults?.kind)}`}
              </p>
              <Dialog.Title>{title}</Dialog.Title>
            </div>
            <Dialog.Close className="talent-icon-button" disabled={busy} aria-label="Close editor">
              <X size={20} />
            </Dialog.Close>
          </header>
          {confirmClose && (
            <div className="talent-discard" role="alert">
              <p>You have unsaved changes.</p>
              <div className="talent-header-actions">
                <FeedbackButton
                  type="button"
                  className="button-primary"
                  onClick={() => setConfirmClose(false)}
                >
                  Keep editing
                </FeedbackButton>
                <FeedbackButton
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    setDirty(false);
                    setConfirmClose(false);
                    setOpen(false);
                  }}
                >
                  Discard changes
                </FeedbackButton>
              </div>
            </div>
          )}
          <div className="talent-dialog-body">
            <RecordForm
              key={`${props.id}:${props.version}`}
              {...props}
              hideTitle
              onDirtyChange={setDirty}
              onBusyChange={setBusy}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
