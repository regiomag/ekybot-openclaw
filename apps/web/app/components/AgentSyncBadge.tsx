import { AgentSyncState, getAgentSyncToneClasses } from '@/lib/companion-agent-display';

export default function AgentSyncBadge({
  state,
}: {
  state: AgentSyncState;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-xs ${getAgentSyncToneClasses(
        state.tone
      )}`}
      title={state.detail}
    >
      {state.label}
    </span>
  );
}

