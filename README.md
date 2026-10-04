# CiviFix MVP starter

A small React + TypeScript + Vite prototype for the CiviFix workflow: citizen reports, ward queue, supervisor status updates, resident follow-up, and a ward summary.

## Run locally

1. Install Node.js (LTS).
2. Open a terminal in this `civifix` folder.
3. Run `npm install`.
4. Run `npm run dev` and open the local URL Vite prints.

## Demo behavior and limitations

- Reports are kept in this browser's `localStorage`; there is no shared server/database yet.
- The report form, supervisor dashboard, and ward summary are one interface for presentation. The sidebar lets you switch between views.
- `src/lib/ward.ts` contains an illustrative coordinate range, not a real ward boundary. Replace it with authoritative ward polygons and point-in-polygon lookup before real routing.
- The service targets are illustrative. Confirm service standards with the relevant authority before presenting them as commitments.
- No AI verification or municipal integration is implemented. The supervisor workflow is the human review step; AI can be added later to suggest a category or flag possible duplicates.
- Uploaded demo images use a temporary browser URL and will not persist after refresh. Supabase Storage can replace this when you connect a backend.
- This is a presentation prototype, not a public production service. Add authentication, database access policies, privacy controls, moderation, and audit history before real deployment.

## Structure

```text
civifix/
  src/
    components/StatusBadge.tsx
    data/demo.ts
    lib/storage.ts
    lib/ward.ts
    types.ts
    App.tsx
    main.tsx
    styles.css
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  supabase/schema.sql
  supabase/storage.sql
```

## Supabase database setup

The starter schema is in `supabase/schema.sql`. In the Supabase dashboard for `civifix-dev`, open SQL Editor, paste the file contents, and run it once. It creates the starter tables and role-aware row-level security policies. The policies expect signed-in users; the current browser-only demo has not been connected to Supabase Auth yet.

## Connect the local app to Supabase

1. Copy `.env.example` to `.env.local` in the project root.
2. In `.env.local`, set `VITE_SUPABASE_URL` to the Project URL and `VITE_SUPABASE_PUBLISHABLE_KEY` to the publishable key (or legacy `anon` key) from the Supabase dashboard.
3. Save the file and restart the Vite dev server.

Never put a `service_role` or secret key in a `VITE_` variable. The Supabase client helper is `src/lib/supabase.ts`. The current report screens still use browser storage until the authentication and database connection steps are implemented.

The sign-in and account creation screen uses Supabase Auth. New accounts receive the `citizen` role through the profile trigger in `supabase/schema.sql`. New report submissions and the signed-in user's report list use the `reports` table through `src/lib/reports.ts`. Run `supabase/storage.sql` after `schema.sql` to create a private image bucket and its access policies. Status edits are not yet persisted to Supabase.

## Suggested implementation sequence after the demo

1. Add Supabase Auth and roles for citizen, ward supervisor, and senior officer.
2. Create `wards`, `profiles`, `reports`, and `report_updates` tables and apply row-level security.
3. Upload photos to private/object storage; store the object path on each report.
4. Replace the demo ward resolver with verified ward polygons and confirm out-of-area handling.
5. Add escalation rules, notification delivery, and immutable status history.
6. Add AI only as a review aid; retain a human decision for validity and closure.
