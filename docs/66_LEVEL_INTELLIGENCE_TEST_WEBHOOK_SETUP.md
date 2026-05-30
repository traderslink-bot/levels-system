# Level Intelligence Test Webhook Setup

## Purpose

This guide documents how to configure a Discord test-channel webhook and rerun the Level Intelligence Discord preview send using the synthetic-included `LevelEngineOutput` sample.

This setup is for test-channel review only. It does not change support/resistance detection, LevelEngine runtime behavior, runtime mode defaults, surfaced buckets, nearest levels, special levels, alert routing defaults, monitoring, Discord production behavior, or trader-context behavior.

## Test Webhook Status For This Review

- `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` present locally: no
- Test send attempted: no
- Test send result: skipped because the webhook environment variable was missing
- Secrets committed: no

The send command below is confirmed as the correct command to run after the test webhook environment variable is configured.

## Create A Discord Test-Channel Webhook

1. Open Discord and go to the intended private test server/channel.
2. Open the channel settings for the test channel.
3. Go to **Integrations**.
4. Choose **Webhooks**.
5. Create a new webhook for the test channel.
6. Give it a clear test-only name, such as `Level Intelligence Preview Test`.
7. Copy the webhook URL.

Use a test channel only. Do not use a production/member-facing channel for this preview gate.

## Set The Webhook For The Current PowerShell Session

Set the webhook URL only in your local shell session:

```powershell
$env:LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL = "paste-test-channel-webhook-url-here"
```

Confirm the variable is present without printing the secret:

```powershell
if ($env:LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL) { "present" } else { "missing" }
```

Do not commit the webhook URL. Do not hardcode it in source, scripts, docs, fixtures, or `.env` files committed to the repository.

## Files Used

The test-send review uses the committed synthetic-included sample:

- `docs/examples/level-intelligence/sample-level-engine-output-synthetic.json`

It also uses the existing facts fixtures:

- `docs/examples/level-intelligence/sample-session-facts.json`
- `docs/examples/level-intelligence/sample-volume-facts.json`
- `docs/examples/level-intelligence/sample-volume-shelves.json`
- `docs/examples/level-intelligence/sample-market-context.json`

The latest generated preview artifacts are:

- `docs/examples/level-intelligence/latest-discord-preview-synthetic.txt`
- `docs/examples/level-intelligence/latest-discord-preview-synthetic.json`

## Run The Explicit Test Send

After the webhook env var is set, run:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output-synthetic.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --send-test
```

This command uses the explicit preview/test path. It does not call LevelEngine, does not generate levels, and does not invoke existing live alert routing or monitoring.

## Expected Output

The current synthetic-included sample preview should report:

- mode: `send-test`
- message count: 3
- truncated: no
- synthetic continuation-map labels visible
- historical candidate extension labels visible
- test webhook deliveries: 3

The Discord test channel should receive three preview messages. The extension message should show:

- historical candidate extension rows
- synthetic continuation-map extension rows
- forward-planning extension wording
- not historical support/resistance wording
- limited evidence/no historical touches wording

## Safety Notes

- Use a test Discord channel only.
- Do not commit webhook URLs.
- Do not hardcode webhook URLs in source code or docs.
- Do not run `--send-test` unless the destination is a test destination.
- The runner defaults to dry-run unless `--send-test` is explicitly supplied.
- VWAP remains facts-only.
- Volume shelves remain facts-only.
- Synthetic continuation-map extensions are forward-planning map levels, not historical support/resistance.

## Troubleshooting

If the command reports:

```text
Shadow Discord preview send-test requires --test-webhook-url or LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL.
```

Set `LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL` in the current PowerShell session and rerun the command.

If the command reports:

```text
Shadow Discord preview test webhook URL must start with http:// or https://.
```

Re-copy the Discord webhook URL and make sure the environment variable contains the full URL.

If Discord returns `HTTP 401`, `HTTP 403`, or `HTTP 404`, the webhook may have been deleted, copied incorrectly, or created for the wrong channel. Recreate the test webhook and update the local environment variable.

If Discord returns a rate-limit or temporary network error, wait briefly and rerun the command once. Do not switch to a production webhook as a workaround.

If the message count or content looks different from the expected three-message preview, regenerate the dry-run preview first:

```bash
npx tsx src/scripts/run-level-intelligence-discord-preview.ts --level-output docs/examples/level-intelligence/sample-level-engine-output-synthetic.json --session-facts docs/examples/level-intelligence/sample-session-facts.json --volume-facts docs/examples/level-intelligence/sample-volume-facts.json --volume-shelves docs/examples/level-intelligence/sample-volume-shelves.json --market-context docs/examples/level-intelligence/sample-market-context.json --out docs/examples/level-intelligence/latest-discord-preview-synthetic.txt
```

Then inspect:

```text
docs/examples/level-intelligence/latest-discord-preview-synthetic.txt
```

## Next Gate

After a successful test-channel send with the synthetic-included sample, the next recommended gate is:

```text
wire_synthetic_preview_into_test_alert_flow
```
