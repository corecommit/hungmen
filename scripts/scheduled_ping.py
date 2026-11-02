#!/usr/bin/env python3
"""Stateless randomized keep-alive pinger for GitHub Actions.

GitHub cron cannot fire at random times, so the workflow ticks on a fixed
schedule (every --window seconds) and this script decides whether a ping is
due. The "random" schedule is a chain of gaps, each derived from a hash, with
every gap between --min and --max seconds. The same inputs always produce the
same schedule, so no state has to be stored anywhere. When a scheduled time
falls inside this tick's window, the script sleeps until that exact second
and then pings.

Usage:
  scheduled_ping.py --url URL --min 720 --max 890 --window 300 --salt render
  scheduled_ping.py ... --preview 10     # print the next 10 scheduled times
  scheduled_ping.py ... --force          # ping right now
"""
import argparse
import hashlib
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ANCHOR = int(datetime(2026, 11, 1, tzinfo=timezone.utc).timestamp())


def gap(salt, k, lo, hi):
    digest = hashlib.sha256(f"{salt}:{k}".encode()).digest()
    return lo + int.from_bytes(digest[:8], "big") % (hi - lo + 1)


def schedule(salt, lo, hi, start):
    """Yield scheduled ping times (epoch seconds) that are >= start."""
    t, k = ANCHOR, 0
    while True:
        if t >= start:
            yield t
        t += gap(salt, k, lo, hi)
        k += 1


def fmt(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def ping(url, headers, tries=3):
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": "keepalive/1.0", **headers})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                print(f"HTTP {resp.status}: {resp.read(300).decode(errors='replace')}")
                return True
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code} (attempt {attempt}/{tries})")
        except Exception as e:
            print(f"{type(e).__name__}: {e} (attempt {attempt}/{tries})")
        if attempt < tries:
            time.sleep(20)
    return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--min", type=int, required=True, help="minimum gap in seconds")
    p.add_argument("--max", type=int, required=True, help="maximum gap in seconds")
    p.add_argument("--window", type=int, required=True, help="seconds between workflow ticks")
    p.add_argument("--salt", default="ping", help="different salt = different schedule")
    p.add_argument("--header", action="append", default=[], help='extra header, e.g. "apikey: xyz"')
    p.add_argument("--preview", type=int, default=0, help="print the next N scheduled times and exit")
    p.add_argument("--force", action="store_true", help="ping now, ignore the schedule")
    a = p.parse_args()

    if a.max < a.min:
        sys.exit("--max must be >= --min")

    now = time.time()

    if a.preview:
        prev = None
        for i, t in enumerate(schedule(a.salt, a.min, a.max, int(now))):
            if i >= a.preview:
                break
            delta = "" if prev is None else f"  (+{int(t - prev) // 60}m{int(t - prev) % 60:02d}s)"
            print(f"{fmt(t)}{delta}")
            prev = t
        return 0

    if not a.url.startswith("http"):
        print("URL is missing or invalid - did you add the repo secrets?")
        return 1

    headers = {}
    for h in a.header:
        name, _, value = h.partition(":")
        headers[name.strip()] = value.strip()

    if not a.force:
        half = a.window / 2
        due = next(schedule(a.salt, a.min, a.max, int(now - half)))
        if due >= now + half:
            print(f"Nothing due this tick. Next scheduled ping: {fmt(due)}")
            return 0
        wait = max(0, due - now)
        print(f"Ping scheduled for {fmt(due)}; sleeping {int(wait)}s")
        time.sleep(wait)

    return 0 if ping(a.url, headers) else 1


if __name__ == "__main__":
    sys.exit(main())
