# Turning on the AI chat and putting the guide online

Keep the OpenAI key out of GitHub, chat messages and shared documents. It only ever goes in two
places: a `.env.local` file on your own computer, or Vercel's environment variables.

## A. Try the chat on your computer first (5 minutes)

You need Node.js 18 or newer (free from nodejs.org; check with `node --version`).

1. Start the app:
   - **Mac:** double-click `Start guide (Mac).command` (the first time, right-click it and choose **Open**), or
     run `node tools/dev-server.js` in Terminal from the app folder.
   - **Windows:** double-click `Start guide (Windows).bat`, or run `node tools\dev-server.js` in the app folder.
2. The window asks for your OpenAI API key. Paste it, press Enter, then type `y` to save it in `.env.local`
   so it doesn't ask again. The key stays on your computer and is only sent to OpenAI.
3. Your browser opens **http://localhost:8080** (open it yourself if it doesn't). Keep the window open while
   you use the app; Ctrl+C stops it.
4. Answer the questions and click **See my matches**. Right under your result, the guide opens the
   conversation with its recommendation, written from all of your answers. Reply to keep going.

To require an access code locally too, add a line `ACCESS_CODE=redwood218` to `.env.local`.
`.gitignore` keeps `.env.local` out of GitHub. Don't upload it by hand either.

## B. Put the files on GitHub

1. On github.com, create a new repository (for example `redwood-relocation-guide`).
2. Click **Add file → Upload files** and drag in everything in the app folder except `.env.local`:
   `index.html`, `styles.css`, `package.json`, `vercel.json`, `README.md`, `.gitignore`, the two
   `Start guide` files and the folders `api`, `content`, `data`, `docs`, `js`, `tests`, `tools`.
3. Click **Commit changes**.

## C. Deploy on Vercel

1. Go to vercel.com and sign in with GitHub.
2. **Add New → Project**, pick the repository, click **Import**.
3. Framework preset: **Other**. Leave the build command and output directory empty. Click **Deploy**.
4. Open the project's **Settings → Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `OPENAI_API_KEY` | The key |
   | `ACCESS_CODE` | The code you'll share with your class and professor |
   | `OPENAI_MODEL` | Optional. Defaults to `gpt-6-luna` |
   | `GUIDE_PROMPT_VERSION` | Optional. `v1` switches to the first version of the instructions, for the before/after comparison. Leave unset for `v2` |

5. Go to **Deployments**, open the menu on the latest one, and click **Redeploy** so the settings take effect.

Every change you commit to GitHub after this goes live by itself in about a minute.

## D. Keep costs safe

- Set a monthly budget limit for the key in the OpenAI platform's billing or usage limits settings.
- The access code keeps strangers from using it, and each visitor is limited to 30 messages per 10 minutes.
- A chat message sends the visitor's results (about 5,000 tokens) plus the conversation so far. On a
  small model like `gpt-6-luna` that's a fraction of a cent per message, but check current pricing.

## E. Embed it in Google Sites

1. In Google Sites, click **Insert → Embed → By URL**.
2. Paste the Vercel link and choose **Whole page**.
3. Drag the embed's bottom edge down so it's tall enough.
4. Add a plain link to the Vercel page too, since phones show embeds in a small frame.

## If something goes wrong

The chat shows a plain message for each problem:

| Message | Fix |
| --- | --- |
| "The live guide isn't connected on this copy of the app" | No key found. Check the variable name `OPENAI_API_KEY`, then redeploy (Vercel) or restart the local app |
| "Port 8080 is busy" (local) | The app is already running in another window; use that one or close it |
| "That access code is not right." | Type the `ACCESS_CODE` value exactly |
| "OpenAI rejected the API key." | The key is wrong or was revoked. Make a new one in the OpenAI platform |
| "The model … isn't available for this key." | Set `OPENAI_MODEL` to a model the key can use (for example `gpt-5.6-luna` or `gpt-5.4-mini`) |
| "out of credit or over its rate limit" | Add credit or raise the budget limit in the OpenAI platform |

Vercel's **Logs** tab shows the full OpenAI error for anything else.

## Photos

City photos load from Wikimedia Commons using the file names in `content/cities.json`. Before
presenting, open each photo's Commons page (the "Wikimedia Commons" link under the photo), copy the
author and license into `credit` and `license`, and set `verified` to `true`. Naperville's is done.
If a photo fails to load, the app shows a drawn map of the state instead.

## Other hosts

GitHub Pages or Netlify can host the page and data, but `api/guide.js` is written for Vercel, so on
those hosts the chat stays off and the written summary shows instead.
