"""Test setup: keep learned fixes in a temporary file so tests never touch the real one."""
import os
import tempfile

os.environ["FIX_MEMORY_PATH"] = os.path.join(tempfile.mkdtemp(), "fix_memory.json")
