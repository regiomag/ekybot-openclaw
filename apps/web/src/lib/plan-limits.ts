export interface PlanLimits {
  agents: number;
  users: number;
  channels: number;
}

const BASE_LIMITS: Record<string, PlanLimits> = {
  free: { agents: 3, users: 1, channels: 1 },
  starter: { agents: 10, users: 1, channels: -1 },
  pro: { agents: 20, users: 3, channels: -1 },
  team: { agents: 50, users: 15, channels: -1 },
};

export function getBaseLimits(plan: string): PlanLimits {
  return BASE_LIMITS[plan] || BASE_LIMITS.free;
}

export function getEffectiveLimits(
  plan: string,
  addonAgents = 0,
  addonUsers = 0
): PlanLimits {
  const base = getBaseLimits(plan);

  return {
    agents: base.agents + addonAgents,
    users: base.users + addonUsers,
    channels: base.channels,
  };
}
