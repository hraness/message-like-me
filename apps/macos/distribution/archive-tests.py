import importlib.util
import pathlib
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("textbutler_archive", pathlib.Path(__file__).with_name("archive.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveTests(unittest.TestCase):
    def test_roundtrip_preserves_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app = root / "Textbutler.app"
            app.mkdir()
            file = app / "runtime"
            file.write_bytes(b"synthetic executable")
            file.chmod(0o755)
            archive = root / "input.zip"
            module.pack(app, archive)
            out = root / "out"
            out.mkdir()
            module.extract(archive, out)
            self.assertEqual((out / "Textbutler.app/runtime").read_bytes(), file.read_bytes())
            self.assertEqual((out / "Textbutler.app/runtime").stat().st_mode & 0o777, 0o755)

    def test_hostile_entry(self):
        for name, mode in [("../escape", stat.S_IFREG | 0o644), ("Textbutler.app/link", stat.S_IFLNK | 0o777), ("Other.app/file", stat.S_IFREG | 0o644), ("Textbutler.app/../escape", stat.S_IFREG | 0o644)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                archive = pathlib.Path(directory) / "bad.zip"
                with zipfile.ZipFile(archive, "w") as writer:
                    info = zipfile.ZipInfo(name)
                    info.create_system = 3
                    info.external_attr = mode << 16
                    writer.writestr(info, b"hostile")
                with self.assertRaises(ValueError):
                    module.inspect(archive)


if __name__ == "__main__":
    unittest.main()
