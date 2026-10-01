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
