const requiredPlans = [
  {
    label: 'Basic',
    envName: 'STRIPE_BASIC_PRICE_ID',
    expectedAmount: Number.parseInt(process.env.EXPECTED_STRIPE_BASIC_AMOUNT ?? '299', 10),
    expectedCurrency: process.env.EXPECTED_STRIPE_BASIC_CURRENCY ?? 'usd',
    expectedInterval: process.env.EXPECTED_STRIPE_BASIC_INTERVAL ?? 'month',
  },
  {
    label: 'Pro',
    envName: 'STRIPE_PRO_PRICE_ID',
    expectedAmount: Number.parseInt(process.env.EXPECTED_STRIPE_PRO_AMOUNT ?? '799', 10),
    expectedCurrency: process.env.EXPECTED_STRIPE_PRO_CURRENCY ?? 'usd',
    expectedInterval: process.env.EXPECTED_STRIPE_PRO_INTERVAL ?? 'month',
  },
];

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY is required for Stripe price audit.');
}

const redactPriceId = (priceId) => {
  if (!priceId || priceId.length <= 12) return priceId;
  return `${priceId.slice(0, 8)}...${priceId.slice(-6)}`;
};

const fetchStripeJson = async (path) => {
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

const results = [];
const failures = [];

for (const plan of requiredPlans) {
  const priceId = process.env[plan.envName];
  if (!priceId) {
    failures.push(`${plan.label}: missing ${plan.envName}`);
    continue;
  }

  const price = await fetchStripeJson(`prices/${encodeURIComponent(priceId)}?expand[]=product`);
  const product = typeof price.product === 'object' && price.product ? price.product : null;
  const result = {
    label: plan.label,
    priceId: redactPriceId(price.id),
    livemode: Boolean(price.livemode),
    active: Boolean(price.active),
    currency: price.currency,
    unitAmount: price.unit_amount,
    interval: price.recurring?.interval ?? null,
    productName: product?.name ?? null,
    productActive: product?.active ?? null,
  };

  results.push(result);

  if (!price.active) failures.push(`${plan.label}: price is inactive`);
  if (price.currency !== plan.expectedCurrency) {
    failures.push(`${plan.label}: expected currency ${plan.expectedCurrency}, got ${price.currency}`);
  }
  if (price.unit_amount !== plan.expectedAmount) {
    failures.push(`${plan.label}: expected amount ${plan.expectedAmount}, got ${price.unit_amount}`);
  }
  if (price.recurring?.interval !== plan.expectedInterval) {
    failures.push(`${plan.label}: expected interval ${plan.expectedInterval}, got ${price.recurring?.interval ?? 'none'}`);
  }
  if (product && product.active === false) failures.push(`${plan.label}: product is inactive`);
}

console.log(`STRIPE_PRICE_AUDIT_EVIDENCE ${JSON.stringify(results)}`);

if (failures.length > 0) {
  console.error(`STRIPE_PRICE_AUDIT_FAILURES ${JSON.stringify(failures)}`);
  process.exit(1);
}

console.log('Stripe price audit passed.');
