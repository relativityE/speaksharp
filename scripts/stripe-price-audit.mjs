import { pathToFileURL } from 'node:url';

export const LAUNCH_PRICE = Object.freeze({
  amount: 1000,
  currency: 'usd',
  interval: 'month',
  intervalCount: 1,
});

const redactPriceId = (priceId) => {
  if (!priceId || priceId.length <= 12) return priceId;
  return `${priceId.slice(0, 8)}...${priceId.slice(-6)}`;
};

const fetchStripeJson = async (path, stripeSecretKey) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Stripe API request failed for ${path}: ${response.status} ${body?.error?.message ?? response.statusText}`);
  }

  return body;
};

export function validateLaunchPrice(price) {
  const product = typeof price.product === 'object' && price.product ? price.product : null;
  const failures = [];
  const result = {
    label: 'SpeakSharp',
    priceId: redactPriceId(price.id),
    livemode: Boolean(price.livemode),
    active: Boolean(price.active),
    currency: price.currency,
    unitAmount: price.unit_amount,
    interval: price.recurring?.interval ?? null,
    intervalCount: price.recurring?.interval_count ?? null,
    nickname: price.nickname ?? null,
    lookupKey: price.lookup_key ?? null,
    productName: product?.name ?? null,
    productDescription: product?.description ?? null,
    productMetadata: product?.metadata ?? null,
    productActive: product?.active ?? null,
  };

  if (!price.active) failures.push('SpeakSharp: price is inactive');
  if (price.currency !== LAUNCH_PRICE.currency) {
    failures.push(`SpeakSharp: expected currency ${LAUNCH_PRICE.currency}, got ${price.currency}`);
  }
  if (price.unit_amount !== LAUNCH_PRICE.amount) {
    failures.push(`SpeakSharp: expected amount ${LAUNCH_PRICE.amount}, got ${price.unit_amount}`);
  }
  if (price.recurring?.interval !== LAUNCH_PRICE.interval) {
    failures.push(`SpeakSharp: expected interval ${LAUNCH_PRICE.interval}, got ${price.recurring?.interval ?? 'none'}`);
  }
  if (price.recurring?.interval_count !== LAUNCH_PRICE.intervalCount) {
    failures.push(`SpeakSharp: expected interval_count ${LAUNCH_PRICE.intervalCount}, got ${price.recurring?.interval_count ?? 'none'}`);
  }
  if (product && product.active === false) failures.push('SpeakSharp: product is inactive');

  return { result, failures };
}

export async function runStripePriceAudit(env = process.env) {
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  const priceId = env.STRIPE_PRO_PRICE_ID;
  if (!stripeSecretKey) throw new Error('STRIPE_SECRET_KEY is required for Stripe price audit.');
  if (!priceId) throw new Error('STRIPE_PRO_PRICE_ID is required for the single launch product.');

  const price = await fetchStripeJson(`prices/${encodeURIComponent(priceId)}?expand[]=product`, stripeSecretKey);
  const { result, failures } = validateLaunchPrice(price);
  console.log(`STRIPE_PRICE_AUDIT_EVIDENCE ${JSON.stringify([result])}`);

  if (failures.length > 0) {
    console.error(`STRIPE_PRICE_AUDIT_FAILURES ${JSON.stringify(failures)}`);
    process.exitCode = 1;
    return false;
  }

  console.log('Stripe price audit passed.');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runStripePriceAudit();
}
