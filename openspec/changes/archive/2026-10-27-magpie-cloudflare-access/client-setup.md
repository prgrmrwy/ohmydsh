# Client setup and rollback

Use only after reviewed plugin build/deployment. Do not change daily connection automatically.

## External client

In Magpie settings set gateway URL https://api.prgrmrwy.com/v1 and a privately delivered company gateway key. Enter the dedicated service token Client ID and Client Secret in optional Cloudflare Access password fields. These are NOT the temporary Cloudflare management API token. Both Access values are stored using official DSH credentials, not ordinary plugin settings. Blank means unchanged. Clear Access credentials removes both when writable.

Environment-managed alternative references:

- MAGPIE_API_KEY
- MAGPIE_ACCESS_CLIENT_ID
- MAGPIE_ACCESS_CLIENT_SECRET

Supply values via the official credential/environment workflow on the actual company DSH host, never paste them into chat, Git, shell command arguments or screenshots. Environment-provided fields appear read-only. Host-side plugin sends the headers; browser does not receive stored values. Access pair requires HTTPS. For LAN HTTP restore, clear both Access values first/in the same save.

## Safe private delivery

Administrator retrieves dedicated client material only from CT105's root-readable /root/.config/cloudflare/magpie-company-key.json and magpie-access-service.json through an authorized private path. Do not copy the account cert, tunnel credential or setup management token to the company client. Service token expiry and key policy must be checked before delivery; use company-device policy and data handling rules.

## Acceptance

Verify directory, one short streamed reply, card read, explicit refresh and one tool continuation from company network without VPN. A valid URL at home is not evidence of company reachability.401 means gateway auth,403 can mean Access or scoped permission; diagnose without posting raw credential-bearing requests. Do not weaken edge protection to make a client work.

## Save failures

If MAGPIE_SETTINGS_WRITE_FAILED appears, settings may be partially persisted. Do not restart to bypass quarantine. Reread configured status, re-enter every credential field involved in failed save and retry the complete connection. Prepared calls retain their old captured credentials. Ordinary resync does not clear a failed-write quarantine.

## Rollback

Restore known LAN URL/key and clear both Access values with official settings. Keep the old plugin build available for code rollback. Stopping cloudflared-home-magpie disconnects only the public ingress; never delete Access before public routing is disabled. Infrastructure rollback is documented in private home-substore ops/magpie-cloudflare.
