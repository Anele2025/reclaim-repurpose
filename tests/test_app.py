import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app


class AppDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "test.sqlite3"
        app.initialize_database(self.db)

    def tearDown(self):
        self.temp.cleanup()

    def site(self, country="Botswana"):
        return app.add_site({"country": country, "name": "Test site", "status": "ACTIVE"}, self.db)

    def partner(self, country="Botswana"):
        return app.add_partner({
            "country": country, "name": "Test partner",
            "accepted_materials": "PET plastic", "verification_status": "CONDITIONS_VERIFIED"
        }, self.db)

    def collection(self, site_id, unit="kg", quantity="10"):
        return app.add_collection({
            "site_id": str(site_id), "collected_on": "2026-10-15",
            "material": "PET plastic", "quantity": quantity, "unit": unit,
            "measurement_status": "MEASURED", "status": "RECORDED"
        }, self.db)

    def test_create_site_collection_and_handover(self):
        site_id = self.site()
        partner_id = self.partner()
        collection_id = self.collection(site_id)
        handover_id = app.add_handover({
            "collection_id": str(collection_id), "partner_id": str(partner_id),
            "handed_over_on": "2026-10-15", "offered_quantity": "10",
            "accepted_quantity": "8", "rejected_quantity": "2", "unit": "kg",
            "status": "ACCEPTED", "receipt_ref": "TEST_RECEIPT_001"
        }, self.db)
        with app.connect(self.db) as db:
            handover = db.execute("SELECT * FROM handovers WHERE id=?", (handover_id,)).fetchone()
            collection = db.execute("SELECT status FROM collections WHERE id=?", (collection_id,)).fetchone()
            audit_count = db.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]
        self.assertEqual(handover["accepted_quantity"], 8)
        self.assertEqual(handover["rejected_quantity"], 2)
        self.assertEqual(collection["status"], "HANDED_OVER")
        self.assertEqual(audit_count, 4)

    def test_negative_or_non_finite_quantity_rejected(self):
        for value in ("-1", "nan", "inf", "not-a-number"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                app._quantity(value)

    def test_handover_cannot_exceed_collected_quantity(self):
        site_id = self.site()
        partner_id = self.partner()
        collection_id = self.collection(site_id, quantity="5")
        with self.assertRaisesRegex(ValueError, "cannot exceed"):
            app.add_handover({
                "collection_id": str(collection_id), "partner_id": str(partner_id),
                "handed_over_on": "2026-10-15", "offered_quantity": "6",
                "accepted_quantity": "6", "rejected_quantity": "0", "unit": "kg",
                "status": "DELIVERED"
            }, self.db)

    def test_handover_units_must_match_collection(self):
        site_id = self.site()
        partner_id = self.partner()
        collection_id = self.collection(site_id, unit="kg")
        with self.assertRaisesRegex(ValueError, "unit must match"):
            app.add_handover({
                "collection_id": str(collection_id), "partner_id": str(partner_id),
                "handed_over_on": "2026-10-15", "offered_quantity": "1",
                "accepted_quantity": "1", "rejected_quantity": "0", "unit": "bag",
                "status": "DELIVERED"
            }, self.db)

    def test_country_currency_pair_is_enforced(self):
        with self.assertRaisesRegex(ValueError, "Currency must match"):
            app.add_finance({
                "country": "Botswana", "kind": "COST", "description": "Test",
                "amount": "12", "currency": "SZL", "status": "INCURRED",
                "occurred_on": "2026-10-15"
            }, self.db)

    def test_approved_compliance_requires_evidence(self):
        with self.assertRaisesRegex(ValueError, "requires an evidence reference"):
            app.add_compliance({
                "country": "Eswatini", "activity": "Collection",
                "requirement": "Test permission", "status": "APPROVED"
            }, self.db)

    def test_dashboard_empty_state_has_no_fabricated_activity(self):
        with patch.object(app, "DB_PATH", self.db):
            with app.connect(self.db) as db:
                page = app.render(db)
        self.assertIn("No records yet.", page)
        self.assertIn("Development prototype — local use only.", page)
        self.assertIn("<strong>0</strong>", page)

    def test_empty_csv_export_has_headers(self):
        captured = {}
        def start_response(status, headers):
            captured["status"] = status
            captured["headers"] = dict(headers)
        with patch.object(app, "DB_PATH", self.db):
            body = b"".join(app.application({
                "REQUEST_METHOD": "GET", "PATH_INFO": "/export/sites"
            }, start_response)).decode()
        self.assertEqual(captured["status"], "200 OK")
        self.assertIn("country", body)
        self.assertIn("name", body)
        self.assertEqual(captured["headers"]["Content-Type"], "text/csv; charset=utf-8")


if __name__ == "__main__":
    unittest.main()
