// Demo-only ward resolver. Replace with a point-in-polygon lookup against verified ward boundaries.
export function resolveWard(latitude: number, longitude: number) {
  if (latitude >= 12.9 && latitude <= 13.1 && longitude >= 77.5 && longitude <= 77.7) return { ward:'Ward 14 · Green Park', department:'Road Maintenance' };
  return { ward:'Outside pilot area', department:'Needs manual routing' };
}
