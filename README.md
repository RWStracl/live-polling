# Live Polling

A minimal Slido/Mentimeter-style live polling app for training classes. One presenter
(admin) creates multiple-choice questions and opens/closes them live; participants join
a plain URL on any device, no sign-up or app install, and see results update in real time.

No database — poll state lives in server memory for the duration of the class. Restarting
the server clears all questions and votes.

## Run locally

```
npm install
npm start
```

- Participant view: http://localhost:8080/
- Admin view: http://localhost:8080/admin.html

Set a real admin password (default is `changeme`):

```
ADMIN_PASSWORD=your-password npm start
```

## Using it in class

1. Open `/admin.html`, log in with the admin password.
2. Type a question, add 2+ options, click **Create question**.
3. Click **Open** on that question — it instantly appears on every participant's screen.
4. Share the participant URL (shown at the top of the admin page) with your class.
5. Watch live results on the admin page as votes come in.
6. Click **Close** when done, then open the next question.

Each participant's browser can only vote once per question (tracked locally), and after
voting they see the live results themselves too.

## Deploying to Render so remote students can reach it

Because poll state is kept in memory, **run exactly one instance** — Render's free tier
already runs a single instance by default, so there's nothing extra to configure there.

1. Create a free account at [render.com](https://render.com) (GitHub login works, no
   credit card required for the free tier).
2. Push this folder to a GitHub repo.
3. In the Render dashboard, click **New > Blueprint**, and point it at your GitHub repo.
   Render detects `render.yaml` in this folder automatically (runtime, build, and start
   command are already configured).
4. When prompted for the `ADMIN_PASSWORD` environment variable (it's intentionally left
   blank in `render.yaml` so a real password never gets committed to git), enter a real
   password.
5. Deploy. Render gives you a `https://live-polling-xxxx.onrender.com` URL — that's what
   you share with your MA students, and `/admin.html` on the same URL is your control panel.

Note: on Render's free tier, the service spins down after 15 minutes of no traffic and
takes ~30-60 seconds to wake back up on the next request. For a live class, open the app
yourself a minute or two before students join so it's already warm. If that cold start is
ever a problem, Render's paid "Starter" tier ($7/mo) keeps it always-on.

## Notes on corporate networks

Real-time updates use Socket.IO, which automatically falls back to HTTP long-polling if
a corporate firewall/proxy blocks WebSocket upgrades — no configuration needed on your
end or your students'. Everything runs over standard HTTPS (port 443) once deployed.
