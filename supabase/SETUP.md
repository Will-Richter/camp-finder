# Switching on accounts and sharing

Camp Finder uses Supabase (a hosted database with sign-in) for accounts, shared camps, "still free?" check-ins and synced trip bookings. The free plan covers testing and early users.

1. Sign up at supabase.com and create a project. Name it `camp-finder`, choose the **Sydney** region, and save the database password somewhere safe.
2. **SQL Editor > New query**: paste everything from `supabase/schema.sql` and press **Run**. This creates the tables, the security rules and the photo storage.
3. **Authentication > Sign In / Providers > Email**: keep Email on and turn **Confirm email** on.
4. **Authentication > Email Templates > Magic Link**: replace the body so it sends a code, for example:
   `Your Camp Finder code is {{ .Token }}. It expires in 1 hour.`
5. **Authentication > SMTP settings**: before launch, connect a sending service (for example Resend or Postmark). Supabase's built-in email is limited to a few emails an hour.
6. **Project settings > API**: copy the **Project URL** and the **anon public** key into `docs/cloud.js` (`SUPABASE_URL` and `SUPABASE_ANON_KEY`), then copy `docs` into `ios-native/CampFinder/web` again.

The anon key is meant to be in the app. Security comes from the row level security rules in `schema.sql`: people can only change their own camps, check-ins and trip notes, trip notes are private, and a camp with 3 reports is hidden automatically. Never put the `service_role` key in the app.
