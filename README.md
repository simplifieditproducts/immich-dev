Steps to run development server on a Unix-based computer:

1) Clone this repo: `git clone https://github.com/simplifieditproducts/immich.git`
2) Navigate to project root directory: `cd immich`
2) Create the necessary `.env` file: `cp docker/example.env docker/.env`
3) Start the dev server using the provided Makefile: `make dev`
4) Access the instance in your web browser by using `http://localhost:3000` or `http://your-machine-ip:3000`

Official instructions [here](https://immich.app/docs/developer/setup).

Image assets are stored in various locations within the codebase:
- The `immich/web/src/lib/assets/` directory stores assets that are importable into Svelte. Changing any of these assets requires restarting the Docker container.
- The `immich/web/static` directory stores static assets that are served with no processing. These are unavailable to Svelte.
- The `immich/design` directory stores images used in `README` files.
- The `@immich/ui` Node module stores some assets internally. 

These are various important files in the codebase:
- `immich/web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` is the main photo viewer UI.
- `immich/web/src/lib/utils/auth.ts` checks if user is already logged in, and redirect to Login page if not.
- `immich/web/src/routes/auth/login/+page.svelte` handles the login logic.
- `immich/web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte` is the search results UI.
- `immich/web/src/routes/+page.ts` is the default route page. It displays a "Welcome to Immich" message for first-time users, or redirects to the Login or Photos page for existing users.
- 