export type UnitStat = 'cost' | 'health' | 'speed';
export type UnitValues = Partial<Record<UnitStat, number>>;
export type UnitContent = {
  supported: boolean; reason?: string; revision: string; key: string; overrides: UnitValues;
  relatedUnits?: { key: string; name: string; fields: UnitStat[] }[];
  unit: { name: string; mode: 'classic' | 'ra2'; actor: string; factions: { id: string; name: string }[] };
  targets: Record<string, { actor: string; baseline: Record<UnitStat, number | null>; inherited: Record<UnitStat, number | null>; effective: Record<UnitStat, number | null> }>;
};
export type UnitPreview = { state: 'unbuilt' | 'building' | 'ready' | 'outdated' | 'failed'; revision?: string; savedRevision?: string; buildId?: string; builtAt?: string; verifiedAt?: string; verified?: boolean; targets?: string[]; webUrl?: string; error?: string; log?: string };
