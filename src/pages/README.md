# Pages

One screen = one folder = one `.tsx` file. Find a screen by its URL:

| URL | File |
|---|---|
| `/page/login` (signed out) | `login/LoginPage.tsx` |
| `/page/home` | `home/HomePage.tsx` |
| `/page/search` | `search/SearchPage.tsx` |
| `/page/create` | `create/CreatePage.tsx` |
| `/page/notifications` | `notifications/NotificationsPage.tsx` |
| `/page/profile` | `profile/ProfilePage.tsx` (edit form: `profile/ProfileEditForm.tsx`) |
| `/page/post/:id` | `post/PostDetailPage.tsx` |
| `/page/post/:id/image` | `post/ImageDetailPage.tsx` |

- `AppPage.tsx`: the signed-in shell. Owns the shared state (user, feed, profile, notifications), the data calls, and the route switch. Pages receive data and callbacks as props.
- `profile/profileForm.ts`: profile form type and blank values shared by the profile page and `AppPage.tsx`.
- `post/useFetchedPost.ts`: loads a single post; shared by the detail and image pages.

Where other code goes:
- Layout chrome (top bar, side nav, bottom nav, right rail, notice banner): `src/components/layout/`
- Reusable UI (avatar, post card, composer, relations modal): `src/components/`
- Route paths and tab titles: `src/lib/route.ts`
- API calls and image resizing: `src/lib/api.ts`, `src/lib/images.ts`; error text helper: `src/lib/errors.ts`
- Schema, database and authorization: `server/`

Adding a screen: create `pages/<name>/<Name>Page.tsx`, add its tab to `TABS` / `TAB_TITLES` in `lib/route.ts`, and render it in `AppPage.tsx`.
