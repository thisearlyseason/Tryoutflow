import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function expectNoCriticalAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const criticalViolations = result.violations.filter(
    (violation) => violation.impact === 'critical',
  );

  expect(
    criticalViolations,
    JSON.stringify(
      criticalViolations.map(({ help, helpUrl, id, nodes }) => ({
        help,
        helpUrl,
        id,
        nodes: nodes.map(({ failureSummary, html, target }) => ({
          failureSummary,
          html,
          target,
        })),
      })),
      null,
      2,
    ),
  ).toEqual([]);
}
