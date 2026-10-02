import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"
import { connectWorker } from "../examples/stdio-client.mjs"

const example = fileURLToPath(new URL("../examples/stdio-client.mjs", import.meta.url))
const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url))
const ready = {
  protocol: 1,
  type: "ready",
  capabilities: { read_only: true, cancellation: true, retries: false, commands: ["auth show"] },
  limits: { concurrency: 4, requestBytes: 65536, responseBytes: 1048576, maxTimeoutMs: 120000 },
}
const fixture = `const send=f=>process.stdout.write(JSON.stringify({protocol:1,...f})+'\\n');
const ready=${JSON.stringify(ready)};ready.capabilities.fixture_pid=process.pid;
const lines=require('node:readline').createInterface({input:process.stdin});`
const start = (body, options = {}) =>
  connectWorker({
    command: process.execPath,
    args: ["-e", fixture + body],
    env: {},
    handshakeMs: 2000,
    shutdownMs: 100,
    responseGraceMs: 100,
    ...options,
  })
const gone = (pid) => assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })

test("standalone example ignores user config/credentials and logs only its summary", async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [example], {
    env: {
      PATH: process.env.PATH,
      CRISPCTL_KEY: "private-fixture-value",
      CRISPCTL_CONFIG: "/invalid-user-config",
    },
    timeout: 10000,
  })
  assert.equal(stderr, "")
  assert.deepEqual(JSON.parse(stdout), { protocol: 1, read_only: true, responses: 2, closed: true })
})

test("demo preserves mixed-case platform variables while isolating the worker environment", async () => {
  const probe = `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const originalSpawn = childProcess.spawn;
    let spawns = 0;
    childProcess.spawn = (command, args, options) => {
      spawns++;
      assert.equal(command, 'node');
      assert.equal(options.env.Path, 'fixture-search-path');
      assert.equal(options.env.systemroot, 'fixture-system-root');
      assert.equal(options.env.Windir, 'fixture-windows-directory');
      assert.equal(options.env.CRISPCTL_READ_ONLY, '1');
      assert.notEqual(options.env.CRISPCTL_CONFIG, process.env.CRISPCTL_CONFIG);
      assert.deepEqual(Object.keys(options.env).sort(),
        ['Path', 'systemroot', 'Windir', 'CRISPCTL_CONFIG', 'CRISPCTL_READ_ONLY'].sort());
      // Use an absolute executable so POSIX can verify the Windows-style environment.
      return originalSpawn(process.execPath, args, options);
    };
    syncBuiltinESMExports();
    const { demo } = await import(${JSON.stringify(pathToFileURL(example).href)});
    await demo();
    assert.equal(spawns, 1);
  `
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", probe],
    {
      env: {
        Path: "fixture-search-path",
        systemroot: "fixture-system-root",
        Windir: "fixture-windows-directory",
        CRISPCTL_KEY: "private-fixture-value",
        CRISPCTL_CONFIG: "/invalid-user-config",
        UNRELATED_VARIABLE: "excluded-fixture-value",
      },
      timeout: 10000,
    },
  )
  assert.equal(stderr, "")
  assert.deepEqual(JSON.parse(stdout), { protocol: 1, read_only: true, responses: 2, closed: true })
})

test("standalone example runs through a symlink to its installed entry point", async () => {
  const directory = mkdtempSync(join(tmpdir(), "crispctl-example-entry-"))
  try {
    const alias = join(directory, "client.mjs")
    symlinkSync(example, alias)
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [alias], {
      env: { PATH: process.env.PATH },
      timeout: 10000,
    })
    assert.equal(stderr, "")
    assert.deepEqual(JSON.parse(stdout), {
      protocol: 1,
      read_only: true,
      responses: 2,
      closed: true,
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("reference client negotiates with the real executable and isolates command errors", async () => {
  const w = await connectWorker({
    command: process.execPath,
    args: [bin],
    env: { CRISPCTL_CONFIG: "/nonexistent-example-config" },
  })
  try {
    const [good, bad, write] = await Promise.all([
      w.request(["auth", "show"]),
      w.request(["conversations", "list", "--page", "0"]),
      w.request(["resolve", "fixture"]),
    ])
    assert.equal(good.ok, true)
    assert.equal(bad.error.error, "usage")
    assert.equal(write.code, 2)
    assert.equal((await w.request(["auth", "show"])).ok, true)
  } finally {
    await w.close()
  }
  await w.close()
  await assert.rejects(w.request(["auth", "show"]), /closing/)
})

test("reference client correlates out-of-order split UTF-8 responses and bounds submissions", async () => {
  const w = await start(`send(ready);let requests=[];lines.on('line',raw=>{
    const f=JSON.parse(raw);
    if(f.type==='shutdown'){send({type:'bye'});lines.close();return}
    if(f.type==='request') {requests.push(f);if(requests.length===4) setTimeout(()=>{
      for(const r of requests.reverse()){
        const b=Buffer.from(JSON.stringify({protocol:1,type:'response',id:r.id,ok:true,code:0,result:r.argv[0]+' 測試🌍'})+'\\n');
        for(const byte of b)process.stdout.write(Buffer.from([byte]));
      }
    },20)}
  });`)
  try {
    const values = ["a", "b", "c", "d"]
    const responses = values.map((value) => w.request([value]))
    await assert.rejects(w.request(["extra"]), /concurrency/)
    assert.deepEqual(
      (await Promise.all(responses)).map((f) => f.result),
      values.map((v) => v + " 測試🌍"),
    )
    await assert.rejects(w.request(["x".repeat(65536)]), /too large/)
    await assert.rejects(w.request(["x"], { timeoutMs: 0 }), /invalid request/)
  } finally {
    await w.close()
  }
  gone(w.capabilities.fixture_pid)
})

test("cancellation waits for one terminal response and preserves the worker", async () => {
  const w = await start(`send(ready);lines.on('line',raw=>{
    const f=JSON.parse(raw);
    if(f.type==='cancel')send({type:'response',id:f.id,ok:false,code:1,error:{error:'cancelled'}});
    if(f.type==='shutdown'){send({type:'bye'});lines.close()}
  });`)
  try {
    const controller = new AbortController()
    const response = w.request(["auth", "show"], { signal: controller.signal })
    controller.abort()
    assert.equal((await response).error.error, "cancelled")
    await assert.rejects(
      w.request(["auth", "show"], { signal: controller.signal }),
      /already cancelled/,
    )
  } finally {
    await w.close()
  }
  gone(w.capabilities.fixture_pid)
})

for (const body of [
  "process.stdout.write('old CLI help\\n');setInterval(()=>{},1000)",
  "ready.protocol=2;send(ready);setInterval(()=>{},1000)",
  "ready.capabilities.read_only=false;send(ready);setInterval(()=>{},1000)",
  "ready.limits.concurrency=0;send(ready);setInterval(()=>{},1000)",
  "process.stderr.write('private diagnostic');setInterval(()=>{},1000)",
  "process.stdout.write('x'.repeat(1048577));setInterval(()=>{},1000)",
  "process.stdout.write(Buffer.from([255,10]));setInterval(()=>{},1000)",
])
  test(`incompatible worker startup fails safely (${body.slice(0, 40)})`, async () => {
    await assert.rejects(start(body), (error) => {
      assert.match(error.message, /worker/)
      assert.doesNotMatch(error.message, /private diagnostic|old CLI/)
      return true
    })
  })

test("startup timeout and spawn failure settle without an orphan process", async () => {
  await assert.rejects(
    start("setInterval(()=>{},1000)", { handshakeMs: 50 }),
    /handshake timed out/,
  )
  await assert.rejects(
    connectWorker({ command: "/nonexistent-example-executable", args: [], env: {} }),
    /could not start/,
  )
})

for (const mode of ["deadline", "disconnect", "invalid-response", "shutdown", "interrupt"])
  test(`client reaps an unresponsive or broken worker: ${mode}`, async () => {
    const body = `send(ready);lines.on('line',raw=>{const f=JSON.parse(raw);
     if(f.type==='request' && '${mode}'==='disconnect')process.exit(0);
     if(f.type==='request' && '${mode}'==='invalid-response')send({type:'response',id:f.id,ok:true,code:1});
   });setInterval(()=>{},1000);`
    const controller = new AbortController()
    const w = await start(body, { signal: controller.signal })
    const pid = w.capabilities.fixture_pid
    if (mode === "shutdown") await assert.rejects(w.close(), /shutdown timed out/)
    else {
      const request = w.request(["auth", "show"], { timeoutMs: 30 })
      if (mode === "interrupt") controller.abort()
      await assert.rejects(request, /worker|client interrupted/)
      await assert.rejects(w.close())
    }
    gone(pid)
  })
