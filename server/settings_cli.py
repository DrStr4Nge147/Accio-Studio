"""Print one setting value (used by Run_Accio.bat). Usage: settings_cli.py <key>"""
import sys

from config import load_settings

if len(sys.argv) == 2:
    print(load_settings().get(sys.argv[1], ""))
