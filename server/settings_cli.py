"""Print one derived setting (used by Run_Accio.bat). Usage: settings_cli.py <key>

Keys: port, comfy_url, comfy_port, comfy_dir, launch_flags, external (1 when an external ComfyUI is configured),
zrok_name (the name saved by Setup_Zrok.bat, empty if none).
Also: `settings_cli.py reset_password` removes the password and signs every device out (Reset_Password.bat).
"""
import sys

import config

if len(sys.argv) == 2:
    s = config.load_settings()
    key = sys.argv[1]
    if key == "port":
        print(int(s["port"]))
    elif key == "comfy_url":
        print(config.comfy_url(s))
    elif key == "comfy_port":
        print(int(s["comfy_port"]))
    elif key == "comfy_dir":
        print(config.comfy_dir(s))
    elif key == "launch_flags":
        print(config.install_state().get("launch_flags", ""))
    elif key == "external":
        print("1" if str(s["external_comfy_url"]).strip() else "0")
    elif key == "zrok_name":
        import tunnels

        print(tunnels.reserved_name() or "")
    elif key == "reset_password":
        config.save_setting("_auth", None)
        (config.DATA_DIR / "sessions.json").unlink(missing_ok=True)
        print("Password removed. Open Accio to set a new one.")
