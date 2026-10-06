import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/infrastructure/supabase/database.types';

export const workspaceNavigationSchema = z.object({
  isTeam: z.boolean(),
  parent: z
    .object({ id: z.uuid(), name: z.string(), slug: z.string(), canManage: z.boolean() })
    .nullable(),
  workspaces: z.array(
    z.object({ id: z.uuid(), name: z.string(), slug: z.string(), isTeam: z.boolean() }),
  ),
});
export type WorkspaceNavigation = z.infer<typeof workspaceNavigationSchema>;
export const teamWorkspacesSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    tryouts: z.number().int().nonnegative(),
    athletes: z.number().int().nonnegative(),
    completedEvaluations: z.number().int().nonnegative(),
    coaches: z.number().int().nonnegative(),
  }),
);
export type TeamWorkspace = z.infer<typeof teamWorkspacesSchema>[number];
export const createTeamWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export async function loadWorkspaceNavigation(
  client: SupabaseClient<Database>,
  organizationId: string,
) {
  const { data, error } = await client.rpc('get_workspace_navigation', {
    p_organization_id: organizationId,
  });
  if (error) throw new Error('Workspaces are temporarily unavailable.');
  return workspaceNavigationSchema.parse(data);
}
export function summarizeTeamWorkspaces(teams: readonly TeamWorkspace[]) {
  return teams.reduce(
    (total, team) => ({
      teams: total.teams + 1,
      tryouts: total.tryouts + team.tryouts,
      athletes: total.athletes + team.athletes,
      completedEvaluations: total.completedEvaluations + team.completedEvaluations,
    }),
    { teams: 0, tryouts: 0, athletes: 0, completedEvaluations: 0 },
  );
}
