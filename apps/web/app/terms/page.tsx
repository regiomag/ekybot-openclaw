import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service - Ekybot',
  description: 'Conditions d\'utilisation de Ekybot',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-8">Conditions d&apos;Utilisation</h1>
        <p className="text-gray-400 mb-8">Dernière mise à jour : 8 février 2026</p>
        
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-xl font-semibold text-white mb-4">1. Acceptation des conditions</h2>
            <p>
              En utilisant Ekybot, vous acceptez ces conditions d&apos;utilisation. 
              Si vous n&apos;acceptez pas ces conditions, veuillez ne pas utiliser l&apos;application.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">2. Description du service</h2>
            <p>
              Ekybot est une application de chat alimentée par l&apos;intelligence artificielle (Claude par Anthropic). 
              Le service permet de converser avec un assistant IA, d&apos;organiser vos conversations en channels, 
              et de suivre vos coûts d&apos;utilisation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">3. Inscription et compte</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Vous devez fournir des informations exactes lors de l&apos;inscription</li>
              <li>Vous êtes responsable de la sécurité de votre compte</li>
              <li>Vous devez avoir au moins 13 ans pour utiliser le service</li>
              <li>Un compte par personne</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">4. Utilisation acceptable</h2>
            <p className="mb-4">Vous vous engagez à ne pas utiliser Ekybot pour :</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Générer du contenu illégal, haineux ou nuisible</li>
              <li>Harceler, menacer ou nuire à autrui</li>
              <li>Violer les droits de propriété intellectuelle</li>
              <li>Tenter de contourner les mesures de sécurité</li>
              <li>Utiliser le service à des fins automatisées/bot sans autorisation</li>
              <li>Générer du spam ou du contenu trompeur</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">5. Contenu généré par l&apos;IA</h2>
            <p className="mb-4">
              Les réponses de l&apos;IA sont générées automatiquement et peuvent contenir des erreurs. 
              Vous comprenez que :
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>L&apos;IA peut produire des informations inexactes ou obsolètes</li>
              <li>Vous êtes responsable de vérifier les informations importantes</li>
              <li>L&apos;IA ne remplace pas un avis professionnel (médical, juridique, financier, etc.)</li>
              <li>Nous ne garantissons pas l&apos;exactitude des réponses</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">6. Propriété intellectuelle</h2>
            <p>
              L&apos;application Ekybot, son code, son design et sa marque sont notre propriété. 
              Le contenu que vous créez (vos messages) vous appartient. 
              En utilisant le service, vous nous accordez une licence limitée pour traiter vos données 
              afin de fournir le service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">7. Tarification</h2>
            <p>
              Ekybot peut proposer des fonctionnalités gratuites et payantes. 
              Les tarifs sont affichés dans l&apos;application. 
              Nous nous réservons le droit de modifier les tarifs avec un préavis raisonnable.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">8. Disponibilité du service</h2>
            <p>
              Nous nous efforçons de maintenir le service disponible 24/7, mais ne garantissons pas 
              une disponibilité ininterrompue. Des maintenances et interruptions peuvent survenir.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">9. Limitation de responsabilité</h2>
            <p>
              Dans la limite permise par la loi, Ekybot est fourni &quot;tel quel&quot;. 
              Nous ne sommes pas responsables des dommages indirects, pertes de données, 
              ou pertes financières résultant de l&apos;utilisation du service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">10. Résiliation</h2>
            <p>
              Vous pouvez supprimer votre compte à tout moment. 
              Nous pouvons suspendre ou résilier votre accès en cas de violation de ces conditions, 
              avec ou sans préavis selon la gravité.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">11. Modifications</h2>
            <p>
              Nous pouvons modifier ces conditions. Les changements significatifs seront notifiés. 
              L&apos;utilisation continue du service après modification vaut acceptation des nouvelles conditions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">12. Droit applicable</h2>
            <p>
              Ces conditions sont régies par le droit suisse. 
              Tout litige sera soumis aux tribunaux compétents de Fribourg, Suisse.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">13. Contact</h2>
            <p>
              Pour toute question concernant ces conditions, contactez-nous à :{' '}
              <a href="mailto:contact@ekybot.com" className="text-blue-400 hover:underline">
                contact@ekybot.com
              </a>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-800">
          <a href="/" className="text-blue-400 hover:underline">← Retour à l&apos;accueil</a>
        </div>
      </div>
    </div>
  );
}
