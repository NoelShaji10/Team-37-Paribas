import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import final_level_validation as fv   # noqa: E402

HDR = ",".join(fv.FILE_TYPES["rates"])
ROW = "RATE-2020-01-06,USD/INR,2020-01-06,86.7,buy"


def svc(tmp_path):
    return fv.FileValidationService(fv.ChecksumRegistry(tmp_path / "reg.sqlite"))


def write(tmp_path, name, content, mode="w"):
    p = tmp_path / name
    if isinstance(content, bytes):
        p.write_bytes(content)
    else:
        p.write_text(content, encoding="utf-8", newline="")
    return p


def code(tmp_path, name, content):
    r = svc(tmp_path).validate_file(write(tmp_path, name, content))
    return r.error_code if not r.passed else "PASS"


def test_good_file_passes(tmp_path):
    r = svc(tmp_path).validate_file(write(tmp_path, "rates_ok.csv", f"{HDR}\n{ROW}\n{ROW}\n"))
    assert r.passed and r.total_rows == 2 and r.file_type == "rates"


def test_bad_extension(tmp_path):
    assert code(tmp_path, "rates_ok.txt", f"{HDR}\n{ROW}\n") == fv.FILE_EXTENSION


def test_bad_filename(tmp_path):
    assert code(tmp_path, "report_final.csv", f"{HDR}\n{ROW}\n") == fv.FILE_NAME_PATTERN


def test_empty_file(tmp_path):
    assert code(tmp_path, "rates_e.csv", b"") == fv.FILE_EMPTY


def test_header_only(tmp_path):
    assert code(tmp_path, "rates_h.csv", f"{HDR}\n") == fv.FILE_EMPTY


def test_semicolon_delimiter(tmp_path):
    assert code(tmp_path, "rates_d.csv", HDR.replace(",", ";") + "\n" + ROW.replace(",", ";") + "\n") == fv.FILE_DELIMITER


def test_header_mismatch(tmp_path):
    assert code(tmp_path, "rates_m.csv", HDR.replace("rate_type", "kind") + f"\n{ROW}\n") == fv.FILE_HEADER_MISMATCH


def test_invalid_utf8(tmp_path):
    assert code(tmp_path, "rates_u.csv", f"{HDR}\n".encode() + b"\xff\xfe,x,y,z,w\n") == fv.FILE_ENCODING


def test_short_row(tmp_path):
    assert code(tmp_path, "rates_s.csv", f"{HDR}\n{ROW}\nRATE-2,USD/INR,2020-01-07\n") == fv.FILE_RECORD_LENGTH


def test_trailer_ok_and_mismatch(tmp_path):
    assert code(tmp_path, "rates_t1.csv", f"{HDR}\n{ROW}\nTRAILER,1\n") == "PASS"
    assert code(tmp_path, "rates_t2.csv", f"{HDR}\n{ROW}\nTRAILER,5\n") == fv.FILE_TRUNCATED


def test_duplicate_file(tmp_path):
    s = svc(tmp_path)
    content = f"{HDR}\n{ROW}\n"
    assert s.validate_file(write(tmp_path, "rates_a.csv", content)).passed
    r = s.validate_file(write(tmp_path, "rates_b.csv", content))
    assert not r.passed and r.error_code == fv.FILE_DUPLICATE


def test_failed_file_does_not_block_resend(tmp_path):
    s = svc(tmp_path)
    bad = f"{HDR}\n{ROW}\nshort\n"
    assert s.validate_file(write(tmp_path, "rates_x.csv", bad)).error_code == fv.FILE_RECORD_LENGTH
    assert s.validate_file(write(tmp_path, "rates_y.csv", bad)).error_code == fv.FILE_RECORD_LENGTH  # not DUPLICATE