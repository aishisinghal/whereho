# Microsoft Edge compatibility notes

This project has been updated to include polyfills and build targets to make the frontend work reliably in Microsoft Edge (Chromium and legacy). Changes made:

- Added `react-app-polyfill` and `whatwg-fetch` and imported them in `frontend/src/index.js` so newer JS features and fetch are polyfilled on older browsers.
- Added `browserslist` to `frontend/package.json` to ensure the build output includes vendor prefixes and transpilation for Edge >= 18.

Testing tips

- Modern Edge (Chromium) behaves like Chrome — the app should work out of the box. Test on the latest Edge to confirm.
- Legacy Edge / older versions (EdgeHTML) may need the IE11 polyfill (`react-app-polyfill/ie11`) if you must support them — tell me if you need IE11/old Edge support and I'll add it.
- Geolocation requires a secure context. `localhost` is considered secure; in production make sure to serve over HTTPS to allow geolocation in Edge.

If you want, I can also:
- Add an automated browserlist CI check and run cross-browser testing with Playwright.
- Add CSS autoprefixing rules or PostCSS config (CRA already includes Autoprefixer based on browserslist).
