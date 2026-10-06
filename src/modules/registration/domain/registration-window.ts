import { z } from 'zod';
import { isIanaTimeZone } from '../../organizations/domain/organization';

export const registrationWindowResponseSchema = z.object({
  outcome: z.enum(['scheduled', 'closed']),
  registrationWindow: z.object({
    name: z.string().min(1),
    organizationName: z.string().min(1),
    timezone: z.string().refine(isIanaTimeZone),
    opensAt: z.iso.datetime({ offset: true }),
    closesAt: z.iso.datetime({ offset: true }),
  }),
});
export type RegistrationWindowResponse = z.infer<typeof registrationWindowResponseSchema>;

export function formatRegistrationDate(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(instant));
}
export function formatRegistrationTime(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(instant))
    .replace('a.m.', 'AM')
    .replace('p.m.', 'PM');
}
