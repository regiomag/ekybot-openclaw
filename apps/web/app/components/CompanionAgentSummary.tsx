import type { ReactNode } from 'react';

import AgentSyncBadge from './AgentSyncBadge';
import { AgentSyncState } from '@/lib/companion-agent-display';

type ExtraBadge = {
  label: string;
  tone?: 'emerald' | 'amber' | 'slate' | 'rose' | 'blue';
};

function extraBadgeClasses(tone: ExtraBadge['tone']) {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-500/15 text-emerald-200';
    case 'amber':
      return 'bg-amber-500/15 text-amber-200';
    case 'rose':
      return 'bg-rose-500/15 text-rose-200';
    case 'blue':
      return 'bg-blue-500/15 text-blue-200';
    default:
      return 'bg-white/10 text-white/65';
  }
}

export default function CompanionAgentSummary({
  title,
  model,
  workspacePath,
  openclawAgentId,
  syncState,
  extraBadges = [],
  children,
}: {
  title: string;
  model?: string | null;
  workspacePath?: string | null;
  openclawAgentId: string;
  syncState: AgentSyncState;
  extraBadges?: ExtraBadge[];
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{title}</div>
          <div className="mt-1 text-sm text-white/60">{model || 'model inconnu'}</div>
          <div className="mt-1 break-all text-xs text-white/40">
            Workspace OpenClaw: {workspacePath || 'non renseigné'}
          </div>
          <div className="mt-1 break-all text-xs text-white/40">OpenClaw ID: {openclawAgentId}</div>
        </div>
        <AgentSyncBadge state={syncState} />
      </div>

      {extraBadges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {extraBadges.map((badge) => (
            <span
              key={badge.label}
              className={`rounded-full px-2 py-1 ${extraBadgeClasses(badge.tone)}`}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 text-xs text-white/60">{syncState.detail}</div>

      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
