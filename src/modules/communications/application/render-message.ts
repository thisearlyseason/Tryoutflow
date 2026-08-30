import { z } from 'zod';

const kindSchema = z.enum(['callback', 'selected', 'waitlisted', 'released']);
export type DecisionMessageKind = z.infer<typeof kindSchema>;

const factsSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(160),
    tryoutName: z.string().trim().min(1).max(160),
    divisionName: z.string().trim().min(1).max(120),
    athletePreferredName: z.string().trim().min(1).max(120),
    decision: kindSchema,
    teamName: z.string().trim().min(1).max(120).optional(),
    actionUrl: z.string().url().max(2_000).optional(),
    rosterVersionId: z.uuid(),
    rosterVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const renderInputSchema = z
  .object({
    kind: kindSchema,
    facts: factsSchema,
    editableText: z.string().trim().min(1).max(4_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind !== value.facts.decision) {
      context.addIssue({ code: 'custom', message: 'Decision kind does not match protected facts' });
    }
    if (value.facts.actionUrl) {
      const url = new URL(value.facts.actionUrl);
      if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && url.hostname === 'localhost')
      ) {
        context.addIssue({ code: 'custom', message: 'Action link must use HTTPS' });
      }
      if (url.username || url.password) {
        context.addIssue({ code: 'custom', message: 'Action link cannot contain credentials' });
      }
    }
  });

const decisionCopy: Record<DecisionMessageKind, { subject: string; statement: string }> = {
  callback: {
    subject: 'Callback invitation',
    statement: 'The finalized decision is: Callback.',
  },
  selected: {
    subject: 'Roster selection',
    statement: 'The finalized decision is: Selected.',
  },
  waitlisted: {
    subject: 'Waitlist update',
    statement: 'The finalized decision is: Waitlisted.',
  },
  released: {
    subject: 'Tryout decision',
    statement: 'The finalized decision is: Released.',
  },
};

function safeDisplay(value: string): string {
  return value
    .replace(/[\r\n\u2028\u2029]+/gu, ' ')
    .replace(/bcc\s*:/giu, '')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function paragraphs(value: string): string {
  return value
    .split(/\n{2,}/u)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

export type RenderedMessage = Readonly<{ subject: string; text: string; html: string }>;

/** Renders a fixed protected-facts envelope around one bounded organization-authored region. */
export function renderMessage(input: unknown): RenderedMessage {
  const parsed = renderInputSchema.parse(input);
  const facts = parsed.facts;
  const template = decisionCopy[parsed.kind];
  const athlete = safeDisplay(facts.athletePreferredName);
  const tryout = safeDisplay(facts.tryoutName);
  const division = safeDisplay(facts.divisionName);
  const organization = safeDisplay(facts.organizationName);
  const team = facts.teamName ? safeDisplay(facts.teamName) : undefined;
  const subject = `${template.subject}: ${tryout}`.replace(/[\r\n\u2028\u2029]+/gu, ' ');
  const protectedLines = [
    organization,
    tryout,
    `Division: ${division}`,
    `Athlete: ${athlete}`,
    template.statement,
    ...(team ? [`Team: ${team}`] : []),
  ];
  const text = [
    protectedLines.join('\n'),
    parsed.editableText,
    ...(facts.actionUrl ? [`View details: ${facts.actionUrl}`] : []),
    `Roster snapshot: ${facts.rosterVersionId} (version ${facts.rosterVersion})`,
  ].join('\n\n');
  const html = [
    '<main>',
    `<p><strong>${escapeHtml(organization)}</strong><br>${escapeHtml(tryout)}<br>Division: ${escapeHtml(division)}<br>Athlete: ${escapeHtml(athlete)}</p>`,
    `<p><strong>${escapeHtml(template.statement)}</strong>${team ? `<br>Team: ${escapeHtml(team)}` : ''}</p>`,
    `<section aria-label="Organization message">${paragraphs(parsed.editableText)}</section>`,
    ...(facts.actionUrl
      ? [
          `<p><a href="${escapeHtml(facts.actionUrl)}" rel="noopener noreferrer">View details</a></p>`,
        ]
      : []),
    `<footer>Roster snapshot: ${escapeHtml(facts.rosterVersionId)} (version ${facts.rosterVersion})</footer>`,
    '</main>',
  ].join('');
  return { subject, text, html };
}
