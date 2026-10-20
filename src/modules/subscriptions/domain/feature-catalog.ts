/** Product-neutral keys shared by the database, server and presentation layers. */
export const FEATURE_CATALOG = {
  create_tryout: {
    name: 'Create tryouts',
    description: 'Set up and run your event.',
    tier: 'free',
  },
  basic_evaluations: {
    name: 'Basic evaluations',
    description: 'Record individual scores and observations.',
    tier: 'free',
  },
  publish_tryout: {
    name: 'Publish tryouts',
    description: 'Open registration for your event.',
    tier: 'pro',
  },
  advanced_evaluations: {
    name: 'Weighted evaluations',
    description: 'Score with weighted criteria, custom scales and priority categories.',
    tier: 'pro',
  },
  radar_charts: {
    name: 'Athlete radar charts',
    description: 'Explore category-level performance profiles.',
    tier: 'pro',
  },
  player_comparison: {
    name: 'Player comparison',
    description: 'Compare athletes side by side with evaluation context.',
    tier: 'pro',
  },
  advanced_rankings: {
    name: 'Advanced rankings',
    description: 'Review rankings with category-level evidence and coverage.',
    tier: 'pro',
  },
  custom_templates: {
    name: 'Custom evaluation templates',
    description: 'Define reusable criteria for your program.',
    tier: 'pro',
  },
  export_reports: {
    name: 'Reports and exports',
    description: 'Generate reports and export authorized records.',
    tier: 'pro',
  },
  historical_data: {
    name: 'Historical scorecards',
    description: 'Review an athlete’s original scorecards from past events.',
    tier: 'pro',
  },
  advanced_scouting: {
    name: 'Scouting and performance',
    description: 'Track observations, measured results and development.',
    tier: 'pro',
  },
  unlimited_evaluators: {
    name: 'Expanded evaluator access',
    description: 'Coordinate your evaluation team.',
    tier: 'pro',
  },
  organization_management: {
    name: 'Team workspaces and shared defaults',
    description:
      'Manage separate team workspaces, team coaches and shared program defaults under one Organization plan.',
    tier: 'organization',
  },
  custom_branding: {
    name: 'Organization branding',
    description: 'Apply your organization identity to supported surfaces.',
    tier: 'organization',
  },
  organization_reporting: {
    name: 'Organization reporting',
    description: 'Review activity across your program.',
    tier: 'organization',
  },
} as const;
export type FeatureKey = keyof typeof FEATURE_CATALOG;
export const FEATURE_KEYS = Object.keys(FEATURE_CATALOG) as FeatureKey[];
export type AccessTier = 'free' | 'pro' | 'organization';
export const USAGE_KEYS = [
  'active_tryouts',
  'athletes_per_tryout',
  'evaluators_per_tryout',
  'custom_templates',
] as const;
export type UsageKey = (typeof USAGE_KEYS)[number];
export type UsageLimits = Record<UsageKey, number | null>;
export const UNCONFIGURED_LIMITS: UsageLimits = {
  active_tryouts: null,
  athletes_per_tryout: null,
  evaluators_per_tryout: null,
  custom_templates: null,
};
export const FEATURE_ALIASES: Readonly<Record<string, FeatureKey>> = {
  scouting: 'advanced_scouting',
  custom_evaluation_templates: 'custom_templates',
  historical_comparison: 'historical_data',
  report_generation: 'export_reports',
  pdf_export: 'export_reports',
  csv_export: 'export_reports',
  branding: 'custom_branding',
  additional_evaluators: 'unlimited_evaluators',
  advanced_analytics: 'organization_reporting',
};
export function resolveFeatureKey(value: string): FeatureKey | null {
  if (Object.hasOwn(FEATURE_CATALOG, value)) return value as FeatureKey;
  return Object.hasOwn(FEATURE_ALIASES, value) ? FEATURE_ALIASES[value]! : null;
}
