# Portfolio Tracker — app shell

Static PWA shell, published to GitHub Pages. No portfolio data lives here —
sign-in is required (email code; signup is allowlist-gated server-side) and
all data access is enforced by owner-only row-level security in a private
Supabase backend. The Supabase publishable key in cloud.js is public by
design; it grants nothing beyond what RLS permits to the signed-in user.

Install on a phone: open this repo's GitHub Pages URL in the browser, sign
in, then Share → "Add to Home Screen".

Generated from the private portfolio-tracker repo via tools/publish_shell.py.
