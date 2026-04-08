import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OpenClaw — Agents IA Open Source pour Entreprises | EkyBot',
  description:
    'Découvrez comment OpenClaw, combiné à EkyBot, révolutionne le pilotage d\'agents IA pour startups et entreprises : automatisation, productivité, contrôle & confidentialité. Multi-agents, self-hosted, personnalisable.',
  keywords: [
    'openclaw',
    'agents ia',
    'self-hosted ai',
    'orchestration ia',
    'ekybot',
    'automatisation entreprise',
    'multi agent platform',
    'open source ai',
    'agents ia entreprise',
  ],
  openGraph: {
    title: 'OpenClaw — Agents IA Open Source pour Entreprises',
    description:
      'La plateforme open-source pour activer, piloter et connecter des agents IA spécialisés sur votre propre infrastructure.',
    url: 'https://ekybot.com/openclaw',
    type: 'website',
  },
};

export default function OpenClawLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
