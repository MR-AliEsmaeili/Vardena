#!/usr/bin/env python3
"""CI-only: real Compose entrypoints/probes, built image and migrated PostgreSQL.

Uses a private temporary network and ONLY removes containers/network it creates.
Never stops PostgreSQL, runs migrations or mounts/removes database volumes.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit
import uuid

ROOT = Path(__file__).resolve().parents[2]
ENV = os.environ.copy()


def run(*args, check=True, timeout=30):
    result = subprocess.run(args, cwd=ROOT, env=ENV, capture_output=True,
                            text=True, timeout=timeout)
    if check and result.returncode:
        # Do not print arguments/config/env: they may contain deployment secrets.
        raise AssertionError(f"{args[0]} {args[1]} failed: {result.stderr}")
    return result


def inspect(name):
    return json.loads(run("docker", "inspect", name).stdout)[0]


def wait_health(name, expected, seconds=45):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        state = inspect(name)["State"]
        if state["Status"] != "running":
            raise AssertionError(f"{name}: process exited instead of {expected}")
        if state.get("Health", {}).get("Status") == expected:
            print(f"{name}: {expected}", flush=True)
            return
        time.sleep(1)
    raise AssertionError(f"{name}: did not become {expected}: {json.dumps(state.get('Health', {}))}")


def probe(name, test):
    args = ["sh", "-c", test[1]] if test[0] == "CMD-SHELL" else test[1:]
    return run("docker", "exec", name, *args, check=False).returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="vardena-customer-check")
    parser.add_argument("--postgres-container", required=True)
    options = parser.parse_args()
    project = "vardena-health-" + uuid.uuid4().hex[:12]
    api, worker, failed = (project + suffix for suffix in ("-api", "-worker", "-failed"))
    url = urlsplit(ENV["VARDENA_TEST_DATABASE_URL"])
    credentials = url.netloc.rsplit("@", 1)[0] + "@" if "@" in url.netloc else ""
    ENV.update(DATABASE_URL=urlunsplit(url._replace(netloc=credentials + "postgres-health:5432")),
               NODE_ENV="test", LOG_LEVEL="warn", SWAGGER_ENABLED="false")
    image_test = inspect(options.image)["Config"]["Healthcheck"]["Test"]
    assert image_test[0] == "CMD-SHELL" and "/api/v1/health/ready" in image_test[1], "API image probe changed"
    containers = []
    network_created = connected = passed = False
    with tempfile.TemporaryDirectory(prefix="vardena-health-") as temporary:
        override = Path(temporary) / "compose.json"
        # Only the image tag, probe cadence, restart policy and isolated network
        # change. Commands, environment wiring and probe tests come from real Compose.
        override.write_text(json.dumps({
            "services": {name: {"image": options.image, "restart": "no", "healthcheck": {
                "interval": "2s", "timeout": "5s", "start_period": "1s", "retries": 2,
            }} for name in ("api", "worker")},
            "networks": {"default": {"external": True, "name": project}},
        }))
        compose = ["docker", "compose", "-p", project, "-f", str(ROOT / "docker-compose.yml"), "-f", str(override)]
        try:
            run("docker", "network", "create", project)
            network_created = True
            run("docker", "network", "connect", "--alias", "postgres-health", project, options.postgres_container)
            connected = True
            for service, name in (("api", api), ("worker", worker)):
                run(*compose, "run", "--no-deps", "--pull", "never", "-d", "--name", name, service, timeout=60)
                containers.append(name)
                wait_health(name, "healthy")
            worker_test = inspect(worker)["Config"]["Healthcheck"]["Test"]
            assert worker_test == ["CMD", "node", "dist/worker-healthcheck.js"], "Worker inherited the wrong probe"
            assert inspect(worker)["Config"]["Cmd"] == ["node", "--enable-source-maps", "dist/worker.js"], "Worker command drifted"
            assert inspect(api)["Config"]["Healthcheck"]["Test"] == image_test, "API lost the image HTTP probe"
            print("Effective API probe:", image_test, "\nEffective worker probe:", worker_test, flush=True)
            assert probe(worker, worker_test) == 0, "Ready worker failed its own probe"
            assert probe(worker, image_test) != 0, "Inherited HTTP-probe failure was not reproduced"
            print("REPRODUCED: inherited API HTTP probe fails in the healthy non-HTTP worker", flush=True)

            pid = inspect(worker)["State"]["Pid"]
            for name, unaffected in ((worker, api), (api, worker)):
                run("docker", "network", "disconnect", project, name)
                wait_health(name, "unhealthy")
                assert inspect(unaffected)["State"]["Health"]["Status"] == "healthy"
                assert inspect(name)["State"]["Running"]
                run("docker", "network", "connect", project, name)
                wait_health(name, "healthy")
            assert inspect(worker)["State"]["Pid"] == pid, "Worker restarted instead of reporting DB state"
            print("Real database loss/recovery detected independently by API and worker", flush=True)

            # STOP only PID 1, not `docker pause` (which would also stop probe execs).
            run("docker", "kill", "--signal", "STOP", worker)
            try:
                wait_health(worker, "unhealthy")
                assert probe(worker, worker_test) != 0, "Stalled worker incorrectly reported ready"
            finally:
                run("docker", "kill", "--signal", "CONT", worker)
            wait_health(worker, "healthy")
            print("Live but stalled worker fails the freshness check", flush=True)

            run("docker", "stop", "--time", "10", worker)
            assert inspect(worker)["State"]["ExitCode"] == 0, "SIGTERM did not shut down cleanly"
            health_file = worker + ":/tmp/vardena-worker-health.json"
            assert run("docker", "cp", health_file, temporary + "/signal", check=False).returncode != 0
            run("docker", "start", worker)
            wait_health(worker, "healthy")
            print("Graceful shutdown removes readiness; container restart recovers", flush=True)

            # Seed old PID-1 evidence, then prove the real startup gate clears it
            # and exits nonzero with a refused database (no dependency mocks).
            seed = "require('node:fs').writeFileSync('/tmp/vardena-worker-health.json',JSON.stringify({pid:1,checkedAtMs:Date.now(),databaseUp:true}))"
            entry = "node -e " + shlex.quote(seed) + "; exec node --enable-source-maps dist/worker.js"
            run(*compose, "run", "--no-deps", "--pull", "never", "-d", "--name", failed,
                "-e", "DATABASE_URL=postgresql://probe@postgres-health:1/probe",
                "--entrypoint", "sh", "worker", "-c", entry, timeout=60)
            containers.append(failed)
            assert int(run("docker", "wait", failed).stdout.strip()) != 0, "DB startup failure was hidden"
            assert run("docker", "cp", failed + ":/tmp/vardena-worker-health.json",
                       temporary + "/failed-signal", check=False).returncode != 0
            print("Unreachable database aborts startup and cannot reuse an old heartbeat", flush=True)
            passed = True
        finally:
            for name in containers:
                if not passed:
                    logs = run("docker", "logs", "--tail", "30", name, check=False)
                    print(name, logs.stdout, logs.stderr, flush=True)
                run("docker", "rm", "-f", name, check=False)
            if connected:
                run("docker", "network", "disconnect", project, options.postgres_container, check=False)
            if network_created:
                run("docker", "network", "rm", project, check=False)
    print("PASS: production Compose API/worker health regression smoke", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error title=Worker health regression::{type(error).__name__}: {message}", flush=True)
        raise
