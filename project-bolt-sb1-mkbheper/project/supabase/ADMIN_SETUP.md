# Legacy Supabase reference

The Supabase migrations and Edge Functions in this directory are retained as historical source material for the MySQL port. They are not part of the current application runtime and must not be deployed for this build.

Use the PHP/MySQL backend in [`../cpanel/`](../cpanel/) for cPanel deployment. Import [`../cpanel/database/schema.sql`](../cpanel/database/schema.sql), configure `cpanel/config.php`, and deploy the Vite `dist/` files with the provided Apache rewrite rules.
