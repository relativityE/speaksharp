const normalizeDomain = (value) => value.trim().toLowerCase().replace(/^@/, '');
const belongsToDomain = (email, domain) => typeof email === 'string'
  && email.trim().toLowerCase().endsWith(`@${domain}`);

export async function listDomainAuthUsers(admin, rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!domain || domain.includes('/') || domain.includes(' ')) throw new Error('invalid identity domain');
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error('Supabase auth inventory failed');
    const batch = data?.users ?? [];
    users.push(...batch.filter((user) => belongsToDomain(user.email, domain)));
    if (batch.length < 200) break;
  }
  return users;
}

async function stripeGet(fetchFn, secretKey, path, params) {
  const query = new URLSearchParams(params).toString();
  const response = await fetchFn(`https://api.stripe.com/v1/${path}?${query}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) throw new Error(`Stripe read-only inventory failed [${response.status}]`);
  return response.json();
}

export async function searchDomainStripeCustomers(fetchFn, secretKey, rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!secretKey) throw new Error('Stripe read-only credential missing');
  const customers = [];
  let page;
  do {
    const data = await stripeGet(fetchFn, secretKey, 'customers/search', {
      query: `email~'@${domain}'`,
      limit: '100',
      ...(page ? { page } : {}),
    });
    customers.push(...(data.data ?? []).filter((customer) => belongsToDomain(customer.email, domain)));
    page = data.has_more ? data.next_page : undefined;
    if (data.has_more && !page) throw new Error('Stripe customer inventory pagination was ambiguous');
  } while (page);
  return customers;
}

export async function inventoryUnaffiliatedIdentities({ admin, fetchFn, stripeSecretKey, domain }) {
  const authUsers = await listDomainAuthUsers(admin, domain);
  const authIds = authUsers.map((user) => user.id).filter(Boolean);
  let profiles = [];
  if (authIds.length > 0) {
    const { data, error } = await admin
      .from('user_profiles')
      .select('id,stripe_customer_id,stripe_subscription_id')
      .in('id', authIds);
    if (error) throw new Error('Supabase profile inventory failed');
    profiles = data ?? [];
  }

  const stripeCustomers = await searchDomainStripeCustomers(fetchFn, stripeSecretKey, domain);
  let stripeSubscriptionCount = 0;
  for (const customer of stripeCustomers) {
    const subscriptions = await stripeGet(fetchFn, stripeSecretKey, 'subscriptions', {
      customer: customer.id,
      status: 'all',
      limit: '100',
    });
    stripeSubscriptionCount += subscriptions.data?.length ?? 0;
    if (subscriptions.has_more) throw new Error('Stripe subscription inventory exceeded one read-only page');
  }

  const boundCustomers = new Set(profiles.map((profile) => profile.stripe_customer_id).filter(Boolean));
  const stripeCustomerIds = new Set(stripeCustomers.map((customer) => customer.id).filter(Boolean));
  return {
    domain: normalizeDomain(domain),
    supabase_auth_identities: authUsers.length,
    supabase_profiles: profiles.length,
    profiles_with_customer_binding: profiles.filter((profile) => profile.stripe_customer_id).length,
    profiles_with_subscription_binding: profiles.filter((profile) => profile.stripe_subscription_id).length,
    stripe_customers: stripeCustomers.length,
    stripe_subscriptions: stripeSubscriptionCount,
    cross_bound_customers: [...boundCustomers].filter((id) => stripeCustomerIds.has(id)).length,
    mutation_performed: false,
  };
}
