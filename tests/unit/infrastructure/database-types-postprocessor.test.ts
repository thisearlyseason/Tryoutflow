import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('database type postprocessor', () => {
  it('narrows exact Returns fields without matching masking Args names', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-database-types-'));
    const databaseTypes = join(directory, 'database.types.ts');
    const fixture = `export type Database = {
  public: {
    Functions: {
      complete_evaluation: {
        Args: {
          p_group_id: string;
          p_expected_version: number;
          version: number;
        };
        Returns: {
          outcome: string;
          version: number;
        }[];
      };
      configure_evaluation_note_tag: {
        Args: {
          note_tag_id: string;
          p_note_tag_id: string;
        };
        Returns: {
          note_tag_id: string;
          outcome: string;
        }[];
      };
      lock_evaluation: {
        Args: { p_expected_version: number; p_group_id: string };
        Returns: { outcome: string; version: number }[];
      };
      manage_director_evaluation_flag: {
        Args: { athlete_flag_id: string; p_flag_id: string; p_group_id: string };
        Returns: { athlete_flag_id: string; outcome: string }[];
      };
      reopen_evaluation: {
        Args: { p_expected_version: number; p_group_id: string };
        Returns: { outcome: string; version: number }[];
      };
      save_evaluation_draft: {
        Args: { evaluation_id: string; p_expected_version: number; p_group_id: string; p_note: string };
        Returns: { evaluation_id: string; outcome: string; version: number }[];
      };
      list_assigned_athletes: {
        Args: never;
        Returns: { group_id: string; group_name: string; session_id: string; session_name: string; tryout_number: number }[];
      };
      list_manageable_evaluator_assignments: {
        Args: never;
        Returns: { division_id: string; expires_at: string; group_id: string; session_id: string }[];
      };
      create_roster_draft: {
        Args: never;
        Returns: { outcome: string; roster_version_id: string; version: number }[];
      };
      move_roster_athlete: {
        Args: { p_team_id: string };
        Returns: { outcome: string; version: number }[];
      };
      change_roster_decisions: {
        Args: never;
        Returns: { outcome: string; version: number }[];
      };
      finalize_roster_version: {
        Args: never;
        Returns: { outcome: string; version: number }[];
      };
      revise_roster_version: {
        Args: never;
        Returns: { outcome: string; roster_version_id: string; version: number }[];
      };
      get_owned_subscription_account: {
        Args: { p_organization_id: string };
        Returns: {
          cancel_at: string;
          cancel_at_period_end: boolean;
          canceled_at: string;
          current_period_end: string;
          current_period_start: string;
          organization_id: string;
          plan_key: string;
          provider_customer_id: string;
          provider_price_id: string;
          provider_subscription_id: string;
          state: string;
          trial_end: string;
          verified_at: string;
          version: number;
        }[];
      };
      apply_stripe_subscription_event: {
        Args: {
          p_cancel_at: string;
          p_cancel_at_period_end: boolean;
          p_canceled_at: string;
          p_current_period_end: string;
          p_current_period_start: string;
          p_customer_id: string;
          p_event_id: string;
          p_event_type: string;
          p_organization_id: string;
          p_payload: unknown;
          p_payload_digest: string;
          p_plan_key: string;
          p_price_id: string;
          p_provider_created_at: string;
          p_state: string;
          p_subscription_id: string;
          p_trial_end: string;
        };
        Returns: string;
      };
    };
  };
};
`;

    try {
      writeFileSync(databaseTypes, fixture);
      execFileSync('node', [resolve('scripts/postprocess-database-types.mjs'), databaseTypes]);
      const processed = readFileSync(databaseTypes, 'utf8');

      execFileSync('node', [resolve('scripts/postprocess-database-types.mjs'), databaseTypes]);
      const processedTwice = readFileSync(databaseTypes, 'utf8');

      expect(processed).toContain('version: number;\n        };\n        Returns:');
      expect(processed).toContain('p_expected_version: number | null;');
      expect(processed).toContain('version: number | null;\n        }[];');
      expect(processed).toContain('note_tag_id: string;\n          p_note_tag_id: string | null;');
      expect(processed).toContain('note_tag_id: string | null;\n          outcome: string;');
      expect(processed).toContain('athlete_flag_id: string; p_flag_id: string | null;');
      expect(processed).toContain(
        'Returns: { athlete_flag_id: string | null; outcome: string }[];',
      );
      expect(processed).toContain('Args: { evaluation_id: string;');
      expect(processed).toContain('Returns: { evaluation_id: string | null;');
      expect(processed).toContain('tryout_number: number | null }[];');
      expect(processed).toContain('expires_at: string | null;');
      expect(processed).toContain('Args: { p_team_id: string | null };');
      expect(processed).toContain(
        'Returns: { outcome: string; roster_version_id: string | null; version: number | null }[];',
      );
      expect(processed).toContain(`      get_owned_subscription_account: {
        Args: { p_organization_id: string };
        Returns: {
          cancel_at: string | null;
          cancel_at_period_end: boolean | null;
          canceled_at: string | null;
          current_period_end: string | null;
          current_period_start: string | null;
          organization_id: string;
          plan_key: string | null;
          provider_customer_id: string | null;
          provider_price_id: string | null;
          provider_subscription_id: string | null;
          state: string;
          trial_end: string | null;
          verified_at: string;
          version: number;
        }[];
      };`);
      expect(processed).toContain(`      apply_stripe_subscription_event: {
        Args: {
          p_cancel_at: string | null;
          p_cancel_at_period_end: boolean;
          p_canceled_at: string | null;
          p_current_period_end: string;
          p_current_period_start: string;
          p_customer_id: string;
          p_event_id: string;
          p_event_type: string;
          p_organization_id: string | null;
          p_payload: unknown;
          p_payload_digest: string;
          p_plan_key: string | null;
          p_price_id: string | null;
          p_provider_created_at: string;
          p_state: string | null;
          p_subscription_id: string;
          p_trial_end: string | null;
        };
        Returns: string;
      };`);
      expect(processedTwice).toBe(processed);
      expect(processedTwice).not.toContain('| null | null');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(['get_owned_subscription_account', 'apply_stripe_subscription_event'])(
    'fails when the generated %s subscription RPC declaration is missing',
    (functionName) => {
      const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-database-types-missing-'));
      const databaseTypes = join(directory, 'database.types.ts');

      try {
        const tracked = readFileSync(
          resolve('src/infrastructure/supabase/database.types.ts'),
          'utf8',
        );
        const start = tracked.indexOf(`      ${functionName}: {`);
        const end = tracked.indexOf('\n      };', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        writeFileSync(databaseTypes, tracked.slice(0, start) + tracked.slice(end + 9));
        expect(() =>
          execFileSync('node', [resolve('scripts/postprocess-database-types.mjs'), databaseTypes], {
            stdio: 'pipe',
          }),
        ).toThrow();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it('is byte-idempotent for the tracked processed declaration shape', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-database-types-tracked-'));
    const databaseTypes = join(directory, 'database.types.ts');
    const tracked = readFileSync(resolve('src/infrastructure/supabase/database.types.ts'), 'utf8');

    try {
      writeFileSync(databaseTypes, tracked);
      execFileSync('node', [resolve('scripts/postprocess-database-types.mjs'), databaseTypes]);
      const processedOnce = readFileSync(databaseTypes, 'utf8');
      execFileSync('node', [resolve('scripts/postprocess-database-types.mjs'), databaseTypes]);
      const processedTwice = readFileSync(databaseTypes, 'utf8');

      expect(processedOnce).toBe(tracked);
      expect(processedTwice).toBe(tracked);
      expect(processedTwice).not.toContain('| null | null');
      expect(processedTwice).toContain('p_flag_id: string | null;');
      expect(processedTwice).toContain('athlete_flag_id: string | null;');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
