from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = PLUGIN_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from install_texlive import write_profile  # noqa: E402


class InstallProfileTests(unittest.TestCase):
    def test_managed_profile_keeps_system_trees_under_target_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            target_root = temp_path / "codex-texlive" / "full"
            profile_path = temp_path / "texlive.profile"

            write_profile(profile_path, target_root)
            profile = profile_path.read_text(encoding="utf-8")

        self.assertNotIn("/usr/local/texlive", profile)
        self.assertIn(f"TEXDIR {target_root}", profile)
        self.assertIn(f"TEXMFLOCAL {target_root / 'texmf-local'}", profile)
        self.assertIn(f"TEXMFSYSVAR {target_root / 'texmf-var'}", profile)
        self.assertIn(f"TEXMFSYSCONFIG {target_root / 'texmf-config'}", profile)


if __name__ == "__main__":
    unittest.main()
