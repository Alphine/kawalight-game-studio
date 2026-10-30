"""Frozen-worker launcher (PyInstaller entry). Absolute imports only."""

import sys

from kgsm.api.server import main

if __name__ == "__main__":
    raise SystemExit(main())
