/** Host/client federation control contract placeholder for the disabled M1 skeleton. */
export const FEDERATION_CONTRACT_VERSION = 1 as const

export type HostFederationState =
  | 'HOST_DISABLED'
  | 'HOST_PREPARING'
  | 'HOST_READY'
  | 'HOST_CONFLICT'
  | 'HOST_FAILED'

export type ClientFederationState =
  | 'CLIENT_OFFICIAL'
  | 'CLIENT_PREPARING'
  | 'CLIENT_FEDERATED'
  | 'CLIENT_FALLBACK'
