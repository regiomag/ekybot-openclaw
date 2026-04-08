/**
 * Setup Stripe Products & Prices for EkyBot
 * Run: npx tsx scripts/setup-stripe.ts
 */
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-04-30.basil' });

async function setup() {
  console.log('🔧 Creating Stripe products & prices for EkyBot...\n');

  // --- Starter ---
  const starter = await stripe.products.create({
    name: 'EkyBot Starter',
    description: '5 agents collaboratifs, dashboard coûts & tokens, support email',
    metadata: { plan: 'starter', agentLimit: '5' },
  });

  const starterMonthly = await stripe.prices.create({
    product: starter.id,
    unit_amount: 9800, // 98 CHF
    currency: 'chf',
    recurring: { interval: 'month' },
    lookup_key: 'starter_monthly',
  });

  const starterYearly = await stripe.prices.create({
    product: starter.id,
    unit_amount: 99960, // 83.30 * 12 = 999.60 CHF → arrondi 999.60
    currency: 'chf',
    recurring: { interval: 'year' },
    lookup_key: 'starter_yearly',
  });

  console.log(`✅ Starter product: ${starter.id}`);
  console.log(`   Monthly: ${starterMonthly.id} (98 CHF/mois)`);
  console.log(`   Yearly:  ${starterYearly.id} (999.60 CHF/an = 83.30/mois)\n`);

  // --- Pro ---
  const pro = await stripe.products.create({
    name: 'EkyBot Pro',
    description: '15 agents collaboratifs, roadmap & projets, budget par agent, API complète',
    metadata: { plan: 'pro', agentLimit: '15' },
  });

  const proMonthly = await stripe.prices.create({
    product: pro.id,
    unit_amount: 19800, // 198 CHF
    currency: 'chf',
    recurring: { interval: 'month' },
    lookup_key: 'pro_monthly',
  });

  const proYearly = await stripe.prices.create({
    product: pro.id,
    unit_amount: 201960, // 168.30 * 12 = 2019.60 CHF/an
    currency: 'chf',
    recurring: { interval: 'year' },
    lookup_key: 'pro_yearly',
  });

  console.log(`✅ Pro product: ${pro.id}`);
  console.log(`   Monthly: ${proMonthly.id} (198 CHF/mois)`);
  console.log(`   Yearly:  ${proYearly.id} (2019.60 CHF/an = 168.30/mois)\n`);

  console.log('📋 Add these to Vercel env vars:');
  console.log(`STRIPE_STARTER_MONTHLY_PRICE_ID=${starterMonthly.id}`);
  console.log(`STRIPE_STARTER_YEARLY_PRICE_ID=${starterYearly.id}`);
  console.log(`STRIPE_PRO_MONTHLY_PRICE_ID=${proMonthly.id}`);
  console.log(`STRIPE_PRO_YEARLY_PRICE_ID=${proYearly.id}`);
}

setup().catch(console.error);
