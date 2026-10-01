# Real PTY probe: receive live frames, toggle detail visibility, quit with q.
import errno, fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios, time
node, entry, adapter = sys.argv[1:]
node_version = subprocess.check_output([node, '--version'], text=True).strip()
pid, fd = pty.fork()
if pid == 0:
    os.environ.pop('CI', None)
    os.environ['TERM'] = 'xterm-256color'
    os.execv(node, [node, entry, adapter, 'listen'])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 90, 0, 0))
data = b''; toggled = False; quit_sent = False; status = None; first_frame = None
start = time.monotonic()
try:
    while time.monotonic() - start < 8:
        ready, _, _ = select.select([fd], [], [], .1)
        if ready:
            try: chunk = os.read(fd, 65536)
            except OSError as error:
                if error.errno == errno.EIO: break
                raise
            if not chunk: break
            data += chunk
        if b'Received:' in data and not toggled:
            first_frame = round((time.monotonic() - start) * 1000)
            os.write(fd, b'p'); toggled = True
        if b'details hidden' in data and not quit_sent:
            os.write(fd, b'q'); quit_sent = True
        waited, result = os.waitpid(pid, os.WNOHANG)
        if waited: status = result; break
    while status is None and time.monotonic() - start < 8:
        waited, result = os.waitpid(pid, os.WNOHANG)
        if waited: status = result
        else: time.sleep(.01)
    if status is None:
        os.kill(pid, signal.SIGKILL); _, status = os.waitpid(pid, 0)
finally:
    os.close(fd)
text = data.decode('utf-8', errors='replace')
assert toggled and quit_sent, text
assert os.waitstatus_to_exitcode(status) == 0, text
print(json.dumps({'adapter': adapter, 'node': node_version, 'exit': 0, 'toggle': toggled, 'quit': quit_sent, 'first_frame_ms': first_frame, 'elapsed_ms': round((time.monotonic()-start)*1000), 'transcript': text}, ensure_ascii=False))
