from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import compile_latex  # noqa: E402
from compile_latex import tectonic_suitability  # noqa: E402


def usable_texlive_detection() -> dict[str, object]:
    return {
        "status": "existing-usable",
        "reason": "Required TeX tools are available.",
        "searchPath": "/texlive/bin",
        "commands": {
            "latexmk": {"path": "/texlive/bin/latexmk"},
            "pdflatex": {"path": "/texlive/bin/pdflatex"},
            "xelatex": {"path": "/texlive/bin/xelatex"},
            "lualatex": {"path": "/texlive/bin/lualatex"},
        },
    }


def missing_texlive_detection() -> dict[str, object]:
    return {
        "status": "missing",
        "reason": "No TeX Live or MacTeX tools were found.",
        "searchPath": "",
        "commands": {
            "latexmk": {"path": None},
            "pdflatex": {"path": None},
            "xelatex": {"path": None},
            "lualatex": {"path": None},
        },
    }


def available_tectonic_detection() -> dict[str, object]:
    return {
        "status": "available",
        "reason": "Tectonic executable is available.",
        "path": "/plugin/bin/tectonic",
    }


class TectonicSuitabilityTest(unittest.TestCase):
    def test_simple_document_is_suitable_for_tectonic(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "main.tex"
            root.write_text(
                "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
                encoding="utf-8",
            )

            result = tectonic_suitability(root)

        self.assertTrue(result["suitable"])
        self.assertEqual(result["reasons"], [])

    def test_shell_escape_package_requires_texlive(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "main.tex"
            root.write_text(
                "\\documentclass{article}\n"
                "\\usepackage{minted}\n"
                "\\begin{document}\n"
                "\\begin{minted}{python}print('hi')\\end{minted}\n"
                "\\end{document}\n",
                encoding="utf-8",
            )

            result = tectonic_suitability(root)

        self.assertFalse(result["suitable"])
        self.assertIn("minted", "; ".join(result["reasons"]))

    def test_included_bibliography_file_requires_texlive(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "main.tex"
            chapter = Path(temp_dir) / "chapter.tex"
            root.write_text(
                "\\documentclass{article}\n\\begin{document}\n\\input{chapter}\n\\end{document}\n",
                encoding="utf-8",
            )
            chapter.write_text(
                "A citation.\\bibliography{refs}\n",
                encoding="utf-8",
            )

            result = tectonic_suitability(root)

        self.assertFalse(result["suitable"])
        self.assertIn("bibliography", "; ".join(result["reasons"]))
        self.assertIn("chapter.tex", " ".join(result["scannedFiles"]))


class CompileLatexStrategyTest(unittest.TestCase):
    def test_auto_prefers_usable_texlive_over_tectonic(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "main.tex"
            root.write_text(
                "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
                encoding="utf-8",
            )

            with (
                patch.object(
                    compile_latex, "detect_texlive", return_value=usable_texlive_detection()
                ),
                patch.object(
                    compile_latex, "detect_tectonic", return_value=available_tectonic_detection()
                ),
                patch.object(compile_latex, "run_compile_attempt") as run_compile_attempt,
            ):
                run_compile_attempt.side_effect = successful_attempt
                exit_code, result = run_compile_json(root)

        self.assertEqual(exit_code, 0)
        self.assertEqual(result["compiler"], "texlive")
        run_compile_attempt.assert_called_once()
        self.assertEqual(run_compile_attempt.call_args.kwargs["compiler"], "texlive")

    def test_auto_uses_tectonic_when_texlive_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "main.tex"
            root.write_text(
                "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
                encoding="utf-8",
            )

            with (
                patch.object(
                    compile_latex, "detect_texlive", return_value=missing_texlive_detection()
                ),
                patch.object(
                    compile_latex, "detect_tectonic", return_value=available_tectonic_detection()
                ),
                patch.object(compile_latex, "run_compile_attempt") as run_compile_attempt,
            ):
                run_compile_attempt.side_effect = successful_attempt
                exit_code, result = run_compile_json(root)

        self.assertEqual(exit_code, 0)
        self.assertEqual(result["compiler"], "tectonic")
        run_compile_attempt.assert_called_once()
        self.assertEqual(run_compile_attempt.call_args.kwargs["compiler"], "tectonic")

    def test_auto_does_not_fall_back_to_tectonic_after_usable_texlive_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "main.tex"
            root.write_text(
                "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
                encoding="utf-8",
            )

            with (
                patch.object(
                    compile_latex, "detect_texlive", return_value=usable_texlive_detection()
                ),
                patch.object(
                    compile_latex, "detect_tectonic", return_value=available_tectonic_detection()
                ),
                patch.object(compile_latex, "run_compile_attempt") as run_compile_attempt,
            ):
                run_compile_attempt.side_effect = failed_attempt
                exit_code, result = run_compile_json(root)

        self.assertEqual(exit_code, 1)
        self.assertIsNone(result["compiler"])
        run_compile_attempt.assert_called_once()
        self.assertEqual(run_compile_attempt.call_args.kwargs["compiler"], "texlive")
        self.assertEqual(result["attempts"][1]["compiler"], "tectonic")
        self.assertTrue(result["attempts"][1]["skipped"])


def run_compile_json(root: Path) -> tuple[int, dict[str, object]]:
    stdout = io.StringIO()
    with (
        patch.object(sys, "argv", ["compile_latex.py", str(root), "--json"]),
        redirect_stdout(stdout),
    ):
        exit_code = compile_latex.main()
    return exit_code, json.loads(stdout.getvalue())


def successful_attempt(**kwargs: object) -> dict[str, object]:
    pdf_path = kwargs["pdf_path"]
    assert isinstance(pdf_path, Path)
    pdf_path.write_bytes(b"%PDF fake")
    return {
        "compiler": kwargs["compiler"],
        "command": kwargs["command"],
        "exitCode": 0,
        "pdfPath": str(pdf_path),
        "pdfExists": True,
        "log": "",
    }


def failed_attempt(**kwargs: object) -> dict[str, object]:
    pdf_path = kwargs["pdf_path"]
    assert isinstance(pdf_path, Path)
    return {
        "compiler": kwargs["compiler"],
        "command": kwargs["command"],
        "exitCode": 1,
        "pdfPath": str(pdf_path),
        "pdfExists": False,
        "log": "failed",
    }


if __name__ == "__main__":
    unittest.main()
