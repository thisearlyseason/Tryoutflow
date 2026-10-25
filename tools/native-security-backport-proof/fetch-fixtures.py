"""Fetch pinned official registry sources for this local proof; never execute them."""
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
from urllib.parse import urlparse
from urllib.request import urlopen

SPEC_ROOT = Path(__file__).resolve().parent
ROOT = Path.cwd().resolve()
sources = json.loads((SPEC_ROOT / "source-spec.json").read_text())["packages"]
consumers = json.loads((SPEC_ROOT / "consumer-spec.json").read_text())["packages"]
targets = [(ROOT / "evidence/package-fixtures" / p["directory"], p, False) for p in sources]
targets += [(ROOT / "evidence/upstream-inspection" / p["directory"], p, True) for p in consumers]
if any(path.exists() for path, _, _ in targets):
    raise SystemExit("Refusing to overwrite any existing fixture directory; use a fresh proof workspace")
for target, package, selected in targets:
    url = package["registryTarball"]
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "registry.npmjs.org":
        raise SystemExit("Unrecognized source registry")
    with urlopen(url, timeout=30) as response:
        data = response.read(20 * 1024 * 1024 + 1)
    if len(data) > 20 * 1024 * 1024:
        raise SystemExit("Unexpected source archive size")
    actual = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if actual != package["registryIntegrity"]:
        raise SystemExit("Official source integrity mismatch")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.mkdir()
    allow = {f["archivePath"]: f for f in package.get("files", [])}
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for entry in archive.getmembers():
            path = PurePosixPath(entry.name)
            if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "package":
                raise SystemExit("Unsafe source path")
            if entry.issym() or entry.islnk():
                raise SystemExit("Unexpected source link")
            if not entry.isfile() or (selected and entry.name not in allow):
                continue
            content = archive.extractfile(entry).read()
            if selected:
                record = allow[entry.name]
                if hashlib.sha256(content).hexdigest() != record["sha256"]:
                    raise SystemExit("Consumer source mismatch")
                output = target / Path(record["path"]).name
                seen.add(entry.name)
            else:
                output = target.joinpath(*path.parts[1:])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(content)
    if selected and seen != set(allow):
        raise SystemExit("Missing expected consumer source")
    print(f"Verified official source: {package['name']} {package['version']}")
