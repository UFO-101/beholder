# Claude Rules for Beholder Project

## Deployment Rules
- **NEVER deploy to production without explicit permission**
- Do NOT run `wrangler pages deploy` unless specifically asked
- Do NOT run `wrangler deploy` for Workers unless specifically asked
- Always ask before any deployment action

## Project Context
- Beholder is an AI beauty exploration platform
- Uses H3 hexagonal spatial indexing
- Frontend deployed to Cloudflare Pages (beholder.fyi)
- Worker API deployed to Cloudflare Workers
- Database: Cloudflare D1 (database name: "beholder")

## Development Guidelines
- Make code changes locally
- Test thoroughly before suggesting deployment
- Use tmux for long-running processes
- Python evaluation scripts use smart coverage with retries

## Commit Message Rules
- NEVER credit Claude or mention AI assistance in commit messages
- Keep commit messages professional and focused on technical changes
- Write as if the human developer made all changes

## Important Commands (only when asked)
- Deploy frontend: `cd frontend && npx wrangler pages deploy . --project-name beholder`
- Deploy worker: `cd api && wrangler deploy`
- Check tmux: `tmux capture-pane -t beauty-eval -p`