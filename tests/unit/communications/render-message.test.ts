import { describe, expect, it } from 'vitest';

import { renderMessage } from '../../../src/modules/communications/application/render-message';

const facts = {
  organizationName: 'Badlands Hockey Academy',
  tryoutName: 'U15 Competitive Tryout',
  divisionName: 'U15',
  athletePreferredName: 'Ava <script>alert(1)</script>',
  decision: 'selected' as const,
  teamName: 'Blue\r\nBcc: attacker@example.com',
  actionUrl: 'https://tryoutflow.example/decisions/abc?x=<unsafe>',
  rosterVersionId: '11111111-1111-4111-8111-111111111111',
  rosterVersion: 7,
};

describe('decision message renderer', () => {
  it.each(['callback', 'selected', 'waitlisted', 'released'] as const)(
    'renders protected %s facts around only the bounded editable region',
    (decision) => {
      const rendered = renderMessage({
        kind: decision,
        facts: { ...facts, decision },
        editableText: 'Thank you for taking part.\nPlease reply with questions.',
      });

      expect(rendered.text).toContain('U15 Competitive Tryout');
      expect(rendered.text).toContain('Thank you for taking part.');
      expect(rendered.subject).not.toMatch(/[\r\n]/u);
      expect(rendered.html).not.toContain('<script>');
      expect(rendered.html).toContain('&lt;script&gt;');
      expect(rendered.html).not.toContain('Bcc:');
    },
  );

  it('rejects unsafe links, private fields, and unbounded editable copy', () => {
    expect(() =>
      renderMessage({ ...({ kind: 'selected', facts } as const), editableText: 'x'.repeat(4001) }),
    ).toThrow();
    expect(() =>
      renderMessage({
        kind: 'selected',
        facts: { ...facts, actionUrl: 'javascript:alert(1)' },
        editableText: 'Welcome.',
      }),
    ).toThrow();
    expect(
      JSON.stringify(renderMessage({ kind: 'selected', facts, editableText: 'Welcome.' })),
    ).not.toMatch(/evaluator|score|guardian/i);
  });
});
