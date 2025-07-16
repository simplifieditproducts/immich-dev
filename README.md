Steps to run development server locally on a Unix-based computer:
1. Clone this repo: `git clone https://github.com/simplifieditproducts/immich-dev`
2. Navigate to project root directory: `cd immich-dev`
3. Check out `custom-patch` branch: `git checkout custom-patch` (our customizations should be made on `custom-patch` branch and then rebased onto `main` branch)
4. Create the necessary `.env` file: `cp docker/local-template.env docker/.env`
5. Start the dev server using the provided Makefile: `make dev`
6. Access the instance in your web browser by using `http://localhost:3000` or `http://your-machine-ip:3000`

Other possibly useful commands:
- To delete Immich in Terminal, go to `/immich-dev/docker` and run `docker compose -f docker-compose.yml down -v`
- To stage a list of all our customizations since the original forked Immich commit: `git checkout 58ae77ec9204a2e43a8cb2f1fd27482af40d0891 -- .`

Image assets are stored in various locations within the codebase:
- The `web/src/lib/assets/` directory stores assets that are importable into Svelte. Changing any of these assets requires restarting the Docker container.
- The `web/static` directory stores static assets that are served with no processing. These are unavailable to Svelte.
- The `design` directory stores images used in `README` files.
- The `@immich/ui` Node module stores some assets internally.

Useful info:
- To get a user's admin status, add `import { user } from '$lib/stores/user.store';` and then use `$user.isAdmin`. 

These are various important files in the codebase:
- `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` is the main photo viewer UI.
- `web/src/lib/utils/auth.ts` checks if user is already logged in, and redirect to Login page if not.
- `web/src/routes/auth/login/+page.svelte` handles the login logic.
- `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte` is the search results UI.
- `web/src/routes/+page.ts` is the default route page. It displays a "Welcome to Immich" message for first-time users, or redirects to the Login or Photos page for existing users.
- `web/src/lib/stores/user.store.ts` stores the active user and its preferences, and also contains a method for clearing them.
- `web/src/lib/components/user-settings-page/user-settings-list.svelte` defines the Settings UI.
- `web/src/lib/components/shared-components/navigation-bar/navigation-bar.svelte` defines the top bar that contains the Profile icon, Search bar, and more.
- 