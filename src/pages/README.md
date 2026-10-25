# Page organization

- `login/LoginPage.tsx`: sign-in / registration entry screen.
- `AppPage.tsx`: authenticated application shell and page-state router. URL paths are `/page/home`, `/page/search`, `/page/create`, `/page/notifications`, and `/page/profile`.
- `home/`, `search/`, `create/`, `notifications/`, `profile/`: reserved page-specific modules for continued extraction from the shell as each view grows.

Reusable UI belongs in `src/components/`; API calls and upload handling belong in `src/lib/`; schema, database and authorization belong in `server/`.
