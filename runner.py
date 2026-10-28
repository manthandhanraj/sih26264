"""Samanvay: keep a live status window open with independent background recovery."""
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError
import argparse
import collections
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_json(path, value):
    temporary = path.with_name(path.name + "." + str(os.getpid()) + ".tmp")
    temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
    # Windows readers can briefly hold the destination without delete sharing.
    for attempt in range(12):
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            if attempt == 11:
                raise
            time.sleep(0.03)


class Lease:
    """The OS releases this exclusive lock even if its owner crashes."""
    def __init__(self, folder):
        self.path, self.file = folder / "runner.lease", None

    def acquire(self):
        self.file = self.path.open("a+b")
        self.file.seek(0, os.SEEK_END)
        if not self.file.tell():
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            self.file = None
            return False
        return True

    def release(self):
        if self.file:
            if os.name == "nt":
                import msvcrt
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            self.file.close()
            self.file = None


def supervised(folder):
    lease = Lease(folder)
    if not lease.acquire():
        return True
    lease.release()
    return False


def find_server(folder, port):
    for number in range(port, port + 21):
        url = f"http://127.0.0.1:{number}"
        try:
            with urlopen(url + "/api/health", timeout=0.12) as response:
                h = json.loads(response.read(12000))
            same_project = os.path.normcase(h.get("project", "")) == os.path.normcase(str(ROOT))
            same_data = os.path.normcase(h.get("dataDirectory", str(ROOT / "data"))) == os.path.normcase(str(folder))
            if h.get("app") == "samanvay" and same_project and same_data:
                return url
        except (URLError, OSError, ValueError, AttributeError):
            pass
    return None


def check_node():
    if any(not (ROOT / "node_modules" / package / "package.json").exists() for package in ("csv-parse", "read-excel-file")):
        raise RuntimeError("Required packages are missing. Run npm ci once in the project folder, then start again.")
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js 24 or newer is required.")
    try:
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        version = subprocess.check_output([node, "--version"], text=True, creationflags=flags).strip()
        if int(version.lstrip("v").split(".")[0]) < 24:
            raise RuntimeError(f"Node.js 24+ is required; found {version}.")
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(f"Unable to check Node.js: {exc}") from exc
    return node


def logger_for(folder):
    (folder / "logs").mkdir(exist_ok=True)
    logger = logging.getLogger("samanvay.runner")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    handler = RotatingFileHandler(folder / "logs" / "server.log", maxBytes=2097152, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    return logger


def tail_log(folder):
    try:
        return "\n".join((folder / "logs" / "server.log").read_text(encoding="utf-8", errors="replace").splitlines()[-10:])
    except OSError:
        return "No server log was written."


def supervise(folder, port, foreground=False):
    lease = Lease(folder)
    if not lease.acquire():
        return 0
    log = logger_for(folder)
    run_id = uuid.uuid4().hex
    info = {"runId": run_id, "supervisorPid": os.getpid(), "childPid": None, "state": "starting", "restarts": 0, "url": None}
    process, reader = None, None
    exits = collections.deque()

    def stop_requested():
        return read_json(folder / "runner-stop.json").get("runId") == run_id

    def save(**values):
        info.update(values, updatedAt=time.time())
        write_json(folder / "runner.json", info)

    def copy_output(pipe):
        try:
            for line in pipe:
                log.info("node: %s", line.rstrip())
                if foreground:
                    print(line, end="", flush=True)
        except (OSError, ValueError):
            pass

    try:
        node = check_node()
        save()
        log.info("Supervisor started (pid %s)", os.getpid())
        while not stop_requested():
            # Adopt an existing project server without making a second database
            # writer. Stopping monitoring never kills a separately started PID.
            existing = find_server(folder, port)
            if existing:
                save(state="monitoring-existing", url=existing, childPid=None)
                log.info("Monitoring separately started server at %s", existing)
                while not stop_requested() and find_server(folder, port):
                    time.sleep(1)
                if stop_requested():
                    log.info("Monitoring stopped; separately started server was left running")
                    break
            env = dict(os.environ, SAMANVAY_DATA_DIR=str(folder), SAMANVAY_PORT=str(port), SAMANVAY_RUNNER_TOKEN=run_id)
            started = time.monotonic()
            process = subprocess.Popen([node, str(ROOT / "server.mjs")], cwd=ROOT, env=env,
                                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, encoding="utf-8", errors="replace",
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            reader = threading.Thread(target=copy_output, args=(process.stdout,), daemon=True)
            reader.start()
            save(state="starting", childPid=process.pid, url=None)
            log.info("Server child started (pid %s)", process.pid)
            while process.poll() is None and not stop_requested():
                if info["state"] != "running":
                    url = find_server(folder, port)
                    if url:
                        save(state="running", url=url)
                        log.info("Ready at %s", url)
                time.sleep(0.35)
            if stop_requested():
                break
            code = process.wait()
            reader.join(timeout=2)
            process.stdout.close()
            process = None
            info["restarts"] += 1
            now = time.monotonic()
            if now - started > 60:
                exits.clear()
            exits.append(now)
            while exits and exits[0] < now - 300:
                exits.popleft()
            log.error("Server exited unexpectedly (code %s); restart %s", code, info["restarts"])
            if len(exits) >= 5:
                save(state="failed", childPid=None, lastExitCode=code, error="Five rapid exits. Check server.log, fix the error and start again.")
                log.error(info["error"])
                return 1
            save(state="restarting", childPid=None, lastExitCode=code)
            end = time.monotonic() + min(2 ** (len(exits) - 1), 16)
            while time.monotonic() < end and not stop_requested():
                time.sleep(0.2)
    except KeyboardInterrupt:
        log.info("Foreground Ctrl+C requested")
    except Exception:
        log.exception("Supervisor failed")
        save(state="failed", error="Launcher error. See data/logs/server.log.")
        return 1
    finally:
        if process is not None and process.poll() is None:
            # Request graceful shutdown; force only our own child if it hangs.
            shutdown_url = info.get("url") or find_server(folder, port)
            if shutdown_url:
                try:
                    req = Request(shutdown_url + "/api/runner/stop", method="POST", headers={"X-Samanvay-Runner": run_id})
                    with urlopen(req, timeout=2):
                        pass
                except (URLError, OSError):
                    pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            if reader:
                reader.join(timeout=2)
            process.stdout.close()
        if info["state"] != "failed":
            save(state="stopped", childPid=None)
        log.info("Supervisor stopped")
        lease.release()
    return 0


def detached(folder, port):
    executable = Path(sys.executable)
    if os.name == "nt" and executable.with_name("pythonw.exe").exists():
        executable = executable.with_name("pythonw.exe")
    command = [str(executable), str(ROOT / "runner.py"), "--supervise", "--data-dir", str(folder), "--port", str(port)]
    options = dict(cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        try:
            return subprocess.Popen(command, creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, **options)
        except PermissionError:
            return subprocess.Popen(command, creationflags=flags, **options)
    return subprocess.Popen(command, start_new_session=True, **options)


def stop(folder):
    if not supervised(folder):
        print("No background supervisor is running.")
        return 0
    info = read_json(folder / "runner.json")
    end = time.monotonic() + 3
    while not info.get("runId") and time.monotonic() < end:
        time.sleep(0.1)
        info = read_json(folder / "runner.json")
    if not info.get("runId"):
        print("Launcher is starting. Try --stop again in a moment.")
        return 1
    write_json(folder / "runner-stop.json", {"runId": info["runId"]})
    end = time.monotonic() + 15
    while supervised(folder) and time.monotonic() < end:
        time.sleep(0.2)
    if supervised(folder):
        print("Shutdown is taking longer than expected. Check data/logs/server.log.")
        return 1
    print("Background supervisor stopped.")
    return 0


def monitor(folder, port):
    """Keep the launch window useful without tying the server to its lifetime."""
    print("Live status is open. The server runs independently in the background.", flush=True)
    print("Ctrl+C closes only this status monitor. To stop the app: python runner.py --stop", flush=True)
    previous = None
    try:
        while True:
            info = read_json(folder / "runner.json")
            url = find_server(folder, port)
            if not supervised(folder):
                # Shutdown may finish during the health probe; use its final state.
                info = read_json(folder / "runner.json")
                if info.get("state") == "stopped":
                    print("Background recovery stopped." + (f" Separately started server remains at {url}" if url else " Server stopped."), flush=True)
                    return 0
                print("Background recovery is no longer active. Recent log:\n" + tail_log(folder), file=sys.stderr, flush=True)
                return 1
            status = (bool(url), info.get("state"), info.get("restarts", 0), url)
            if status != previous:
                if url:
                    print(f"Running: {url} | Automatic restarts: {info.get('restarts', 0)}", flush=True)
                else:
                    print(f"Waiting for server: {info.get('state', 'starting')} | Automatic restarts: {info.get('restarts', 0)}", flush=True)
                previous = status
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStatus monitor closed. The background server remains running.", flush=True)
        return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    for flag in ["status", "stop", "restart", "foreground", "supervise"]:
        mode.add_argument("--" + flag, action="store_true", help=argparse.SUPPRESS if flag == "supervise" else flag.capitalize())
    parser.add_argument("--background", action="store_true", help="Start in the background and return without a live status monitor")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data", help=argparse.SUPPRESS)
    parser.add_argument("--port", type=int, default=3000, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.background and (args.foreground or args.supervise):
        parser.error("--background cannot be combined with --foreground or --supervise")
    if not 1024 <= args.port <= 65515:
        parser.error("Port must be between 1024 and 65515")
    folder = args.data_dir.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    if args.supervise:
        return supervise(folder, args.port)
    if args.stop:
        return stop(folder)
    if args.restart and stop(folder):
        return 1
    url, running = find_server(folder, args.port), supervised(folder)
    if args.status:
        info = read_json(folder / "runner.json")
        print(f"Server: {url or 'not responding'}")
        print(f"Background recovery: {'active' if running else 'not active'}")
        if info:
            print(f"State: {info.get('state', 'unknown')} | Restarts: {info.get('restarts', 0)}")
        print(f"Log: {folder / 'logs' / 'server.log'}")
        return 0 if url else 1
    try:
        check_node()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.foreground:
        if url or running:
            print(f"Samanvay is already running: {url or 'starting; use --status'}")
            return 0
        print("Foreground mode: keep this terminal open. Ctrl+C stops the server.", flush=True)
        return supervise(folder, args.port, foreground=True)
    launcher = None
    previous_run_id = read_json(folder / "runner.json").get("runId")
    if not running:
        print("Starting Samanvay in the background...", flush=True)
        try:
            launcher = detached(folder, args.port)
        except OSError as exc:
            print(f"Unable to start background launcher: {exc}", file=sys.stderr)
            return 1
    end = time.monotonic() + 20
    while time.monotonic() < end:
        url = find_server(folder, args.port)
        if url and supervised(folder):
            print(f"Samanvay is running: {url}", flush=True)
            print("Status: python runner.py --status | Stop: python runner.py --stop", flush=True)
            print(f"Log: {folder / 'logs' / 'server.log'}", flush=True)
            if args.background:
                print("You can close this terminal. Background recovery remains active.", flush=True)
                return 0
            return monitor(folder, args.port)
        info = read_json(folder / "runner.json")
        if info.get("state") == "failed" and info.get("runId") != previous_run_id and not supervised(folder):
            break
        if launcher is not None and launcher.poll() is not None and not supervised(folder):
            break
        time.sleep(0.25)
    print("Server did not become ready. Recent log:\n" + tail_log(folder), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
