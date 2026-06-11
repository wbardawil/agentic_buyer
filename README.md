# compras-agent

Demo-grade AI buying agent (spec.md). Multilingual es/en/pt, multi-currency (MXN first),
deterministic policy/scoring/savings engines, Claude API for parsing and prose only.

## Setup & Deploy

1. **Environment** — create `.env.local` (and the same three vars in Vercel → Project → Settings → Environment Variables):

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```

2. **Database** — paste `supabase/migrations/0001_init.sql` into the Supabase SQL editor and run it once.

3. **Seed** — `npm run seed` (idempotent; re-run any time to reset demo data; audit rows survive by design).

4. **Run** — `npm run dev`, or deploy with `vercel --prod`. The demo walkthrough is in `docs/demo-script.md`.

`npm test` runs the unit suites for the deterministic services and the agent JSON helper.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
