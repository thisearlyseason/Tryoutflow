import { CheckinWorkspace } from '../../../../src/modules/checkin/ui/checkin-workspace';

const checkedInRegistrations = new Set<string>();
const ambiguousRequestKeys = new Map<string, string>();
const receipts = new Map<
  string,
  { payload: string; outcome: 'checked_in' | 'already_checked_in'; assignedNumber?: number }
>();

export default function CheckinFixture() {
  async function search(query: string) {
    'use server';
    if (!query.toLowerCase().includes('ava')) return [];
    checkedInRegistrations.clear();
    ambiguousRequestKeys.clear();
    receipts.clear();
    return [
      {
        registrationId: '40f02020-2020-4020-8020-202020202020',
        athleteName: 'Ava Smith',
        guardianName: 'Taylor Smith',
        divisionName: 'U13',
        tryoutNumber: null,
        status: 'ready' as const,
      },
    ];
  }
  async function checkIn(input: {
    registrationId: string;
    requestedNumber?: number;
    requestKey: string;
  }) {
    'use server';
    if (input.requestedNumber === 42)
      return { outcome: 'number_conflict' as const, nextAvailable: 43 };
    const payload = JSON.stringify([input.registrationId, input.requestedNumber ?? null]);
    const existing = receipts.get(input.requestKey);
    if (existing)
      return existing.payload === payload
        ? { outcome: existing.outcome, assignedNumber: existing.assignedNumber }
        : { outcome: 'conflict' as const };
    if (checkedInRegistrations.has(input.registrationId)) {
      receipts.set(input.requestKey, {
        payload,
        outcome: 'already_checked_in',
        assignedNumber: input.requestedNumber,
      });
      return { outcome: 'already_checked_in' as const, assignedNumber: input.requestedNumber };
    }
    if (input.requestedNumber === 44) {
      const ambiguousKey = ambiguousRequestKeys.get(input.registrationId);
      if (!ambiguousKey) {
        ambiguousRequestKeys.set(input.registrationId, input.requestKey);
        return { outcome: 'unexpected_error' as const };
      }
      if (ambiguousKey !== input.requestKey) return { outcome: 'conflict' as const };
      ambiguousRequestKeys.delete(input.registrationId);
    }
    checkedInRegistrations.add(input.registrationId);
    receipts.set(input.requestKey, {
      payload,
      outcome: 'checked_in',
      assignedNumber: input.requestedNumber,
    });
    return { outcome: 'checked_in' as const, assignedNumber: input.requestedNumber };
  }
  return (
    <main className="mx-auto min-w-0 max-w-3xl p-4">
      <p className="eyebrow">Live operations</p>
      <h1>Fall ID Camp check-in</h1>
      <CheckinWorkspace
        onCheckIn={checkIn}
        placements={[
          {
            sessionId: 'session-1',
            sessionName: 'Morning skills',
            groupId: 'blue',
            groupName: 'Blue',
          },
          { sessionId: 'session-2', sessionName: 'Evening skills' },
        ]}
        search={search}
      />
    </main>
  );
}
