import 'server-only';
import { z } from 'zod';
import type { ProfileAverage } from '../domain/athlete-profile';
import type { EvaluatorSessionData } from './evaluator-session-loader';

const averageSchema = z.object({
  evaluationCount: z.number().int().nonnegative(),
  scores: z.array(
    z.object({
      categoryId: z.uuid(),
      value: z.number().finite(),
      count: z.number().int().positive(),
    }),
  ),
});

export async function loadAthleteProfileAverage(
  data: EvaluatorSessionData,
  registrationId: string,
  rubricVersionId: string,
): Promise<ProfileAverage | null> {
  if (!data.athletes.some((athlete) => athlete.registrationId === registrationId)) return null;
  const result = await data.current.client.rpc('load_athlete_profile_average', {
    p_organization_id: data.current.organization.id,
    p_tryout_id: data.session.tryoutId,
    p_registration_id: registrationId,
    p_session_id: data.session.id,
    p_rubric_version_id: rubricVersionId,
  });
  if (result.error) return null;
  const parsed = averageSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}
