Steps to run development server locally on a Unix-based computer:
1. Clone this repo: `git clone https://github.com/simplifieditproducts/immich-dev`
2. Navigate to project root directory: `cd immich-dev`
3. Check out `custom-patch-v2` branch: `git checkout custom-patch-v2` (our customizations should be made on `custom-patch-v2` branch and then rebased onto `main` branch)
4. Create the necessary `.env` file: `cp docker/example.dev.env docker/.env`
5. Add an OpenAI API key in the `.env` file to allow ChatGPT-enhanced smart search
6. Start the dev server using the provided Makefile: `make dev`
7. Access the instance in your web browser by using `http://localhost:3000` or `http://your-machine-ip:3000`

Other possibly useful commands:
- To delete Immich in Terminal, go to `/immich-dev/docker` and run `docker compose -f docker-compose.yml down -v`
- To stage a list of all our customizations since the original forked Immich commit: `git checkout TBD -- .`

Image assets are stored in various locations within the codebase:
- The `web/src/lib/assets/` directory stores assets that are importable into Svelte. Changing any of these assets requires restarting the Docker container.
- The `web/static` directory stores static assets that are served with no processing. These are unavailable to Svelte.
- The `design` directory stores images used in `README` files.
- The `@immich/ui` Node module stores some assets internally.

Useful info:
- To get a user's admin status, add `import { user } from '$lib/stores/user.store';` and then use `$user.isAdmin`. 

These are various important files in the codebase:
- `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` is the main photo viewer UI, including the top bar and context (3-dot) menu.
- `web/src/lib/utils/auth.ts` checks if user is already logged in, and redirect to Login page if not.
- `web/src/routes/auth/login/+page.svelte` handles the login logic.
- `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte` is the search results UI.
- `web/src/routes/+page.ts` is the default route page. It displays a "Welcome to Immich" message for first-time users, or redirects to the Login or Photos page for existing users.
- `web/src/lib/stores/user.store.ts` stores the active user and its preferences, and also contains a method for clearing them.
- `web/src/lib/components/user-settings-page/user-settings-list.svelte` defines the Settings UI.
- `web/src/lib/components/shared-components/navigation-bar/navigation-bar.svelte` defines the top bar that contains the Profile icon, Search bar, and more.
- `web/src/lib/components/shared-components/side-bar/user-sidebar.svelte` defines the left bar items (these go in hamburger menu on mobile).
- `server/src/services/search.service.ts` is where Kevin implemented filter extraction functionality for Smart Search.

API changes we made in our fork compared to the [official API documentation](https://immich.app/docs/api):
- The `checkExistingAssets` API function now permits the `deviceId` parameter to be optional. When `deviceId` is not included, the method returns all matching `deviceAssetIds` for the user regardless of `deviceId`. See this change [here](https://github.com/simplifieditproducts/immich-dev/commit/1efe8565d48f304eb334f8f001c672ec892ba2b2).
- The `getAllUserAssets` API function has been added to paginate all existing assets for the current user regardless of `deviceId`. It can be used with `GET /api/assets?page=1&size=5000`, which allows a maximum of 5000 assets per request. See this change [here](https://github.com/simplifieditproducts/immich-dev/commit/b2b5d28f68d748e7b9c30a614bd89138a16ceded).
- The `login` API function now returns `quotaSizeInBytes` and `quotaUsageInBytes`. See this change [here](https://github.com/simplifieditproducts/immich-dev/commit/15161f1d1b51f759fe8b85ee8b94ac4368524f23).
- The `uploadAsset` API function now returns the `checksum` of the asset if it is accepted. See this change [here](https://github.com/simplifieditproducts/immich-dev/commit/4f28651d4fd28d9cab849a22f6c213f37bc6602f).
- The `replaceAsset` API function now has an optional boolean parameter `skipReprocess` which will prevent the server from recreating thumbnails and detecting faces on the new asset. See this change [here](https://github.com/simplifieditproducts/immich-dev/commit/c531d8c6bf94f241c63a2568cee969edfadc15ea).
- The `uploadAsset` and `replaceAsset` API functions now accept two additional parameters: `deviceFilePath` (optional) and `isOriginalQuality` (defaults to `false`). The `deviceFilePath` parameter tracks the asset's file path on the user's device, while `isOriginalQuality` indicates whether the asset is in original quality. See this change [here](https://github.com/simplifieditproducts/immich-dev/commit/dfe1e16711138b9f7a19ce3023f482c68a637aa8).
- The `getAssetsInfo` API function has been added to accept a list of asset IDs and return the asset info for each of them. This API supports the 'Download' feature, which requires fetching asset info in bulk. See this change [here](https://github.com/simplifieditproducts/immich-dev/commit/dfe1e16711138b9f7a19ce3023f482c68a637aa8).

Communication between the Immich app and the native app is handled via `postMessage`:
- The `CMD_CLOSE_WINDOW` message instructs the native app to close the web view.
- The `CMD_SETBGMODE_DARK` message instructs the native app to set the app’s background to dark (black).
- The `CMD_SETBGMODE_DEFAULT` message instructs the native app to reset the background to its default.
- The `CMD_DOWNLOAD_ASSETS` message instructs the native app to download a list of assets. It comes with a list of assets in JSON format.
- (Optional) The `CMD_DOWNLOAD_ALBUM` message instructs the native app to download an album. Currently, this command is not sent as the 'Download' button is hidden from end users.

More documentation can be found [here](https://github.com/simplifieditproducts/immich-devops/tree/main/docs).
