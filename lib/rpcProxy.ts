// Absolute URL to the same-origin server-side RPC passthrough (app/api/rpc/mainnet).
// Client code points its RPC clients here instead of at a NEXT_PUBLIC Helius URL, so the
// API key is never shipped to the browser. The SSR placeholder is never actually fetched
// — all sends/reads run inside effects and handlers, which only execute in the browser.
export const MAINNET_RPC_PROXY =
  typeof window !== 'undefined'
    ? `${window.location.origin}/api/rpc/mainnet`
    : 'http://localhost/api/rpc/mainnet'
