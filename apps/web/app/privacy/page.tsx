import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - Ekybot',
  description: 'Privacy Policy / Politique de confidentialité / Datenschutzrichtlinie',
};

const content = {
  fr: {
    title: 'Politique de Confidentialité',
    updated: 'Dernière mise à jour : 28 février 2026',
    sections: [
      {
        title: '1. Introduction',
        text: `Ekybot ("nous", "notre", "l'application") s'engage à protéger votre vie privée. Cette politique de confidentialité explique comment nous collectons, utilisons et protégeons vos données lorsque vous utilisez notre application.`,
      },
      {
        title: '2. Données collectées',
        text: 'Nous collectons les données suivantes :',
        items: [
          'Informations de compte : Email, nom (via Clerk pour l\'authentification)',
          'Conversations : Messages échangés avec les agents IA (si vous activez la sauvegarde)',
          'Données d\'utilisation : Statistiques de coûts, nombre de tokens utilisés',
          'Images : Images envoyées dans le chat (traitées puis supprimées)',
        ],
      },
      {
        title: '3. Utilisation des données',
        text: 'Vos données sont utilisées pour :',
        items: [
          'Fournir le service de chat IA multi-agents',
          'Sauvegarder vos conversations (optionnel, contrôlé par vous)',
          'Calculer et afficher vos statistiques d\'utilisation et coûts',
          'Améliorer notre service',
        ],
      },
      {
        title: '4. Partage des données',
        text: 'Nous partageons vos données uniquement avec :',
        items: [
          'Fournisseurs IA : Vos messages sont envoyés aux APIs (Anthropic, OpenAI, Google) pour générer les réponses — selon le modèle que vous choisissez',
          'Clerk : Pour l\'authentification sécurisée',
          'Supabase : Pour le stockage sécurisé des données',
          'Stripe : Pour le traitement sécurisé des paiements',
        ],
        after: 'Nous ne vendons jamais vos données personnelles à des tiers.',
      },
      {
        title: '5. Hébergement et sécurité',
        text: `Vos données sont hébergées en Suisse et en Europe. Nous utilisons des mesures de sécurité standard de l'industrie : chiffrement HTTPS, chiffrement AES-256-GCM pour les clés API, Row Level Security (RLS) sur toutes les tables de la base de données.`,
      },
      {
        title: '6. Vos droits',
        text: 'Conformément au RGPD et à la LPD suisse, vous avez le droit de :',
        items: [
          'Accéder à vos données personnelles',
          'Supprimer vos conversations à tout moment',
          'Supprimer votre compte et toutes les données associées',
          'Exporter vos données',
          'Désactiver la sauvegarde des conversations',
        ],
      },
      {
        title: '7. Conservation des données',
        text: `Vos données sont conservées tant que votre compte est actif. Vous pouvez supprimer vos conversations à tout moment. Lors de la suppression de votre compte, toutes vos données sont définitivement effacées sous 30 jours.`,
      },
      {
        title: '8. Cookies',
        text: `Nous utilisons uniquement des cookies essentiels pour l'authentification et le fonctionnement de l'application. Aucun cookie publicitaire ou de tracking tiers n'est utilisé.`,
      },
      {
        title: '9. Modifications',
        text: `Nous pouvons mettre à jour cette politique de confidentialité. Les modifications seront publiées sur cette page avec une nouvelle date de mise à jour.`,
      },
      {
        title: '10. Contact',
        text: 'Pour toute question concernant cette politique de confidentialité :',
        contact: 'contact@ekybot.com',
      },
    ],
    back: '← Retour à l\'accueil',
    langSwitch: 'Also available in:',
  },
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: February 28, 2026',
    sections: [
      {
        title: '1. Introduction',
        text: `Ekybot ("we", "our", "the application") is committed to protecting your privacy. This privacy policy explains how we collect, use, and protect your data when you use our application.`,
      },
      {
        title: '2. Data Collected',
        text: 'We collect the following data:',
        items: [
          'Account information: Email, name (via Clerk for authentication)',
          'Conversations: Messages exchanged with AI agents (if you enable saving)',
          'Usage data: Cost statistics, number of tokens used',
          'Images: Images sent in chat (processed then deleted)',
        ],
      },
      {
        title: '3. Use of Data',
        text: 'Your data is used to:',
        items: [
          'Provide the multi-agent AI chat service',
          'Save your conversations (optional, controlled by you)',
          'Calculate and display your usage statistics and costs',
          'Improve our service',
        ],
      },
      {
        title: '4. Data Sharing',
        text: 'We share your data only with:',
        items: [
          'AI providers: Your messages are sent to APIs (Anthropic, OpenAI, Google) to generate responses — depending on the model you choose',
          'Clerk: For secure authentication',
          'Supabase: For secure data storage',
          'Stripe: For secure payment processing',
        ],
        after: 'We never sell your personal data to third parties.',
      },
      {
        title: '5. Hosting and Security',
        text: `Your data is hosted in Switzerland and Europe. We use industry-standard security measures: HTTPS encryption, AES-256-GCM encryption for API keys, Row Level Security (RLS) on all database tables.`,
      },
      {
        title: '6. Your Rights',
        text: 'In accordance with GDPR and the Swiss DPA, you have the right to:',
        items: [
          'Access your personal data',
          'Delete your conversations at any time',
          'Delete your account and all associated data',
          'Export your data',
          'Disable conversation saving',
        ],
      },
      {
        title: '7. Data Retention',
        text: `Your data is retained as long as your account is active. You can delete your conversations at any time. When you delete your account, all your data is permanently erased within 30 days.`,
      },
      {
        title: '8. Cookies',
        text: `We only use essential cookies for authentication and application functionality. No advertising or third-party tracking cookies are used.`,
      },
      {
        title: '9. Changes',
        text: `We may update this privacy policy. Changes will be posted on this page with a new update date.`,
      },
      {
        title: '10. Contact',
        text: 'For any questions regarding this privacy policy:',
        contact: 'contact@ekybot.com',
      },
    ],
    back: '← Back to home',
    langSwitch: 'Also available in:',
  },
  de: {
    title: 'Datenschutzrichtlinie',
    updated: 'Letzte Aktualisierung: 28. Februar 2026',
    sections: [
      {
        title: '1. Einleitung',
        text: `Ekybot ("wir", "unser", "die Anwendung") verpflichtet sich, Ihre Privatsphäre zu schützen. Diese Datenschutzrichtlinie erklärt, wie wir Ihre Daten erfassen, verwenden und schützen, wenn Sie unsere Anwendung nutzen.`,
      },
      {
        title: '2. Erfasste Daten',
        text: 'Wir erfassen folgende Daten:',
        items: [
          'Kontoinformationen: E-Mail, Name (über Clerk zur Authentifizierung)',
          'Konversationen: Mit KI-Agenten ausgetauschte Nachrichten (wenn Sie die Speicherung aktivieren)',
          'Nutzungsdaten: Kostenstatistiken, Anzahl verwendeter Tokens',
          'Bilder: Im Chat gesendete Bilder (verarbeitet und dann gelöscht)',
        ],
      },
      {
        title: '3. Verwendung der Daten',
        text: 'Ihre Daten werden verwendet für:',
        items: [
          'Bereitstellung des Multi-Agenten-KI-Chat-Dienstes',
          'Speicherung Ihrer Konversationen (optional, von Ihnen gesteuert)',
          'Berechnung und Anzeige Ihrer Nutzungsstatistiken und Kosten',
          'Verbesserung unseres Dienstes',
        ],
      },
      {
        title: '4. Datenweitergabe',
        text: 'Wir teilen Ihre Daten nur mit:',
        items: [
          'KI-Anbieter: Ihre Nachrichten werden an APIs (Anthropic, OpenAI, Google) gesendet, um Antworten zu generieren — je nach gewähltem Modell',
          'Clerk: Für sichere Authentifizierung',
          'Supabase: Für sichere Datenspeicherung',
          'Stripe: Für sichere Zahlungsabwicklung',
        ],
        after: 'Wir verkaufen Ihre persönlichen Daten niemals an Dritte.',
      },
      {
        title: '5. Hosting und Sicherheit',
        text: `Ihre Daten werden in der Schweiz und in Europa gehostet. Wir verwenden branchenübliche Sicherheitsmassnahmen: HTTPS-Verschlüsselung, AES-256-GCM-Verschlüsselung für API-Schlüssel, Row Level Security (RLS) auf allen Datenbanktabellen.`,
      },
      {
        title: '6. Ihre Rechte',
        text: 'Gemäss DSGVO und dem Schweizer DSG haben Sie das Recht:',
        items: [
          'Auf Ihre persönlichen Daten zuzugreifen',
          'Ihre Konversationen jederzeit zu löschen',
          'Ihr Konto und alle zugehörigen Daten zu löschen',
          'Ihre Daten zu exportieren',
          'Die Speicherung von Konversationen zu deaktivieren',
        ],
      },
      {
        title: '7. Datenaufbewahrung',
        text: `Ihre Daten werden aufbewahrt, solange Ihr Konto aktiv ist. Sie können Ihre Konversationen jederzeit löschen. Bei Löschung Ihres Kontos werden alle Ihre Daten innerhalb von 30 Tagen endgültig gelöscht.`,
      },
      {
        title: '8. Cookies',
        text: `Wir verwenden ausschliesslich essenzielle Cookies für die Authentifizierung und den Betrieb der Anwendung. Es werden keine Werbe- oder Tracking-Cookies von Drittanbietern verwendet.`,
      },
      {
        title: '9. Änderungen',
        text: `Wir können diese Datenschutzrichtlinie aktualisieren. Änderungen werden auf dieser Seite mit einem neuen Aktualisierungsdatum veröffentlicht.`,
      },
      {
        title: '10. Kontakt',
        text: 'Bei Fragen zu dieser Datenschutzrichtlinie:',
        contact: 'contact@ekybot.com',
      },
    ],
    back: '← Zurück zur Startseite',
    langSwitch: 'Also available in:',
  },
};

type Lang = 'fr' | 'en' | 'de';
type Section = {
  title: string;
  text: string;
  items?: string[];
  after?: string;
  contact?: string;
};

function PrivacyContent({ lang }: { lang: Lang }) {
  const c = content[lang];
  const otherLangs = (['fr', 'en', 'de'] as Lang[]).filter((l) => l !== lang);
  const langNames: Record<Lang, string> = { fr: 'Français', en: 'English', de: 'Deutsch' };

  return (
    <div id={`privacy-${lang}`}>
      <h1 className="text-3xl font-bold mb-4">{c.title}</h1>
      <p className="text-gray-400 mb-2">{c.updated}</p>
      <p className="text-gray-500 text-sm mb-8">
        {otherLangs.map((l, i) => (
          <span key={l}>
            {i > 0 && ' · '}
            <a href={`#privacy-${l}`} className="text-blue-400 hover:underline">
              {langNames[l]}
            </a>
          </span>
        ))}
      </p>

      <div className="space-y-8 text-gray-300">
        {c.sections.map((s: Section) => (
          <section key={s.title}>
            <h2 className="text-xl font-semibold text-white mb-4">{s.title}</h2>
            <p className="mb-4">{s.text}</p>
            {s.items && (
              <ul className="list-disc pl-6 space-y-2">
                {s.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
            {s.after && <p className="mt-4">{s.after}</p>}
            {s.contact && (
              <p className="mt-2">
                <a href={`mailto:${s.contact}`} className="text-blue-400 hover:underline">
                  {s.contact}
                </a>
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <PrivacyContent lang="fr" />

        <hr className="my-16 border-gray-800" />
        <PrivacyContent lang="en" />

        <hr className="my-16 border-gray-800" />
        <PrivacyContent lang="de" />

        <div className="mt-12 pt-8 border-t border-gray-800">
          <a href="/" className="text-blue-400 hover:underline">
            ← ekybot.com
          </a>
        </div>
      </div>
    </div>
  );
}
