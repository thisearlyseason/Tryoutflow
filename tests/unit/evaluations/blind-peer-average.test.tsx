import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AthleteProfilePanel } from '@/modules/evaluations/ui/athlete-profile-panel';
import { loadAthleteProfileAverage } from '@/modules/evaluations/infrastructure/athlete-profile-loader';
import type { EvaluatorSessionData } from '@/modules/evaluations/infrastructure/evaluator-session-loader';
import { readFileSync } from 'node:fs';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const average = { evaluationCount: 2, scores: [{ categoryId: id, value: 3.5, count: 2 }] };
const categories = [
  {
    id,
    name: 'Control',
    scaleMin: 1 as const,
    scaleMax: 5 as const,
    required: true,
    weight: '100',
    description: null,
    guidance: null,
  },
];
afterEach(cleanup);
function fixture(state: string, registrationId = 'athlete', rubricVersionId = 'rubric') {
  const rpc = vi.fn(async () => ({ data: average, error: null }));
  const data = {
    current: { organization: { id: 'org' }, client: { rpc } },
    session: { id: 'session', tryoutId: 'event' },
    athletes: [{ registrationId: 'athlete' }],
    evaluations: [{ registrationId, rubricVersionId, state }],
  } as unknown as EvaluatorSessionData;
  return { data, rpc };
}
describe('blind peer averages', () => {
  it.each(['draft', 'reopened', 'unknown'])('never calls aggregate RPC for %s', async (state) => {
    const { data, rpc } = fixture(state);
    expect(await loadAthleteProfileAverage(data, 'athlete', 'rubric')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['completed', 'locked'])(
    'requests the exact scoped aggregate after own %s submission',
    async (state) => {
      const { data, rpc } = fixture(state);
      expect(await loadAthleteProfileAverage(data, 'athlete', 'rubric')).toEqual(average);
      expect(rpc).toHaveBeenCalledWith('load_athlete_profile_average', {
        p_organization_id: 'org',
        p_tryout_id: 'event',
        p_registration_id: 'athlete',
        p_session_id: 'session',
        p_rubric_version_id: 'rubric',
      });
    },
  );
  it('denies a completed different athlete or form and an unassigned athlete', async () => {
    for (const [registration, rubric] of [
      ['other', 'rubric'],
      ['athlete', 'other'],
    ]) {
      const { data, rpc } = fixture('completed', registration, rubric);
      expect(await loadAthleteProfileAverage(data, 'athlete', 'rubric')).toBeNull();
      expect(rpc).not.toHaveBeenCalled();
    }
    const { data, rpc } = fixture('completed');
    data.athletes = [];
    expect(await loadAthleteProfileAverage(data, 'athlete', 'rubric')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('keeps drafts blind and suppresses cached peers immediately on reopen and navigation', async () => {
    const user = userEvent.setup();
    const loader = vi.fn(async () => average);
    const props = {
      athleteName: 'Athlete 42',
      categories,
      scores: [],
      note: '',
      loadAverage: loader,
    };
    const { rerender } = render(<AthleteProfilePanel {...props} completed={false} />);
    expect(screen.getByRole('button', { name: 'Evaluator Average', hidden: true })).toBeDisabled();
    expect(loader).not.toHaveBeenCalled();
    rerender(<AthleteProfilePanel {...props} completed />);
    await user.click(screen.getByRole('button', { name: 'Evaluator Average' }));
    expect(await screen.findByText(/2 completed evaluations/)).toBeVisible();
    rerender(<AthleteProfilePanel {...props} completed={false} />);
    expect(screen.queryByText(/2 completed evaluations/)).toBeNull();
    let resolve!: (value: typeof average) => void;
    const pending = vi.fn(
      () =>
        new Promise<typeof average>((done) => {
          resolve = done;
        }),
    );
    rerender(
      <AthleteProfilePanel {...props} athleteName="Athlete 43" loadAverage={pending} completed />,
    );
    expect(screen.queryByText(/2 completed evaluations/)).toBeNull();
    await act(async () => {});
    expect(pending).toHaveBeenCalledTimes(1);
    rerender(
      <AthleteProfilePanel
        {...props}
        athleteName="Athlete 43"
        loadAverage={pending}
        completed={false}
      />,
    );
    await act(async () => resolve(average));
    expect(screen.queryByText(/2 completed evaluations/)).toBeNull();
  });
  it('rejects a late previous-scope response even when the same loader is reused', async () => {
    const user = userEvent.setup();
    const resolvers: ((value: typeof average | null) => void)[] = [];
    const loader = vi.fn(
      () => new Promise<typeof average | null>((resolve) => resolvers.push(resolve)),
    );
    const props = {
      athleteName: 'Athlete 42',
      categories,
      scores: [],
      note: '',
      loadAverage: loader,
      completed: true,
    };
    const { rerender } = render(
      <AthleteProfilePanel {...props} profileScope="org/session/athlete/form-v1" />,
    );
    await user.click(screen.getByRole('button', { name: 'Evaluator Average' }));
    expect(loader).toHaveBeenCalledTimes(1);
    rerender(<AthleteProfilePanel {...props} profileScope="org/session/athlete/form-v2" />);
    await act(async () => {});
    expect(loader).toHaveBeenCalledTimes(2);
    await act(async () => resolvers[0]!(average));
    expect(screen.queryByText(/2 completed evaluations/)).toBeNull();
    // A fresh server denial (for example revoked assignment) cannot revive old data.
    await act(async () => resolvers[1]!(null));
    expect(screen.queryByText(/2 completed evaluations/)).toBeNull();
    expect(screen.getByText(/Evaluator average is unavailable/)).toBeVisible();
  });
  it.each([
    ['actor', 'actor-b', 'tenant-a'],
    ['tenant', 'actor-a', 'tenant-b'],
  ])(
    'conceals cached and pending peers when only the %s changes with the same loader',
    async (_changed, actor, tenant) => {
      const user = userEvent.setup();
      const resolvers: ((value: typeof average | null) => void)[] = [];
      const loader = vi.fn(
        () => new Promise<typeof average | null>((resolve) => resolvers.push(resolve)),
      );
      const props = {
        athleteName: 'Athlete 42',
        categories,
        scores: [],
        note: '',
        loadAverage: loader,
        completed: true,
      };
      const scope = (userId: string, organizationId: string) =>
        JSON.stringify([userId, organizationId, 'session', 'athlete', 'rubric']);
      const { rerender } = render(
        <AthleteProfilePanel {...props} profileScope={scope('actor-a', 'tenant-a')} />,
      );
      await user.click(screen.getByRole('button', { name: 'Evaluator Average' }));
      await act(async () => resolvers[0]!(average));
      expect(screen.getByText(/2 completed evaluations/)).toBeVisible();
      // Changing only the principal or tenant must synchronously conceal cached data.
      rerender(<AthleteProfilePanel {...props} profileScope={scope(actor!, tenant!)} />);
      expect(screen.queryByText(/2 completed evaluations/)).toBeNull();
      await act(async () => {});
      expect(loader).toHaveBeenCalledTimes(2);
      // A second principal transition interrupts that request without changing any resource.
      rerender(<AthleteProfilePanel {...props} profileScope={scope('actor-c', tenant!)} />);
      await act(async () => {});
      expect(loader).toHaveBeenCalledTimes(3);
      await act(async () => resolvers[1]!(average));
      expect(screen.queryByText(/2 completed evaluations/)).toBeNull();
      await act(async () => resolvers[2]!(null));
      expect(screen.queryByText(/2 completed evaluations/)).toBeNull();
      expect(screen.getByText(/Evaluator average is unavailable/)).toBeVisible();
    },
  );
  it('conceals cached peers on page restoration and requires a fresh authorized request', async () => {
    const user = userEvent.setup();
    const loader = vi.fn(async () => average);
    render(
      <AthleteProfilePanel
        athleteName="Athlete 42"
        categories={categories}
        scores={[]}
        note=""
        loadAverage={loader}
        completed
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Evaluator Average' }));
    expect(await screen.findByText(/2 completed evaluations/)).toBeVisible();
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(screen.queryByText(/2 completed evaluations/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Evaluator Average' }));
    expect(await screen.findByText(/2 completed evaluations/)).toBeVisible();
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('keeps direct RPC authorization in SQL with unchanged signature, grants and private aggregate shape', () => {
    const sql = readFileSync(
      'supabase/migrations/202610180166_blind_athlete_profile_average.sql',
      'utf8',
    );
    expect(sql).toContain(
      'own.evaluator_user_id=auth.uid() and own.rubric_version_id=p_rubric_version_id',
    );
    expect(sql).toContain("own.state in ('completed','locked')");
    expect(sql).toContain('public.evaluator_has_active_context(');
    expect(sql).toContain('se.group_id is not distinct from own.group_id');
    expect(sql).toContain('r.division_id=own.division_id');
    expect(sql).toContain('language plpgsql stable security definer set search_path=');
    expect(sql).toContain('from public,anon,authenticated,service_role');
    expect(sql).toContain('to authenticated;');
    expect(sql).not.toMatch(/create table|alter table|evaluation_notes|grant.+service_role/i);
  });
});
