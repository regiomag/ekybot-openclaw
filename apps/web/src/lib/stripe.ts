import Stripe from 'stripe';
import { getBaseLimits } from './plan-limits';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY.trim(), {
      typescript: true,
      maxNetworkRetries: 3,
      timeout: 25000,
      telemetry: false,
      httpClient: Stripe.createFetchHttpClient(), // Use fetch instead of node:http (fixes Vercel serverless)
    });
  }
  return _stripe;
}

// Plan configuration
export const PLANS = {
  starter: {
    name: 'Starter',
    monthlyPrice: 9800,  // 98 CHF
    yearlyPrice: 99600,  // 83 CHF/mo
    agentLimit: 10,
    userLimit: 1,
    channelLimit: -1, // unlimited
  },
  pro: {
    name: 'Pro',
    monthlyPrice: 19800, // 198 CHF
    yearlyPrice: 201600, // 168 CHF/mo
    agentLimit: 20,
    userLimit: 3,
    channelLimit: -1, // unlimited
  },
  team: {
    name: 'Team',
    monthlyPrice: 29800, // 298 CHF
    yearlyPrice: 303600, // 253 CHF/mo
    agentLimit: 50,
    userLimit: 15,
    channelLimit: -1,
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function getPlanLimits(plan: string) {
  return getBaseLimits(plan);
}
