# Install Set & Steal as an app

Set & Steal is a Progressive Web App (PWA). You can install it on a phone, tablet or computer straight from the website. It then opens full screen from its own icon, like any other app, and works offline for same-device games. Online rooms and chat still need an internet connection.

## Android (Chrome, Edge, Samsung Internet)

1. Open the game in Chrome.
2. Tap **📲 Install app** in the top bar, or open the **⋮** menu and choose **Install app** (sometimes **Add to Home screen**).
3. Confirm. Set & Steal appears in your app drawer and on your home screen.

## iPhone and iPad (Safari)

1. Open the game in **Safari**. Other iPhone browsers can't install web apps on older iOS versions.
2. Tap the **Share** button (the square with an arrow), then **Add to Home Screen**.
3. Tap **Add**. Tapping **📲 Install app** in the game shows these same steps.

## Windows, Mac, ChromeOS (Chrome or Edge)

Click **📲 Install app** in the top bar, or the install icon at the right of the address bar.

## What works offline

| Works offline | Needs internet |
| --- | --- |
| Opening the app | Creating or joining an online room |
| Same-device games (pass the phone around) | Online moves and room chat |

The first time you open the app, it saves itself on the device. After an update, the new version loads the next time you open it while online.

## Getting it into the Google Play Store (optional)

A store listing isn't needed to install the app, but if you want one:

1. Go to [pwabuilder.com](https://www.pwabuilder.com), enter the game's address and click **Start**.
2. Choose **Package for stores → Android → Generate package**. You get a signed `.aab` (for Play) and an `.apk` you can install directly on an Android phone for testing.
3. Keep the **signing key** file PWABuilder gives you. You need it for every future update.
4. To hide the browser address bar inside the store app, save the `assetlinks.json` file from the package as `public/.well-known/assetlinks.json` in this repository and push. Cloudflare then serves it at `/.well-known/assetlinks.json` on the site's address.
5. A Google Play developer account has a one-time registration fee. Check Google's current price.

The Apple App Store needs a Mac, Xcode and a paid Apple Developer membership. iPhone users can install from Safari as above instead.

## For developers

| File | Purpose |
| --- | --- |
| `public/manifest.webmanifest` | App name, colours, icons and screenshots |
| `public/sw.js` | Service worker: caches the game for offline use; never caches `/api/` calls |
| `public/icon-*.png`, `apple-touch-icon.png`, `favicon.png` | App icons (the maskable icon keeps its artwork inside the safe zone) |

When you change `app.js`, `table.css` or `config.js`, bump their `?v=` numbers in `index.html` **and** in the `SHELL` list and `VERSION` name in `sw.js`, so installed copies pick up the update.
