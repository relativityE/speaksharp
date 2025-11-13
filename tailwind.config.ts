/** @type {import('tailwindcss').Config} */
   export default {
     darkMode: ["class"],
     content: [
       "./src/**/*.{ts,tsx,js,jsx}",
       "./index.html",
     ],
     theme: {
       extend: {
         colors: {
           background: "hsl(var(--background))",
           foreground: "hsl(var(--foreground))",
         },
         borderColor: {
           DEFAULT: "hsl(var(--border))",
         },
       },
     },
     plugins: [require("tailwindcss-animate")],
   };
