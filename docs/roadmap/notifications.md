# 9A · Notification Engine

**Status:** 💡 Future

## Scope

Configurable notifications via email, Slack, and webhooks. Triggered by propagation events, drift alerts, and scheduled checks.

## Channels

| Channel | Transport | Config |
|---------|-----------|--------|
| Email | SMTP or SendGrid API | SMTP host/port/credentials or API key |
| Slack | Incoming webhook or Bot API | Webhook URL or bot token + channel |
| Webhook | HTTP POST | URL + optional auth header + secret for HMAC signing |

## Triggers

- Drift alert created (by severity threshold)
- Risk score exceeds appetite threshold
- Evidence expiring within N days
- Risk exception expiring within N days
- Connector sync failure
- Manual intel corroborated
- Compliance score drops below threshold

## Implementation

- **Migration:** `notification_channels` table, `notification_rules` table (trigger, channel_id, filters)
- **Service:** `src/services/notifications/dispatcher.ts` — called by propagation engine after handlers run
- **Templates:** Markdown templates per trigger type, rendered to HTML for email
- **CLI:** `attesting notify test --channel <id>` to send test notification
- **UI:** Settings page for channel config + rule builder

## Exit Criteria

- [ ] Email, Slack, and webhook channels work
- [ ] At least 3 trigger types fire correctly
- [ ] Test notification command works
