"""Repository-level tests for the Apps Script packaging gate; no Google APIs are called."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import package_apps_script as packager


class PackageAppsScriptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (packager.ROOT / "dist").mkdir(exist_ok=True)

    def test_manifest_is_explicit_and_least_privilege(self):
        manifest = packager.load_manifest()
        self.assertEqual(manifest["runtimeVersion"], "V8")
        self.assertIn("https://www.googleapis.com/auth/spreadsheets", manifest["oauthScopes"])
        self.assertIn("https://www.googleapis.com/auth/userinfo.email", manifest["oauthScopes"])

    def test_manifest_rejects_unreviewed_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "appsscript.json"
            manifest_path.write_text(json.dumps({
                "timeZone": "Africa/Gaborone",
                "runtimeVersion": "V8",
                "oauthScopes": [
                    "https://www.googleapis.com/auth/spreadsheets",
                    "https://www.googleapis.com/auth/userinfo.email",
                    "https://www.googleapis.com/auth/drive"
                ]
            }), encoding="utf-8")
            with mock.patch.object(packager, "MANIFEST", manifest_path):
                with self.assertRaises(SystemExit):
                    packager.load_manifest()

    def test_package_is_deterministic_and_contains_only_deployable_files(self):
        with tempfile.TemporaryDirectory(dir=packager.ROOT / "dist") as first_parent, tempfile.TemporaryDirectory(dir=packager.ROOT / "dist") as second_parent:
            first = packager.build(Path(first_parent) / "package")
            second = packager.build(Path(second_parent) / "package")
            self.assertEqual(sorted(p.name for p in first.iterdir()), ["Code.gs", "appsscript.json"])
            self.assertEqual(sorted(p.name for p in second.iterdir()), ["Code.gs", "appsscript.json"])
            for name in ("Code.gs", "appsscript.json"):
                digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
                self.assertEqual(digest(first / name), digest(second / name))
            code = (first / "Code.gs").read_text(encoding="utf-8")
            self.assertIn("function reclaimGetMyOrganizationSummary(", code)
            self.assertIn("function reclaimSetOrganizationServiceEnabled(", code)
            self.assertIn("function reclaimCreateCollectionSite(", code)
            self.assertIn("function reclaimGetCollectionSite(", code)
            self.assertIn("function reclaimListCollectionSites(", code)
            self.assertIn("function reclaimUpdateCollectionSite(", code)
            self.assertIn("function reclaimDeactivateCollectionSite(", code)
            self.assertIn("function reclaimRecordCollection(", code)
            self.assertIn("function reclaimGetCollectionRecord(", code)
            self.assertIn("function reclaimListCollectionRecords(", code)
            self.assertIn("function reclaimRecordCollectionHandover(", code)
            self.assertIn("function reclaimCreateCustomerRegistration(", code)
            self.assertIn("function reclaimGetCustomerRegistration(", code)
            self.assertIn("function reclaimListCustomerRegistrations(", code)
            self.assertIn("var ReclaimWhatsAppSheetsStore =", code)
            self.assertIn("var ReclaimWhatsAppRegistration =", code)
            self.assertNotIn("function doPost(", code)
            self.assertNotIn("function doGet(", code)
            self.assertNotIn("node:test", code)
            self.assertNotIn("require(", code)

    def test_missing_source_module_fails_closed(self):
        with tempfile.TemporaryDirectory(dir=packager.ROOT / "dist") as tmp:
            source = packager.SOURCE_DIR / packager.MODULE_ORDER[0]
            with mock.patch.object(packager, "SOURCE_DIR", Path(tmp) / "missing-source"):
                with self.assertRaises(SystemExit):
                    packager.build(Path(tmp) / "package")


if __name__ == "__main__":
    unittest.main()
