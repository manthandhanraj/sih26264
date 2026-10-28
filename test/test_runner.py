"""Real process lifecycle tests; use temporary databases, never workspace data."""
from pathlib import Path
from urllib.request import urlopen
import json
from contextlib import closing
import os
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


def wait_for(predicate, timeout=30):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = predicate()
        if result:
            return result
        time.sleep(0.15)
    raise AssertionError("Expected process state was not reached within the timeout")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    return port if port <= 65515 else free_port()


def health(url):
    try:
        with urlopen(url + "/api/health", timeout=0.4) as response:
            return json.loads(response.read())
    except (OSError, ValueError):
        return None


class RunnerTests(unittest.TestCase):
    def launch(self, folder, port, *args):
        if not args:
            args = ("--background",)
        return subprocess.run([sys.executable, str(ROOT / "runner.py"), "--data-dir", str(folder),
                               "--port", str(port), *args], cwd=ROOT, capture_output=True,
                              text=True, timeout=45)

    def test_default_monitor_stays_open_and_survives_closing_its_launcher(self):
        with tempfile.TemporaryDirectory(prefix="samanvay-runner-monitor-") as temporary:
            folder, port = Path(temporary), free_port()
            url = f"http://127.0.0.1:{port}"
            command = [sys.executable, str(ROOT / "runner.py"), "--data-dir", str(folder), "--port", str(port)]
            process = None
            with (folder / "console.log").open("w", encoding="utf-8") as output:
                try:
                    process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                    wait_for(lambda: "Live status is open" in (folder / "console.log").read_text(encoding="utf-8"))
                    original = health(url)
                    self.assertIsNotNone(original)
                    self.assertIsNone(process.poll(), "Default launch must keep the status window open")
                    process.terminate()  # Close only this isolated test's status monitor.
                    process.wait(timeout=10)
                    self.assertEqual(wait_for(lambda: health(url))["pid"], original["pid"])
                    # A second status window must reuse the same server and exit on an explicit stop.
                    process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                    wait_for(lambda: (folder / "console.log").read_text(encoding="utf-8").count("Live status is open") == 2)
                    self.assertEqual(health(url)["pid"], original["pid"])
                    stopped = self.launch(folder, port, "--stop")
                    self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
                    self.assertEqual(process.wait(timeout=15), 0)
                    self.assertIsNone(health(url))
                finally:
                    self.launch(folder, port, "--stop")
                    if process is not None and process.poll() is None:
                        process.terminate()
                        process.wait(timeout=10)

    def test_background_duplicate_start_crash_recovery_and_deliberate_stop(self):
        with tempfile.TemporaryDirectory(prefix="samanvay-runner-") as temporary:
            folder, port = Path(temporary), free_port()
            url = f"http://127.0.0.1:{port}"
            try:
                result = self.launch(folder, port)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                # Startup command has exited; its detached server must remain alive.
                live = wait_for(lambda: health(url))
                self.assertEqual(Path(live["dataDirectory"]), folder)
                first = json.loads((folder / "runner.json").read_text())
                self.assertEqual(first["childPid"], live["pid"])
                count = sqlite3.connect(folder / "samanvay.sqlite")
                original_count = count.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
                count.close()
                self.assertGreater(original_count, 0)
                result = self.launch(folder, port)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(json.loads((folder / "runner.json").read_text())["supervisorPid"], first["supervisorPid"])
                # Kill only the child belonging to this isolated test database.
                self.assertEqual(health(url)["pid"], first["childPid"])
                self.assertEqual(Path(health(url)["dataDirectory"]), folder)
                os.kill(first["childPid"], signal.SIGTERM)
                restarted = wait_for(lambda: (h if (h := health(url)) and h["pid"] != first["childPid"] else None))
                wait_for(lambda: json.loads((folder / "runner.json").read_text())["restarts"] >= 1)
                self.assertNotEqual(restarted["pid"], first["childPid"])
                self.assertIn("exited unexpectedly", (folder / "logs" / "server.log").read_text(encoding="utf-8"))
                result = self.launch(folder, port, "--stop")
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIsNone(health(url))
                self.assertFalse((folder / "server.lock").exists(), "Graceful shutdown must remove its database lock")
                time.sleep(1.5)
                self.assertIsNone(health(url), "Explicit stop must not trigger recovery")
                self.assertEqual(self.launch(folder, port, "--status").returncode, 1)
                with closing(sqlite3.connect(folder / "samanvay.sqlite")) as db:
                    self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM cases").fetchone()[0], original_count)
            finally:
                self.launch(folder, port, "--stop")

    def test_permanent_startup_error_is_logged_and_restarts_are_bounded(self):
        with tempfile.TemporaryDirectory(prefix="samanvay-runner-failure-") as temporary:
            folder, port = Path(temporary), free_port()
            # A live PID in the test-only database lock simulates a startup conflict.
            (folder / "server.lock").write_text(str(os.getpid()))
            try:
                result = self.launch(folder, port)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                wait_for(lambda: json.loads((folder / "runner.json").read_text())["state"] == "failed")
                info = json.loads((folder / "runner.json").read_text())
                self.assertEqual(info["restarts"], 5, json.dumps(info) + "\n" + (folder / "logs" / "server.log").read_text(encoding="utf-8"))
                self.assertIn("Five rapid exits", info["error"])
                self.assertIn("already has a running server", (folder / "logs" / "server.log").read_text(encoding="utf-8"))
                self.assertIn("Recent log", result.stderr)
                # A previous failure must not make a fresh launch exit before its supervisor starts.
                (folder / "server.lock").unlink()
                retry = self.launch(folder, port)
                self.assertEqual(retry.returncode, 0, retry.stdout + retry.stderr)
                self.assertTrue(health(f"http://127.0.0.1:{port}"))
                self.assertNotEqual(json.loads((folder / "runner.json").read_text())["runId"], info["runId"])
            finally:
                self.launch(folder, port, "--stop")


if __name__ == "__main__":
    unittest.main(verbosity=2)
