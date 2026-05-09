# web-app

Tiny static test client for the platform. Vanilla HTML+JS, no build step.

## Run

```bash
# from this directory
python3 -m http.server 8080
# open http://localhost:8080
```

By default it talks to:
- auth-service on `http://localhost:8001`
- post-service on `http://localhost:8002`
- feed-service on `http://localhost:8003`

You can change them at the top of the page.

## What it does

1. **Register / Login** — creates a user, stores the JWT in `localStorage`.
2. **Compose** — write a post and optionally attach an image (uses Post Service `/media/presign` then PUTs the file directly to S3).
3. **Follow** — paste a user-id and follow/unfollow them.
4. **Feed** — pulls `/feed/{your_user_id}` and renders the timeline. Click a post to like / unlike it.

> Make sure CORS is enabled on the three FastAPI services (it is, by default in dev). Also start an SQS consumer (`feed-service` worker) so events from Post actually populate the feed.
