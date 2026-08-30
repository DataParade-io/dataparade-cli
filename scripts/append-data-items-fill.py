#!/usr/bin/env python3
"""Append additional data_item gold from existing include scopes."""
from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent / "tests" / "benchmark" / "repos"


class NoAliasDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


def load(path: Path) -> dict:
    if not path.exists():
        return {"annotations": []}
    return yaml.safe_load(path.read_text()) or {"annotations": []}


def dump(path: Path, data: dict) -> None:
    path.write_text(
        yaml.dump(
            data,
            Dumper=NoAliasDumper,
            sort_keys=False,
            allow_unicode=True,
            default_flow_style=False,
        )
    )


def scope_of(repo: str) -> list[str]:
    anns = load(ROOT / repo / "annotations" / "data_items.yaml").get("annotations") or []
    for a in anns:
        files = (a.get("expected") or {}).get("exhaustive_scope_files")
        if files:
            return list(files)
    comps = load(ROOT / repo / "annotations" / "components.yaml").get("annotations") or []
    for a in comps:
        files = (a.get("expected") or {}).get("exhaustive_scope_files")
        if files:
            return list(files)
    return []


def prov() -> dict:
    return {
        "proposed_by": "grok-4.6-data-item-fill",
        "proposed_at": "2026-08-30",
        "review_state": "proposed",
    }


def item(
    rec_id: str,
    key: str,
    name: str,
    file_path: str,
    start: int,
    end: int,
    labels: list[str],
    rationale: str,
    scope: list[str],
    extra_files: list[str] | None = None,
) -> dict:
    files = list(dict.fromkeys(list(scope) + (extra_files or []) + [file_path]))
    expected = {"status": "positive", "labels": labels, "exhaustive_scope_files": files}
    return {
        "id": rec_id,
        "layer": "data_items",
        "subject": {"key": key, "name": name},
        "evidence": {"file_path": file_path, "start_line": start, "end_line": end},
        "expected": expected,
        "rationale": rationale,
        "provenance": prov(),
    }


def append(repo: str, records: list[dict]) -> int:
    path = ROOT / repo / "annotations" / "data_items.yaml"
    data = load(path)
    existing = data.get("annotations") or []
    ids = {a["id"] for a in existing}
    added = 0
    for rec in records:
        if rec["id"] in ids:
            continue
        existing.append(rec)
        ids.add(rec["id"])
        added += 1
    data["annotations"] = existing
    dump(path, data)
    return added


def main() -> int:
    wp = scope_of("wordpress")
    dc = scope_of("discourse")
    mg = scope_of("magento")
    gh = scope_of("ghost")
    np = scope_of("nopcommerce")
    es = ["students/models.py"]
    vgs = ["app/models.py", "app/checker_client.py"]

    n = 0
    n += append(
        "easy-school",
        [
            item("easy-school-admission-no", "data_item:admission_no", "admission_no", "students/models.py", 18, 18, ["user_identifier"], "admission_no is the unique student identifier.", es),
            item("easy-school-student-first-name", "data_item:first_name", "first_name", "students/models.py", 20, 20, ["person_name"], "Student first_name is a given name stored on the registry.", es),
            item("easy-school-student-last-name", "data_item:last_name", "last_name", "students/models.py", 21, 21, ["person_name"], "Student last_name is a family name stored on the registry.", es),
            item("easy-school-student-dob", "data_item:date_of_birth", "date_of_birth", "students/models.py", 23, 23, ["date_of_birth"], "date_of_birth is the student's birth date.", es),
            item("easy-school-student-address", "data_item:address", "address", "students/models.py", 25, 25, ["street_address"], "address is the student's postal address string.", es),
            item("easy-school-guardian-name", "data_item:name", "name", "students/models.py", 58, 58, ["person_name"], "Guardian.name is the parent or guardian's personal name.", es),
            item("easy-school-guardian-ssn", "data_item:social_security_number", "social_security_number", "students/models.py", 61, 61, ["national_identifier"], "Guardian.social_security_number is a national identifier CharField.", es),
            item("easy-school-guardian-phone", "data_item:phone_number", "phone_number", "students/models.py", 62, 62, ["phone_number"], "Guardian.phone_number is a contact telephone.", es),
        ],
    )
    n += append(
        "vgs-django",
        [
            item("vgs-django-ssn", "data_item:social_security_number", "social_security_number", "app/models.py", 5, 5, ["national_identifier"], "PiiData.social_security_number stores SSN as a CharField.", vgs),
            item("vgs-django-dln", "data_item:driver_license_number", "driver_license_number", "app/models.py", 6, 6, ["national_identifier"], "PiiData.driver_license_number stores a driver license identifier.", vgs),
        ],
    )
    n += append(
        "wordpress",
        [
            item("wordpress-user-id-property", "data_item:ID", "ID", "src/wp-includes/class-wp-user.php", 62, 62, ["user_identifier"], "WP_User::$ID is the numeric user primary key.", wp),
            item("wordpress-nickname", "data_item:nickname", "nickname", "src/wp-includes/class-wp-user.php", 17, 17, ["person_name"], "nickname is a display alias on the WP_User profile.", wp),
            item("wordpress-user-nicename", "data_item:user_nicename", "user_nicename", "src/wp-includes/class-wp-user.php", 26, 26, ["user_identifier"], "user_nicename is the URL-safe account slug for the user.", wp),
            item("wordpress-comment-author", "data_item:comment_author", "comment_author", "src/wp-includes/class-wp-comment.php", 91, 91, ["person_name"], "comment_author is the public name of the commenter.", wp, ["src/wp-includes/class-wp-comment.php"]),
            item("wordpress-comment-author-email", "data_item:comment_author_email", "comment_author_email", "src/wp-includes/class-wp-comment.php", 99, 99, ["email_address"], "comment_author_email is the commenter's email address.", wp, ["src/wp-includes/class-wp-comment.php"]),
            item("wordpress-application-password-hash", "data_item:application_password", "password", "src/wp-includes/class-wp-application-passwords.php", 105, 105, ["password_verifier"], "The stored application password field is a one-way hash, not plaintext.", wp, ["src/wp-includes/class-wp-application-passwords.php"]),
        ],
    )
    n += append(
        "discourse",
        [
            item("discourse-user-ip-address", "data_item:ip_address", "ip_address", "app/models/user.rb", 161, 161, ["user_identifier"], "User.ip_address is the last-seen client IP stored on the account.", dc, ["app/models/user.rb"]),
            item("discourse-registration-ip", "data_item:registration_ip_address", "registration_ip_address", "app/models/user.rb", 2455, 2455, ["user_identifier"], "Schema documents registration_ip_address as an inet column on users.", dc),
            item("discourse-invite-email", "data_item:invite_email", "email", "app/models/invite.rb", 33, 33, ["email_address"], "Invite.email is the invited person's mailbox when the invite is email-bound.", dc, ["app/models/invite.rb"]),
            item("discourse-invite-email-token", "data_item:email_token", "email_token", "app/models/invite.rb", 51, 51, ["access_token"], "Invite.email_token is a secret redemption token tied to the invite email.", dc, ["app/models/invite.rb"]),
            item("discourse-ip-history", "data_item:ip_address_history", "ip_address", "app/models/user_ip_address_history.rb", 7, 7, ["user_identifier"], "UserIpAddressHistory.ip_address records prior login IPs per user.", dc, ["app/models/user_ip_address_history.rb"]),
            item("discourse-user-password-raw", "data_item:raw_password", "password", "app/models/user_password.rb", 21, 26, ["credential_secret"], "UserPassword#password= holds the submitted plaintext until hashing.", dc, ["app/models/user_password.rb"]),
        ],
    )
    n += append(
        "magento",
        [
            item("magento-address-city", "data_item:city", "city", "app/code/Magento/Customer/Api/Data/AddressInterface.php", 195, 195, ["city"], "AddressInterface::getCity is the locality of a customer address.", mg, ["app/code/Magento/Customer/Api/Data/AddressInterface.php"]),
            item("magento-address-postcode", "data_item:postcode", "postcode", "app/code/Magento/Customer/Api/Data/AddressInterface.php", 180, 180, ["postal_code"], "AddressInterface::getPostcode is the postal code of a customer address.", mg, ["app/code/Magento/Customer/Api/Data/AddressInterface.php"]),
            item("magento-address-firstname", "data_item:address_firstname", "firstname", "app/code/Magento/Customer/Api/Data/AddressInterface.php", 210, 210, ["person_name"], "Address firstname is the given name on a shipping or billing address.", mg, ["app/code/Magento/Customer/Api/Data/AddressInterface.php"]),
            item("magento-address-lastname", "data_item:address_lastname", "lastname", "app/code/Magento/Customer/Api/Data/AddressInterface.php", 225, 225, ["person_name"], "Address lastname is the family name on a shipping or billing address.", mg, ["app/code/Magento/Customer/Api/Data/AddressInterface.php"]),
            item("magento-customer-prefix", "data_item:prefix", "prefix", "app/code/Magento/Customer/Api/Data/CustomerInterface.php", 245, 245, ["person_name"], "Customer prefix is an honorific name part on the account.", mg, ["app/code/Magento/Customer/Api/Data/CustomerInterface.php"]),
            item("magento-customer-suffix", "data_item:suffix", "suffix", "app/code/Magento/Customer/Api/Data/CustomerInterface.php", 260, 260, ["person_name"], "Customer suffix is a name suffix on the account.", mg, ["app/code/Magento/Customer/Api/Data/CustomerInterface.php"]),
        ],
    )
    n += append(
        "ghost",
        [
            item("ghost-staff-user-id", "data_item:user_id", "id", "ghost/core/core/server/data/schema/schema.js", 270, 270, ["user_identifier"], "users.id is the staff user primary key.", gh),
            item("ghost-staff-user-name", "data_item:user_name", "name", "ghost/core/core/server/data/schema/schema.js", 271, 271, ["person_name"], "users.name is the staff member's display name.", gh),
            item("ghost-staff-user-email", "data_item:user_email", "email", "ghost/core/core/server/data/schema/schema.js", 274, 279, ["email_address"], "users.email is the required unique staff mailbox.", gh),
            item("ghost-staff-user-password", "data_item:user_password", "password", "ghost/core/core/server/data/schema/schema.js", 273, 273, ["password_verifier"], "users.password is the stored staff password hash column.", gh),
        ],
    )
    n += append(
        "nopcommerce",
        [
            item("nopcommerce-customer-guid", "data_item:CustomerGuid", "CustomerGuid", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 19, 19, ["user_identifier"], "CustomerGuid is a stable identifier for the customer account.", np),
            item("nopcommerce-customer-first-name", "data_item:FirstName", "FirstName", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 34, 34, ["person_name"], "Customer.FirstName is the given name on the storefront profile.", np),
            item("nopcommerce-customer-last-name", "data_item:LastName", "LastName", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 39, 39, ["person_name"], "Customer.LastName is the family name on the storefront profile.", np),
            item("nopcommerce-customer-dob", "data_item:DateOfBirth", "DateOfBirth", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 49, 49, ["date_of_birth"], "Customer.DateOfBirth is the account holder's birth date.", np),
            item("nopcommerce-street-address", "data_item:StreetAddress", "StreetAddress", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 59, 59, ["street_address"], "Customer.StreetAddress is the primary street line.", np),
            item("nopcommerce-zip", "data_item:ZipPostalCode", "ZipPostalCode", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 69, 69, ["postal_code"], "Customer.ZipPostalCode is the postal code.", np),
            item("nopcommerce-city", "data_item:City", "City", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 74, 74, ["city"], "Customer.City is the locality on the customer profile.", np),
            item("nopcommerce-phone", "data_item:Phone", "Phone", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 94, 94, ["phone_number"], "Customer.Phone is the contact telephone number.", np),
        ],
    )
    print(f"added {n} data_items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
