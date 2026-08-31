type CatalogPlanKey = 'trial' | 'team' | 'club' | 'association';

export const PLAN_CATALOG = Object.freeze({
  trial: { key: 'trial', name: 'Trial', monthlyPriceCad: null },
  team: { key: 'team', name: 'Team', monthlyPriceCad: 49 },
  club: { key: 'club', name: 'Club', monthlyPriceCad: 129 },
  association: { key: 'association', name: 'Association', monthlyPriceCad: 249 },
} satisfies Record<
  CatalogPlanKey,
  { key: CatalogPlanKey; name: string; monthlyPriceCad: number | null }
>);
