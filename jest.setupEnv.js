import dotenv from 'dotenv';
dotenv.config({ path: './.env.test' });

// Manually define import.meta.env for Jest
if (typeof import.meta === 'undefined') {
  Object.defineProperty(global, 'import', {
    value: {
      meta: {
        env: process.env,
      },
    },
    writable: true,
  });
}
