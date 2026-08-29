import { CheckinWorkspace } from '../../../../src/modules/checkin/ui/checkin-workspace';

const checkedInRegistrations = new Set<string>();

export default function CheckinFixture() {
  async function search(query: string) {
    'use server';
    if (!query.toLowerCase().includes('ava')) return [];
    checkedInRegistrations.delete('40f02020-2020-4020-8020-202020202020');
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
  async function checkIn(input: { registrationId: string; requestedNumber?: number }) {
    'use server';
    if (input.requestedNumber === 42)
      return { outcome: 'number_conflict' as const, nextAvailable: 43 };
    if (checkedInRegistrations.has(input.registrationId))
      return { outcome: 'already_checked_in' as const, assignedNumber: input.requestedNumber };
    checkedInRegistrations.add(input.registrationId);
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
