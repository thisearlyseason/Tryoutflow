import type { SetupCategory } from './setup-configuration';
import { sportTemplates } from '../../talent/domain/performance';

export type SportEventStarter = {
  sport: 'Basketball' | 'Hockey' | 'Soccer';
  name: string;
  categories: SetupCategory[];
  groups: string[];
  stations: { name: string; minutes: number; instructions: string }[];
  measurements: (typeof sportTemplates)[number][];
};
const category = (
  name: string,
  weight: number,
  low: string,
  middle: string,
  high: string,
): SetupCategory => ({
  name,
  weight,
  scaleMin: 1,
  scaleMax: 5,
  description: `Observe ${name.toLowerCase()} across repeated opportunities.`,
  guidance: `1: ${low}. 3: ${middle}. 5: ${high}. Use 2 and 4 between anchors. No opportunity means missing, never zero.`,
});
export const sportEventStarters: SportEventStarter[] = [
  {
    sport: 'Basketball',
    name: 'Basketball skills and game decisions',
    groups: ['Blue', 'Gold', 'Green'],
    categories: [
      category(
        'Ball handling',
        20,
        'Loses control under light pressure',
        'Controls either hand at moderate speed',
        'Changes pace and protects the ball under pressure',
      ),
      category(
        'Passing and decisions',
        25,
        'Misses open options',
        'Finds an available teammate',
        'Anticipates help and creates an advantage',
      ),
      category(
        'Shooting technique',
        20,
        'Inconsistent balance and release',
        'Repeatable balance and follow-through',
        'Repeatable mechanics under game pressure',
      ),
      category(
        'Defense and movement',
        25,
        'Loses assignment or balance',
        'Maintains stance and recovers',
        'Communicates, contains and rotates consistently',
      ),
      category(
        'Team play',
        10,
        'Rarely communicates or responds',
        'Communicates and responds to coaching',
        'Supports teammates and applies feedback consistently',
      ),
    ],
    stations: [
      {
        name: 'Handling and passing',
        minutes: 12,
        instructions:
          'Pair passing then 2-on-1; equal turns on both sides. Observe control and choices.',
      },
      {
        name: 'Shooting and jump',
        minutes: 12,
        instructions:
          '10 free throws, then 3 standing jumps with rest. Record attempts and valid measurements separately from ratings.',
      },
      {
        name: 'Small-sided game',
        minutes: 12,
        instructions:
          '3-on-3 with equal possessions. Observe defense, decisions and team play; rotate opponents.',
      },
    ],
    measurements: sportTemplates.filter((row) => row.sport === 'Basketball'),
  },
  {
    sport: 'Hockey',
    name: 'Hockey skills and game decisions',
    groups: ['Blue', 'Gold', 'Green'],
    categories: [
      category(
        'Skating',
        25,
        'Unstable starts and stops',
        'Controlled turns and transitions',
        'Efficient edges and acceleration under pressure',
      ),
      category(
        'Puck control',
        20,
        'Loses possession without pressure',
        'Controls puck at moderate speed',
        'Protects and changes direction under pressure',
      ),
      category(
        'Passing and decisions',
        25,
        'Misses open options',
        'Makes playable passes to open teammates',
        'Anticipates play and creates advantages',
      ),
      category(
        'Shooting',
        20,
        'Inconsistent balance and release',
        'Repeatable controlled release',
        'Accurate release with pressure and movement',
      ),
      category(
        'Team play',
        10,
        'Rarely communicates or responds',
        'Supports teammates and responds',
        'Communicates and applies feedback consistently',
      ),
    ],
    stations: [
      {
        name: 'Skating and puck control',
        minutes: 12,
        instructions:
          '20 m timed skating, then controlled edge course; 2 timed attempts with recovery.',
      },
      {
        name: 'Shooting',
        minutes: 12,
        instructions:
          'Same shot type, distance and targets; 10 accuracy attempts, 3 radar attempts. Use safe exclusion zones.',
      },
      {
        name: 'Small-area game',
        minutes: 12,
        instructions:
          '3-on-3; equal shifts and mixed opponents. Observe support, choices and possession.',
      },
    ],
    measurements: sportTemplates.filter((row) => row.sport === 'Hockey'),
  },
  {
    sport: 'Soccer',
    name: 'Soccer skills and game decisions',
    groups: ['Blue', 'Gold', 'Green'],
    categories: [
      category(
        'First touch and control',
        25,
        'Touch frequently loses possession',
        'Controls playable balls into space',
        'Controls and turns away from pressure',
      ),
      category(
        'Passing and decisions',
        25,
        'Misses open options',
        'Finds teammates with playable passes',
        'Creates advantages with timing and weight',
      ),
      category(
        'Movement and defense',
        25,
        'Loses assignment or support position',
        'Recovers and offers support',
        'Anticipates transitions and coordinates cover',
      ),
      category(
        'Finishing',
        15,
        'Inconsistent balance and contact',
        'Controlled contact toward a target',
        'Selects and executes finishes under pressure',
      ),
      category(
        'Team play',
        10,
        'Rarely communicates or responds',
        'Communicates and responds to coaching',
        'Supports teammates and applies feedback consistently',
      ),
    ],
    stations: [
      {
        name: 'Sprint and control',
        minutes: 12,
        instructions:
          '2 standing-start 20 m sprints with recovery; then first-touch receiving on both feet.',
      },
      {
        name: 'Passing and finishing',
        minutes: 12,
        instructions:
          'Paired passing then finishing from equal service on both sides. Observe choices separately from outcomes.',
      },
      {
        name: 'Small-sided game',
        minutes: 12,
        instructions:
          '4-on-4; equal minutes and mixed opponents. Observe support, transitions and defense.',
      },
    ],
    measurements: sportTemplates.filter((row) => row.sport === 'Soccer'),
  },
];
