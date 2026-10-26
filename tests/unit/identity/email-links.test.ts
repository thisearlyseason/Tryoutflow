import { expect, it } from 'vitest';
import { emailTextHtml } from '@/infrastructure/email/brand-template';

it('keeps sentence punctuation outside the clickable URL', () => {
  expect(emailTextHtml('Review https://www.tryout.agency/platform/deletions.')).toContain(
    '<a href="https://www.tryout.agency/platform/deletions" style="color:#0057ff;word-break:break-word">https://www.tryout.agency/platform/deletions</a>.',
  );
});
