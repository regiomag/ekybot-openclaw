export type AgentSyncTone = 'emerald' | 'amber' | 'slate' | 'rose' | 'blue';

export type AgentSyncState = {
  label: string;
  detail: string;
  tone: AgentSyncTone;
};

type AgentPageCompanionState = {
  linked?: boolean;
  machineName?: string;
  ownership?: string;
  actualModel?: string | null;
  runtimeDriftDetected?: boolean | null;
};

type CompanionInventoryState = {
  ownership?: string;
  ekybotAgent?: {
    id: string;
    name: string;
    provider: string;
    model: string;
  } | null;
  model?: string | null;
};

const toneClassMap: Record<AgentSyncTone, string> = {
  emerald: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/20',
  amber: 'bg-amber-500/20 text-amber-200 border-amber-400/20',
  slate: 'bg-white/10 text-white/65 border-white/10',
  rose: 'bg-rose-500/20 text-rose-200 border-rose-400/20',
  blue: 'bg-blue-500/20 text-blue-200 border-blue-400/20',
};

export function getAgentSyncToneClasses(tone: AgentSyncTone) {
  return toneClassMap[tone];
}

export function deriveAgentSyncStateFromAgent(params: {
  companion?: AgentPageCompanionState | null;
  desiredModel?: string | null;
  pendingOperationTypes?: string[];
}) {
  const { companion, desiredModel, pendingOperationTypes = [] } = params;

  if (!companion?.linked) {
    return {
      label: 'External only',
      detail: 'Cet agent existe seulement dans EkyBot ou via tes flux legacy.',
      tone: 'slate',
    } satisfies AgentSyncState;
  }

  if (pendingOperationTypes.includes('delete_agent')) {
    return {
      label: 'Pending local disable',
      detail: `Companion retire cet agent du runtime sur ${companion.machineName || 'la machine liée'} sans effacer son workspace.`,
      tone: 'amber',
    } satisfies AgentSyncState;
  }

  if (pendingOperationTypes.length > 0) {
    return {
      label: 'Pending local sync',
      detail: `Companion doit encore appliquer ${pendingOperationTypes[0]} sur ${companion.machineName || 'la machine liée'}.`,
      tone: 'amber',
    } satisfies AgentSyncState;
  }

  if (companion.runtimeDriftDetected === false) {
    return {
      label: 'Managed by Companion',
      detail: `Cet agent est géré localement via ${companion.machineName || 'Companion'}.`,
      tone: 'emerald',
    } satisfies AgentSyncState;
  }

  if (companion.actualModel && desiredModel && companion.actualModel === desiredModel) {
    return {
      label: 'Managed by Companion',
      detail: `Cet agent est géré localement via ${companion.machineName || 'Companion'}.`,
      tone: 'emerald',
    } satisfies AgentSyncState;
  }

  if (companion.actualModel && desiredModel && companion.actualModel !== desiredModel) {
    return {
      label: 'Local drift',
      detail: `Le modèle local est ${companion.actualModel}, différent du modèle désiré ${desiredModel}.`,
      tone: 'amber',
    } satisfies AgentSyncState;
  }

  return {
    label: 'Managed by Companion',
    detail: `Cet agent est géré localement via ${companion.machineName || 'Companion'}.`,
    tone: 'emerald',
  } satisfies AgentSyncState;
}

export function deriveAgentSyncStateFromInventory(params: {
  agent: CompanionInventoryState;
  pendingOperationTypes?: string[];
}) {
  const { agent, pendingOperationTypes = [] } = params;

  if (pendingOperationTypes.includes('delete_agent')) {
    return {
      label: 'Pending local disable',
      detail: 'L’agent sera retiré du runtime local au prochain reconcile, sans suppression du workspace.',
      tone: 'amber',
    } satisfies AgentSyncState;
  }

  if (pendingOperationTypes.length > 0) {
    return {
      label: 'Pending local sync',
      detail: `Une opération Companion est encore en attente (${pendingOperationTypes[0]}).`,
      tone: 'amber',
    } satisfies AgentSyncState;
  }

  if (agent.ownership === 'managed' && agent.ekybotAgent) {
    if (agent.model && agent.ekybotAgent.model && agent.model !== agent.ekybotAgent.model) {
      return {
        label: 'Local drift',
        detail: `OpenClaw utilise ${agent.model}, EkyBot attend ${agent.ekybotAgent.model}.`,
        tone: 'amber',
      } satisfies AgentSyncState;
    }

    return {
      label: 'In sync',
      detail: `L’agent est lié à EkyBot et géré par Companion.`,
      tone: 'emerald',
    } satisfies AgentSyncState;
  }

  if (agent.ownership === 'conflicted') {
    return {
      label: 'Conflict detected',
      detail: 'Une intervention manuelle est nécessaire avant de gérer cet agent.',
      tone: 'rose',
    } satisfies AgentSyncState;
  }

  if (agent.ownership === 'adoptable') {
    return {
      label: 'Ready to import',
      detail: 'Cet agent peut être adopté dans EkyBot sans toucher à OpenClaw pour l’instant.',
      tone: 'blue',
    } satisfies AgentSyncState;
  }

  return {
    label: 'External only',
    detail: 'Cet agent existe dans OpenClaw mais n’est pas encore géré par EkyBot.',
    tone: 'slate',
  } satisfies AgentSyncState;
}
