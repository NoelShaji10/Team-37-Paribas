"""Write app/models/MANIFEST.json describing the committed Layer 2 models.

Run from ml-service/ after adding or retraining models:
    python -m training.model_manifest
Commit MANIFEST.json together with the .joblib files, so anyone can check they run the same models.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.services import anomaly_engine as engine  # noqa: E402

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "app", "models")


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    manifest = {}
    for ft in engine.FILE_TYPES:
        path = engine._ref_path(ft, MODEL_DIR)
        if not os.path.exists(path):
            manifest[ft] = None
            continue
        ref = engine.load_reference(ft, MODEL_DIR)
        manifest[ft] = {
            "file": os.path.basename(path),
            "sha256": sha256(path),
            "size_mb": round(os.path.getsize(path) / 1e6, 2),
            "training_rows": ref.get("rows"),
            "fitted_at": ref.get("fitted_at"),
            "code_version": ref.get("version"),
            "sklearn_trained": ref.get("sklearn_trained"),
            "has_isolation_forest": "model" in ref,
            "feature_cols": ref.get("feature_cols"),
            "iforest_cutoff": ref.get("cutoff"),
            "groups_with_baselines": len(ref.get("group_stats", {})),
        }
    out = os.path.join(MODEL_DIR, "MANIFEST.json")
    with open(out, "w") as f:
        json.dump(manifest, f, indent=2)
    for ft, m in manifest.items():
        print(f"{ft:10s} " + ("MISSING" if m is None else
              f"{m['file']}  rows={m['training_rows']:,}  sklearn={m['sklearn_trained']}  {m['size_mb']} MB"))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
