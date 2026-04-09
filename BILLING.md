# Billing & Subscription (Optional)

EkyBot's core functionality works **without any billing integration**.

The hosted version at [ekybot.com](https://www.ekybot.com) uses Stripe for subscription management.
The Stripe integration code (`/api/stripe/*`) has been **removed from the open source release**.

## Self-hosted: What this means for you

- ✅ All features work without Stripe
- ✅ No paywalls in the self-hosted version
- ✅ Agent limits, user limits, etc. are not enforced
- ⚠️ Some UI elements (pricing page, "Manage subscription" button) will show but the API calls will return 404 — this is harmless

## If you want to add billing

You can implement your own billing by:
1. Creating `/api/stripe/` routes (checkout, subscription, portal, webhook)
2. Setting the `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` env vars
3. Creating products/prices in your Stripe dashboard

The UI components are already wired to call these endpoints.
