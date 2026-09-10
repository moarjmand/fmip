"""Run the model service: ``python -m fmip_model.service``.

Listens on ``MODEL_PORT`` (default 8000) on all interfaces, because inside a
container loopback is unreachable from siblings; compose keeps the port
unpublished so it stays internal.
"""

from __future__ import annotations

import os
import sys

import uvicorn

from .app import create_app


def main() -> int:
    port = int(os.environ.get("MODEL_PORT", "8000"))
    uvicorn.run(create_app(), host="0.0.0.0", port=port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
