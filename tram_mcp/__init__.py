from tram_mcp._autoupdate import spawn_background_upgrade
from tram_mcp.server import mcp


def main():
    spawn_background_upgrade()
    mcp.run(log_level="WARNING")
