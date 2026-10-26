# Magpie Access Authentication Specification

## Purpose

Allow the self-authored Magpie client to call an Access-protected gateway without a VPN client, while preserving existing LAN usage, credential confidentiality, and operation identity across configuration changes.

## Requirements

### Requirement: Optional Access service authentication
The plugin SHALL support an optional complete pair of Cloudflare Access client id and client secret in addition to its Magpie gateway key. All configured gateway requests MUST carry both Access headers and retain bearer authentication. Requests without Access configuration SHALL preserve LAN behavior.

#### Scenario: Protected gateway
- **WHEN** a complete pair is configured
- **THEN** catalog, Chat Completions, Responses, quota cards and refresh requests include the configured Access pair and gateway key

#### Scenario: LAN connection
- **WHEN** Access is not configured
- **THEN** no Access headers are sent and existing gateway requests retain their behavior

#### Scenario: Invalid pair
- **WHEN** only one Access field is configured or credentials contain invalid header characters
- **THEN** the client rejects the incomplete or invalid configuration before sending gateway requests

### Requirement: Credentials remain confidential
The plugin MUST store Access values through the official credentials service, never in ordinary settings. Reads SHALL expose only configured/writable status. Errors, returned gateway data and logs MUST NOT disclose current or retained operation credentials. Environment-owned credentials MUST NOT be overwritten by settings actions.

#### Scenario: Settings read and failed request
- **WHEN** settings are read or a gateway reflects credentials in an error
- **THEN** no raw Access value is returned in settings or error output

#### Scenario: Read-only credential source
- **WHEN** an update targets an environment-owned Access credential
- **THEN** it is rejected without modifying the other connection fields

### Requirement: Captured connection lifecycle
Credential changes MUST invalidate stale background results and prepared connection identity consistently with existing gateway-key behavior. An already admitted operation SHALL retain a coherent captured credential set; no request may mix old and new credentials. Existing redirect rejection and endpoint restrictions MUST remain intact.

#### Scenario: Access rotation during discovery
- **WHEN** Access credentials change while catalog synchronization is running
- **THEN** the old result cannot publish as the new connection catalog

#### Scenario: Prepared operation
- **WHEN** connection credentials change after preparation
- **THEN** the operation follows the existing prepared-operation lifecycle with one coherent identity and all retained secrets remain redacted
