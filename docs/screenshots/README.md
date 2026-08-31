# Screenshots

Screenshots used in the main README, generated automatically with fictional data.

## ⚠️ Important — regenerate after UI changes

**Whenever you modify the visual appearance of the app** (layout, colors, new components, redesign), re-run the script below and commit the updated images. Stale screenshots give a bad first impression to new visitors.

## How to regenerate

Requirements: Docker running on the host.

```bash
# 1. Create the demo user (one-time, delete after)
docker exec <postgres_container> psql -U synapmail_user -d synapmail -c \
  "INSERT INTO users (email, name, password_hash, role) VALUES ('demo@synapmail.test', 'Demo', '<bcrypt_hash>', 'admin');"

# 2. Run the script (uses the Playwright Docker image — no local install needed)
docker run --rm \
  -v $(pwd)/scripts/gen-screenshots.mjs:/app/screenshots.mjs \
  -v $(pwd)/docs/screenshots:/screenshots \
  --network host \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  /bin/bash -c "cd /app && npm init -y -q && npm install playwright -q && node screenshots.mjs"

# 3. Delete the demo user
docker exec <postgres_container> psql -U synapmail_user -d synapmail -c \
  "DELETE FROM users WHERE email = 'demo@synapmail.test';"

# 4. Commit
git add docs/screenshots/
git commit -m "docs: update screenshots"
git push
```

## Files

| File | Description |
|------|-------------|
| `inbox.png` | Three-column layout with fictional message list |
| `compose.png` | Compose modal with rich editor open |
| `settings.png` | Settings panel (email accounts page) |
| `mobile.png` | Mobile view (390px) |
