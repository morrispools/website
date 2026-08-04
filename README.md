# Morris Pools — Review Request Texts

A simple web app for texting clients after a job is done, asking them to leave
a Google review. Type in a name and cell number (or paste a whole day's list),
hit send, and the client gets a friendly text with your Google review link.

It can also fire **automatically**: when a job is closed out in **Poolbrain**
or a daily log goes out in **JobTread**, the client shows up in a "Waiting to
send" list for one-click approval — or gets texted with no clicks at all if
you turn on auto-send.

Every text is logged, the app warns you before texting the same number twice,
and a cooldown (90 days by default) keeps weekly-service clients from being
asked repeatedly.

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

### 2. Twilio (the service that sends the texts — skip if using NiceJob)

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

## Hooking up Poolbrain and JobTread

Both integrations work by "webhooks" — Poolbrain/JobTread call your app the
moment something happens. That means **the app must be hosted somewhere with a
public web address first** (see "Hosting it" below — Render or Railway takes
about 15 minutes). A laptop at the office won't work for this part, because
Poolbrain and JobTread can't reach it.

Once hosted, say your app lives at `https://reviews.morrispools.com`:

### Poolbrain — text when a job is closed out

1. In Poolbrain, go to **Settings → API → Webhooks** and add a webhook
   pointing to `https://reviews.morrispools.com/webhooks/poolbrain`.
2. Subscribe it to the one-time job events (the ones that fire when a job's
   status changes).
3. Poolbrain shows you a **Signing Secret** — paste it into `.env` as
   `POOLBRAIN_SIGNING_SECRET` and restart the app. (The secret is how the app
   knows a request really came from Poolbrain.)

By default the app only reacts to **one-time jobs** (repairs, installs,
green-to-clean) that reach a completed/closed status — not routine weekly
service stops. To change which events count, edit `POOLBRAIN_EVENTS` in
`.env`.

### JobTread — text when a daily log goes out

1. Make up a long random password (30+ characters of anything) and put it in
   `.env` as `JOBTREAD_WEBHOOK_KEY`.
2. In JobTread, go to **Settings → Webhooks** and add a webhook for **Daily
   Log created** events pointing to
   `https://reviews.morrispools.com/webhooks/jobtread?key=YOUR-PASSWORD-HERE`
   (same password as step 1 — it's how the app knows the call is really from
   JobTread).
3. Recommended: in JobTread go to **Settings → API**, create a grant key, and
   put it in `.env` as `JOBTREAD_GRANT_KEY`. Daily-log webhooks don't always
   include the client's phone number; with the grant key the app looks it up
   automatically. Without it (or if the lookup comes up empty), the client
   still appears in the Waiting list — you just fill in the number once and
   hit Send.

If a daily log is marked internal-only (not shared with the customer), the
app skips it.

### Approve-first vs. auto-send

Out of the box the app is in **approve-first** mode: webhook events land in a
"Waiting to send" list at the top of the page, showing the client's name and
number pulled from Poolbrain/JobTread. You glance at it and click Send (or
Dismiss). Once you've watched it get things right for a week or two, tick
**Auto-send** in Settings and texts go out with no clicks at all — auto-send
only fires when the app got both a name and a valid number, and never inside
the cooldown window.

One honest caveat: Poolbrain and JobTread don't publish the exact shape of
their webhook data, so the app reads names and phone numbers out of whatever
arrives (and refuses anything that looks like a technician's info rather than
a customer's). If a webhook comes through with a blank name or number, it
still lands safely in the Waiting list — and the server log will show what
arrived so the matching can be tightened up.

## Using NiceJob instead of Twilio

If you'd rather have [NiceJob](https://nicejob.com) send the review requests —
it writes its own messages, sends both texts and emails, and automatically
reminds people who don't respond — the pieces fit together like this:

### JobTread → NiceJob: use the built-in integration (no code)

JobTread connects to NiceJob natively. In JobTread go to **Settings →
Integrations → NiceJob**, click **Connect to NiceJob**, sign in, and pick
your "Get Reviews" campaign. Done — you don't need this app's JobTread
webhook at all (leave `JOBTREAD_WEBHOOK_KEY` blank so it stays off).

### Poolbrain → NiceJob: this app is the bridge

Poolbrain and NiceJob don't talk to each other directly, and NiceJob's API is
partner-only (it requires an approved developer application, which isn't
worth it for one company). The clean path is through Zapier:

1. In [Zapier](https://zapier.com), create a Zap:
   - **Trigger:** "Webhooks by Zapier" → **Catch Hook**. Zapier shows you a
     URL like `https://hooks.zapier.com/hooks/catch/…` — copy it.
   - **Action:** "NiceJob" → **Create/Update Person & Enroll in Campaign**.
     Connect your NiceJob account, map `full_name` and `phone` from the hook
     data, and pick your Get Reviews campaign.
2. Paste the hook URL into `.env` as `NICEJOB_FORWARD_URL` and restart.
3. In the app's Settings, switch delivery to **Hand off to NiceJob**.

Note: "Webhooks by Zapier" requires a paid Zapier plan (roughly $20/month).

Now a job closed out in Poolbrain flows: Poolbrain → this app (signature
check, completed-status filter, cooldown, approval queue) → Zapier → NiceJob
campaign. In NiceJob mode you don't need Twilio, the review link, or the
message template — NiceJob handles all of that. The approval queue and
cooldown still apply, so nobody gets enrolled twice in a season.

## Day-to-day use

- **One client:** type their name and cell number, click **Send review request**.
- **A day's worth of jobs:** open "Send to a whole list at once" and paste one
  client per line: `Sarah Johnson, 555-123-4567`.
- **Change the wording:** open Settings. `{name}` becomes the client's first
  name and `{link}` becomes your review link.
- **History:** the table at the bottom shows everything sent — including
  whether it was manual, from Poolbrain, or from JobTread. If a number was
  already texted, the app asks before sending again.
- **Waiting to send:** clients arriving from Poolbrain/JobTread sit here until
  you approve them (unless auto-send is on). The list refreshes on its own
  while the page is open.

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

## Hosting it

The app runs fine on an office computer for manual sending, but the
Poolbrain/JobTread automation **requires** hosting it somewhere with a public
address (and it also means you can use it from your phone at a job site).
Use a service like [Render](https://render.com) or
[Railway](https://railway.app):

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
