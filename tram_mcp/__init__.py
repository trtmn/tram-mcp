import sys

from tram_mcp._autoupdate import spawn_background_upgrade
from tram_mcp.server import mcp

try:
    from importlib.metadata import version as _pkg_version

    __version__ = _pkg_version("tram-mcp")
except Exception:
    __version__ = "unknown"


def main():
    print(f"[tram-mcp] starting v{__version__}", file=sys.stderr, flush=True)
    spawn_background_upgrade()
    mcp.run(log_level="WARNING")
