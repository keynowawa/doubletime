# doubletime pos: Supabase and Vercel setup

The customer website and POS stay in one GitHub repository but deploy as two separate Vercel projects. Both can reuse `public/assets`.

## 1. Create the Supabase project

1. Create a Supabase project named `doubletime-pos` in the Singapore region when available.
2. Apply `supabase/migrations/202607220001_doubletime_pos.sql` using the Supabase SQL editor or CLI.
3. Deploy the `invite-staff` Edge Function from `supabase/functions/invite-staff`.
4. In Authentication settings, disable public user registration.
5. Set the Site URL to the POS production URL and allow the local and Vercel preview URLs as redirects.

The migration creates:

- one DoubleTime business workspace;
- owner and staff profiles;
- shared products, add-ons, price lists, settings, and orders;
- atomic order numbering for multiple iPads;
- hashed manager PIN verification;
- row-level database security;
- a product-image storage bucket;
- realtime updates between signed-in devices.

## 2. Create the owner

In Supabase, open **Authentication → Users → Add user → Send invitation** and invite:

`doubletime.ph@gmail.com`

The database automatically assigns this email the owner role. The owner can sell normally and can also access reports, exports, products, pricing, tax, the manager PIN, and staff invitations.

## 3. Connect local development

Create `.env.local` from `.env.example` using only:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

The publishable key is intended for web clients. Never place a Supabase secret key in `.env.local`, Vercel frontend variables, Git, or browser code.

## 4. Keep the customer website deployment

The existing Vercel project continues using:

- Build command: `npm run build`
- Output directory: `dist`

`npm run build` now produces only the customer website. It does not publish the POS route.

## 5. Create the separate POS deployment

Create a second Vercel project from the same GitHub repository:

- Project name: `doubletime-pos`
- Build command: `npm run build:pos`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`

The POS build opens at the root of its own Vercel domain. After testing, connect `pos.doubletime.ph` to this project.

## 6. Staff and iPad access

1. The owner signs in and opens **Settings → Team access**.
2. The owner enters a staff name and email and sends an invitation.
3. Staff use the emailed link to activate their account.
4. On each iPad, open the POS URL in Safari and sign in with that person's email.
5. Use **Share → Add to Home Screen**.

Every authorized iPad reads the same Supabase records. Orders created online receive a final sequential number from the database. Orders created while offline remain queued on that iPad and receive their final number when the connection returns.
