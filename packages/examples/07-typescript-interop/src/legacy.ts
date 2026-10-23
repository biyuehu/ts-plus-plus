export interface LegacyUser {
  id: number;
  name: string;
}

export function loadLegacyUser(): LegacyUser {
  return { id: 1, name: "Ada" };
}
