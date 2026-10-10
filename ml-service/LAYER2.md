# Layer 2: Anomaly detection

Flags unusual rows and files for review. It never rejects (rejection is Layer 1).
Every rule comes from "Data and Business Validations.xlsx"; `GET /anomaly/coverage` lists each workbook anomaly ID and its owner.

## Files

| Path | What |
|---|---|
| `app/services/anomaly_engine.py` | Detection logic: workbook rules, robust z-scores, Isolation Forest + SHAP |
| `app/services/anomaly_detector.py` | Keeps one detector per file between HTTP calls |
| `app/routes/anomaly.py` | Endpoints below |
| `training/train_anomaly.py` | Trains the reference models; `--eval` writes evaluation reports |
| `training/model_manifest.py` | Writes `app/models/MANIFEST.json` for the committed models |
| `tests/test_anomaly_api.py` | API tests |
| `notebooks/anomaly_layer2.ipynb` | Evaluation notebook (overfitting check, 5-seed benchmark) |

## Setup and run (from `ml-service/`)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# models are already committed; retrain only if you need to:
# python -m training.train_anomaly --data-dir ../data
uvicorn app.main:app --port 8000 --reload
curl localhost:8000/anomaly/status                             # every type should show a fitted_at
python -m pytest -q tests
```

### Models
The team's trained models are committed in `app/models/` (`anomaly_*.joblib`) with `MANIFEST.json`
(SHA-256, training rows, date, scikit-learn version, feature columns), so every laptop runs the same models.

* They were trained with scikit-learn 1.6.1 (Colab), so `requirements.txt` pins that version. It needs Python 3.9 to 3.13.
  If your Python is 3.14: `brew install python@3.12` and create the venv with `python3.12 -m venv .venv`.
* `GET /anomaly/status` shows `sklearn_trained`, `sklearn_runtime` and `sklearn_mismatch` for each model.
* To replace the models: retrain (`python -m training.train_anomaly --data-dir ../data`) or copy new
  `anomaly_*.joblib` files in, then run `python -m training.model_manifest` and commit both.
* `tests/test_anomaly_api.py::test_committed_models_match_the_code` fails if a model's features no longer match the code.

## Endpoints

| Method and path | Body | Returns |
|---|---|---|
| `POST /anomaly/detect-batch` | `{fileId, fileType, rows, rowNumbers}` | `{count, flags}` row-level flags |
| `POST /anomaly/finish` | `{fileId}` | file-wide flags (velocity, near-duplicates, rates series); call once per file |
| `POST /anomaly/file-level` | `{features, history}` | size, record count, rejection rate, processing-time flags |
| `POST /anomaly/detect` | `{fileId, features}` | original single-row contract |
| `GET /anomaly/status` | | loaded models |
| `GET /anomaly/coverage` | | workbook coverage table |

Each flag: `row_number, level, anomaly_type, rule_ref, score (0 to 1), method, explanation`.
The backend stores them in the Prisma `Anomaly` table (`description` = explanation; `details` = rule_ref, method, level).

## Evaluation (1M-row files; train 70%, test on held-out 15% and the independent 100k files)

* Overfitting check: Isolation Forest flag rate 0.48% to 0.53% on train, validation, test and the independent file (target 0.5%).
* Baseline drift vs the independent file: under 3% for group medians.
* Planted-anomaly benchmark (5 seeds x 100 per type): recall 1.00 for every check; zero false alarms for transaction and payment amount outliers.
* Isolation Forest alone: ROC-AUC 0.63 (Bank-Txns), 0.73 (Payments), 0.86 (Accounts). It cannot extrapolate beyond the training range, so robust z handles extreme values and Isolation Forest handles unusual combinations.
* These are self-test numbers on planted anomalies, not real-world fraud accuracy.
