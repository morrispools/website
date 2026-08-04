# Morris Pools — Review Request Texts

A simple web app for texting clients after a job is done, asking them to leave
a Google review. Type in a name and cell number (or paste a whole day's list),
hit send, and the client gets a friendly text with your Google review link.

Every text is logged, and the app warns you before texting the same number twice.

## Quick start (try it in test mode)

You need [Node.js](https://nodejs.org) (version 18 or newer) installed. Then:

```bash
npm install
npm start
```

Open http://localhost:3000 in your browser. Without Twilio set up, the app runs
in **test mode** — everything works, but messages are logged instead of actually
sent, so you can play with it safely.

## Going live — three things to set up

### 1. Your Google review link

1. Go to [google.com/business](https://google.com/business) and sign in to the
   Morris Pools business profile.
2. Look for **"Ask for reviews"** (or "Get more reviews"). Google gives you a
   short link like `https://g.page/r/XXXXXXXX/review`.
3. Paste that link into the app's **Settings** panel (or into `.env` as
   `GOOGLE_REVIEW_LINK`).

That link takes clients straight to the "leave a review" box for Morris Pools.

### 2. Twilio (the service that sends the texts)

1. Create an account at [twilio.com](https://www.twilio.com) and buy a phone
   number with SMS capability (about $1.15/month; texts are about $0.01 each).
2. Copy `.env.example` to `.env` and fill in `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN` (both on your Twilio Console dashboard), and
   `TWILIO_FROM_NUMBER` (the number you bought, like `+15551234567`).
3. **Important — A2P 10DLC registration:** US carriers require businesses to
   register before sending texts from a regular local number. In the Twilio
   Console, complete the "A2P 10DLC" brand and campaign registration (one-time,
   takes a few days to approve, small fees apply). Until it's approved,
   messages to US numbers may be blocked or filtered. Twilio's setup wizard
   walks you through it — describe the use case as "customer review requests
   after completed service."
4. Restart the app. The badge at the top switches from "TEST MODE" to "Live".

### 3. A password (if you put this on the internet)

If you host the app anywhere other than an office computer, set `APP_PASSWORD`
in `.env` so only your team can send texts.

## Day-to-day use

- **One client:** type their name and cell number, click **Send review request**.
- **A day's worth of jobs:** open "Send to a whole list at once" and paste one
  client per line: `Sarah Johnson, 555-123-4567`.
- **Change the wording:** open Settings. `{name}` becomes the client's first
  name and `{link}` becomes your review link.
- **History:** the table at the bottom shows everything sent. If a number was
  already texted, the app asks before sending again.

## Playing by the rules (keeps you out of trouble)

- **Only text clients who gave you their number** and expect to hear from you —
  people whose job you just finished are exactly that. Don't buy lists or text
  strangers.
- **Keep "Reply STOP to opt out" in the message** (it's in the default
  template). Twilio automatically handles STOP replies and blocks future texts
  to anyone who opts out.
- **Text during business hours**, not late at night.
- **Don't offer rewards for reviews** — Google's rules prohibit paying or
  giving discounts in exchange for reviews, and they prohibit asking only
  happy customers ("review gating"). Asking everyone with a plain link, like
  this app does, is fine.

## Hosting it (optional)

The app runs fine on an office computer, but if you want it available anywhere
(like on your phone from a job site), host it on a service like
[Render](https://render.com) or [Railway](https://railway.app):

- Build command: `npm install` — Start command: `npm start`
- Add the same variables from your `.env` file as environment variables,
  **including `APP_PASSWORD`**.
- Note: sent-message history is stored in a `data/` folder on disk. On hosting
  services, attach a persistent disk (Render calls it a "Disk") so history
  survives restarts.

## Files in this project

| File | What it is |
| --- | --- |
| `server.js` | The app itself (sending, logging, settings) |
| `public/index.html` | The web page you use |
| `.env.example` | Template for your private settings — copy to `.env` |
| `data/` | Created automatically; stores sent history and settings |
