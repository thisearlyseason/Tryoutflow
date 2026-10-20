'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useEffect, useId, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import { Input } from '@/components/ui/input';
import type {
  RegistrationFormSchema,
  RegistrationBuiltInField,
  RegistrationBuiltInKey,
} from '@/modules/registration/domain/form-schema';
import {
  DEFAULT_BUILT_IN_FIELDS,
  getBuiltInFields,
  isRequiredBuiltIn,
} from '@/modules/registration/domain/built-in-fields';
import { PARTICIPATION_WAIVER_STARTER } from '@/modules/registration/domain/waiver-starter';
import { RegistrationWaiver } from '@/modules/registration/ui/registration-waiver';

type Field = RegistrationFormSchema['fields'][number];
export type EditableRegistrationForm = {
  name: string;
  fields: Field[];
  builtInFields?: RegistrationBuiltInField[];
  notificationEmail?: string;
};
type Question =
  { type: 'builtIn'; field: RegistrationBuiltInField } | { type: 'custom'; field: Field };

const identityKeys = new Set([
  'custom_birth_date',
  'custom_guardian_name',
  'custom_guardian_email',
  'custom_guardian_phone',
]);
const defaultFields: Field[] = [
  {
    key: 'custom_waiver',
    label: 'Waiver and consent',
    kind: 'consent',
    waiverText: PARTICIPATION_WAIVER_STARTER,
    required: true,
    sortOrder: 0,
  },
];

const builtInTypes: Record<RegistrationBuiltInKey, string> = {
  givenName: 'Short text',
  familyName: 'Short text',
  birthDate: 'Date',
  guardianName: 'Short text',
  guardianEmail: 'Email',
  guardianPhone: 'Phone',
  divisionId: 'Division selection',
  positionId: 'Position selection',
};

function QuestionRow({
  question,
  index,
  total,
  selected,
  select,
  move,
}: {
  question: Question;
  index: number;
  total: number;
  selected: boolean;
  select: () => void;
  move: (offset: number) => void;
}) {
  const { field } = question;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.key });
  return (
    <li
      ref={setNodeRef}
      className={`flex h-20 min-w-0 items-center gap-1 rounded-xl border bg-[var(--color-surface)] px-2 ${selected ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]' : 'border-[var(--color-border)]'}`}
      style={{
        transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <FeedbackButton
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag ${field.label}`}
        className="min-h-11 min-w-11 cursor-grab rounded text-xl focus-visible:outline-2"
        style={{ touchAction: 'none' }}
      >
        ⠿
      </FeedbackButton>
      <FeedbackButton
        type="button"
        aria-label={`Edit ${field.label}`}
        aria-pressed={selected}
        onClick={select}
        className="min-h-11 min-w-0 flex-1 rounded px-1 text-left focus-visible:outline-2"
      >
        <span className="line-clamp-2 break-words font-bold leading-tight">
          {index + 1}. {field.label || 'New question'}
        </span>
        <span className="block truncate text-xs text-[var(--color-text-muted)]">
          {field.enabled === false ? 'Hidden' : field.required ? 'Required' : 'Optional'}
          {question.type === 'builtIn' ? ' · Built-in' : ''}
        </span>
      </FeedbackButton>
      <FeedbackButton
        type="button"
        className="min-h-11 min-w-11 rounded disabled:opacity-40 focus-visible:outline-2"
        aria-label={`Move ${field.label} up`}
        disabled={index === 0}
        onClick={() => move(-1)}
      >
        ↑
      </FeedbackButton>
      <FeedbackButton
        type="button"
        className="min-h-11 min-w-11 rounded disabled:opacity-40 focus-visible:outline-2"
        aria-label={`Move ${field.label} down`}
        disabled={index === total - 1}
        onClick={() => move(1)}
      >
        ↓
      </FeedbackButton>
    </li>
  );
}

function CustomFieldDetails({
  field,
  update,
}: {
  field: Field;
  update: (patch: Partial<Field>) => void;
}) {
  return (
    <>
      <label>
        Field type
        <select
          aria-label="Field type"
          value={field.kind}
          onChange={(e) =>
            update({
              kind: e.target.value as Field['kind'],
              waiverText: e.target.value === 'consent' ? field.waiverText : undefined,
              options: e.target.value === 'select' ? [''] : undefined,
            })
          }
          className="min-h-11 w-full rounded border p-2"
        >
          <option value="text">Short text</option>
          <option value="textarea">Long text</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="date">Date</option>
          <option value="select">Dropdown</option>
          <option value="checkbox">Checkbox</option>
          <option value="consent">Waiver / consent</option>
        </select>
      </label>
      {field.kind === 'consent' ? (
        <div className="grid gap-3">
          <label>
            Waiver wording
            <textarea
              aria-label="Waiver wording"
              value={field.waiverText ?? ''}
              onChange={(event) => update({ waiverText: event.target.value || undefined })}
              maxLength={20000}
              rows={10}
              className="w-full rounded border p-3"
            />
          </label>
          <p className="text-sm text-[var(--color-text-muted)]">
            Write the full wording registrants will read before accepting. The participation
            acknowledgement starter is editable; customize it for your tryout before saving.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={Boolean(field.waiverText?.trim())}
            onClick={() => update({ waiverText: PARTICIPATION_WAIVER_STARTER })}
          >
            Use participation starter
          </Button>
          {field.waiverText?.trim() ? (
            <div className="grid gap-2">
              <p className="font-bold">Registrant preview</p>
              <RegistrationWaiver field={field} preview />
            </div>
          ) : (
            <p className="text-sm">
              No waiver wording has been added. Only the consent label will appear until you add
              wording.
            </p>
          )}
        </div>
      ) : null}
      {field.kind === 'select' ? (
        <label>
          Options (one per line)
          <textarea
            aria-label="Options (one per line)"
            value={field.options?.join('\n') ?? ''}
            onChange={(e) => update({ options: e.target.value.split('\n') })}
            required
            className="min-h-24 w-full rounded border p-2"
          />
        </label>
      ) : null}
      <label>
        Help text (optional)
        <Input
          aria-label="Help text (optional)"
          value={field.helpText ?? ''}
          onChange={(e) => update({ helpText: e.target.value })}
          maxLength={500}
        />
      </label>
    </>
  );
}

export function RegistrationFormEditor({ initial }: { initial?: EditableRegistrationForm }) {
  const dragContextId = useId();
  const notificationHelpId = useId();
  const [formName, setFormName] = useState(initial?.name ?? '');
  const [notificationEmail, setNotificationEmail] = useState(initial?.notificationEmail ?? '');
  const [questions, setQuestions] = useState<Question[]>(() => {
    const builtIns: Question[] = getBuiltInFields(initial ?? {}).map((field) => ({
      type: 'builtIn',
      field: { ...field },
    }));
    const custom: Question[] = (initial?.fields ?? defaultFields)
      .filter((field) => !identityKeys.has(field.key))
      .map((field) => ({ type: 'custom', field: { ...field } }));
    // Older forms ordered only additional questions; their built-ins always came first.
    return initial?.builtInFields
      ? [...builtIns, ...custom].sort((a, b) => a.field.sortOrder - b.field.sortOrder)
      : [...builtIns, ...custom.sort((a, b) => a.field.sortOrder - b.field.sortOrder)];
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const settingsRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (
      selectedKey &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1279px)').matches
    ) {
      settingsRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    }
  }, [selectedKey]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [restoreKey, setRestoreKey] = useState('');
  const selected = questions.find((question) => question.field.key === selectedKey);
  const active = questions.find((question) => question.field.key === activeKey);
  const missingBuiltIns = DEFAULT_BUILT_IN_FIELDS.filter(
    (field) => !questions.some((question) => question.field.key === field.key),
  );
  const customCount = questions.filter((question) => question.type === 'custom').length;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const schema = {
    fields: questions.flatMap((question, index) =>
      question.type === 'custom'
        ? [
            {
              ...question.field,
              sortOrder: index,
              ...(question.field.kind === 'select'
                ? {
                    options: question.field.options?.map((option) => option.trim()).filter(Boolean),
                  }
                : {}),
            },
          ]
        : [],
    ),
    builtInFields: questions.flatMap((question, index) =>
      question.type === 'builtIn' ? [{ ...question.field, sortOrder: index }] : [],
    ),
  };
  const updateSelected = (patch: Partial<Field> | Partial<RegistrationBuiltInField>) => {
    setQuestions((current) =>
      current.map((question) => {
        if (question.field.key !== selectedKey) return question;
        return question.type === 'custom'
          ? { ...question, field: { ...question.field, ...patch } as Field }
          : { ...question, field: { ...question.field, ...patch } as RegistrationBuiltInField };
      }),
    );
  };
  const addCustom = (waiver: boolean) => {
    if (customCount >= 100) return;
    const field: Field = {
      key: `${waiver ? 'waiver' : 'question'}_${crypto.randomUUID().replaceAll('-', '')}`,
      label: waiver ? 'Participation waiver' : 'New question',
      kind: waiver ? 'consent' : 'text',
      required: waiver,
      enabled: true,
      ...(waiver ? { waiverText: PARTICIPATION_WAIVER_STARTER } : {}),
      sortOrder: questions.length,
    };
    setQuestions((current) => [...current, { type: 'custom', field }]);
    setSelectedKey(field.key);
  };
  const waiverQuestion = selected?.type === 'custom' && selected.field.kind === 'consent';
  const protectedQuestion = selected?.type === 'builtIn' && isRequiredBuiltIn(selected.field.key);
  return (
    <div className="grid min-w-0 gap-5">
      <p className="text-sm text-[var(--color-text-muted)]">
        Choose a question to edit its wording, visibility, and requirement. Drag the grip or use the
        arrows to change the order.
      </p>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <label className="grid min-w-0 gap-1">
          Form name
          <Input
            name="name"
            value={formName}
            onChange={(event) => setFormName(event.target.value)}
            placeholder={FIELD_EXAMPLES.registrationForm}
            required
            maxLength={160}
          />
        </label>
        <label className="grid min-w-0 gap-1">
          Registration notification email (optional)
          <Input
            name="notificationEmail"
            type="email"
            value={notificationEmail}
            onChange={(event) => setNotificationEmail(event.target.value)}
            maxLength={254}
            aria-describedby={notificationHelpId}
          />
          <span id={notificationHelpId} className="block text-sm text-[var(--color-text-muted)]">
            Receive a notice when someone registers. Detailed answers stay in your authorized
            workspace. Leave blank to disable.
          </span>
        </label>
      </div>
      <input type="hidden" name="formSchema" value={JSON.stringify(schema)} />
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid min-w-0 gap-3">
          <h3 className="font-bold">Registration questions</h3>
          <DndContext
            id={dragContextId}
            sensors={sensors}
            collisionDetection={closestCenter}
            autoScroll={false}
            onDragStart={({ active }) => setActiveKey(String(active.id))}
            onDragCancel={() => setActiveKey(null)}
            onDragEnd={({ active, over }) => {
              setActiveKey(null);
              if (over && active.id !== over.id)
                setQuestions((current) => {
                  const from = current.findIndex((question) => question.field.key === active.id);
                  const to = current.findIndex((question) => question.field.key === over.id);
                  return from < 0 || to < 0 ? current : arrayMove(current, from, to);
                });
            }}
          >
            <SortableContext
              items={questions.map((question) => question.field.key)}
              strategy={verticalListSortingStrategy}
            >
              <ol aria-label="Registration questions" className="grid min-w-0 gap-2">
                {questions.map((question, index) => (
                  <QuestionRow
                    key={question.field.key}
                    question={question}
                    index={index}
                    total={questions.length}
                    selected={selectedKey === question.field.key}
                    select={() => setSelectedKey(question.field.key)}
                    move={(offset) =>
                      setQuestions((current) => arrayMove(current, index, index + offset))
                    }
                  />
                ))}
              </ol>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {active ? (
                <div className="flex h-20 items-center rounded-xl border border-[var(--color-primary)] bg-[var(--color-surface)] px-4 font-bold shadow-lg">
                  ⠿ <span className="ml-3 truncate">{active.field.label}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={customCount >= 100}
              onClick={() => addCustom(false)}
            >
              Add field
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={customCount >= 100}
              onClick={() => addCustom(true)}
            >
              Add waiver
            </Button>
          </div>
          {customCount >= 100 ? (
            <p className="text-sm">This form has reached the limit of 100 additional questions.</p>
          ) : null}
          {missingBuiltIns.length > 0 ? (
            <div className="grid gap-2">
              <label>
                Add built-in question
                <select
                  aria-label="Add built-in question"
                  value={restoreKey}
                  onChange={(event) => setRestoreKey(event.target.value)}
                  className="min-h-11 w-full rounded border p-2"
                >
                  <option value="">Choose a question</option>
                  {missingBuiltIns.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={!restoreKey}
                onClick={() => {
                  const field = missingBuiltIns.find((item) => item.key === restoreKey);
                  if (!field) return;
                  setQuestions((current) => [
                    ...current,
                    {
                      type: 'builtIn',
                      field: { ...field, enabled: true, sortOrder: current.length },
                    },
                  ]);
                  setSelectedKey(field.key);
                  setRestoreKey('');
                }}
              >
                Add built-in
              </Button>
            </div>
          ) : null}
        </div>
        {selected ? (
          <fieldset
            ref={settingsRef}
            className="grid min-w-0 scroll-mt-4 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 xl:sticky xl:top-4"
          >
            <legend className="px-1 font-bold">Edit question</legend>
            <label>
              Field label
              <Input
                aria-label="Field label"
                value={selected.field.label}
                onChange={(event) => updateSelected({ label: event.target.value })}
                maxLength={120}
                required
              />
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                aria-label={`Show ${selected.field.label}`}
                type="checkbox"
                checked={selected.field.enabled !== false}
                disabled={protectedQuestion}
                onChange={(event) => updateSelected({ enabled: event.target.checked })}
              />
              Show on registration form
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                aria-label={`Require ${selected.field.label}`}
                type="checkbox"
                checked={waiverQuestion || selected.field.required}
                disabled={protectedQuestion || waiverQuestion || selected.field.enabled === false}
                onChange={(event) => updateSelected({ required: event.target.checked })}
              />
              Required
            </label>
            {waiverQuestion ? (
              <p className="text-sm">
                Registrants must accept this waiver whenever it is shown on the form.
              </p>
            ) : null}
            {protectedQuestion ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Athlete name and guardian email are needed to identify the registration and send
                confirmation, so these questions must stay visible and required.
              </p>
            ) : null}
            {selected.field.enabled === false ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                This question is hidden from registrants. Its wording is saved so you can show it
                again later.
              </p>
            ) : null}
            {selected.type === 'builtIn' ? (
              <>
                <p className="text-sm">Question type: {builtInTypes[selected.field.key]}</p>
                {selected.field.key === 'divisionId' ? (
                  <p className="text-sm text-[var(--color-text-muted)]">
                    If this question is hidden or removed, registrants are assigned to the first
                    division in your tryout setup.
                  </p>
                ) : null}
                {selected.field.key === 'positionId' ? (
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Choices come from the positions in your tryout setup.
                  </p>
                ) : null}
              </>
            ) : (
              <CustomFieldDetails field={selected.field} update={updateSelected} />
            )}
            <Button
              type="button"
              variant="secondary"
              aria-label={`Remove ${selected.field.label}`}
              disabled={protectedQuestion}
              onClick={() => {
                setQuestions((current) =>
                  current.filter((question) => question.field.key !== selected.field.key),
                );
                setSelectedKey(null);
              }}
            >
              Remove question
            </Button>
          </fieldset>
        ) : (
          <p className="rounded-xl border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
            Select a question from the list to edit it.
          </p>
        )}
      </div>
    </div>
  );
}
