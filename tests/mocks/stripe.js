// Minimal stub for @stripe/stripe-js
export async function loadStripe() {
  return {
    // stub redirectToCheckout to be a no-op
    redirectToCheckout: async (options) => {
      console.log('redirectToCheckout called', options);
      return { error: null };
    },
    // add any other methods your app calls
    elements: () => ({
      create: () => ({ mount: () => {} }),
    }),
  };
}
