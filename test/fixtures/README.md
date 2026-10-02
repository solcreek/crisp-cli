The localhost certificate and private key are public test fixtures, never credentials.
They secure the loopback Socket.IO server used by CLI E2E tests. Only the test child
trusts this certificate through NODE_EXTRA_CA_CERTS. TLS verification remains enabled.

Regenerate with:

```sh
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout test/fixtures/localhost-key.pem \
  -out test/fixtures/localhost-cert.pem -days 36500 \
  -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
```

mock-crisp.mjs intercepts endpoint discovery in E2E child processes using undici's
MockAgent. Unmatched REST requests cannot reach the network. The actual RTM traffic
uses the real socket.io-client against a real local Socket.IO server.

mock-pages.mjs intercepts a browsing-history GET in the built CLI child process.
It checks the exact route and fixture authentication headers and blocks all
unmatched network requests. Its page data and credentials are synthetic.

timeout-gc.mjs holds a real loopback HTTP response open while forcing garbage
collection. It verifies that REST deadlines and manual cancellation still stop
body consumption. Its dispatcher routes every request to loopback, never Crisp.

mock-smoke-child.mjs simulates the live smoke helper dependencies in an isolated
child process, including stdout arriving after process exit. It uses fixture
credentials and never contacts 1Password or Crisp.

rtm-reference.json records event names, token tiers, scopes and routing field paths
from the official RTM v1 reference (checked 2026-10-01, page updated 2026-02-12).
The website:update_visitors_count tier markup `user``website` is normalized to
separate user and website tiers. The malformed session:sync:pages sample timestamp
does not affect the captured top-level routing fields. Synthetic test payloads
are built in test/rtm-reference.ts; no customer data or document sample secrets
are copied. The optional check:rtm-reference script detects event/tier/scope drift.

# Independent payload examples

`rtm-payloads.json` is hand-authored synthetic data, independent of the event
matrix generator. It exercises text/file messages, bucket resources, email
tracking and opaque plugin data over WSS, with optional and unknown fields,
Unicode and nested JSON. Identifiers are test fixtures and URLs use
`example.invalid`; these are not captured customer events or exhaustive schemas.

`stdio-loopback-cli.mjs` invokes the real process CLI lifecycle with an injected
Undici pool restricted to loopback HTTPS. The same public test certificate is
explicitly trusted by this pool; certificate verification remains enabled. It
supports REST worker E2E tests and cold/warm comparisons without sending data to
Crisp. All fixture credentials and payloads are synthetic.
