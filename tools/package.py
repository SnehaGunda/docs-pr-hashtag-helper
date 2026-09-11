"""Package the extension into a store-ready ZIP.

Produces browser-specific ZIP files containing only the files needed at runtime
(no dev tooling, no git, no dist output). The version is read from manifest.json.

Run:
    python tools/package.py
"""

import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(ROOT, "dist")

# Files and folders included in the published package.
INCLUDE = [
    "README.md",
    "PRIVACY.md",
    "src",
    "options",
    "icons",
]


def iter_files():
    for entry in INCLUDE:
        path = os.path.join(ROOT, entry)
        if os.path.isfile(path):
            yield path, entry
        elif os.path.isdir(path):
            for base, _dirs, files in os.walk(path):
                for name in files:
                    full = os.path.join(base, name)
                    yield full, os.path.relpath(full, ROOT)


def main():
    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
        version = json.load(f)["version"]

    os.makedirs(DIST_DIR, exist_ok=True)
    packages = {
        "chromium": "manifest.json",
        "firefox": "manifest.firefox.json",
    }

    for browser, manifest_name in packages.items():
        out = os.path.join(
            DIST_DIR, f"docs-pr-hashtag-helper-{version}-{browser}.zip"
        )
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(os.path.join(ROOT, manifest_name), "manifest.json")
            for full, arc in iter_files():
                zf.write(full, arc.replace(os.sep, "/"))
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
