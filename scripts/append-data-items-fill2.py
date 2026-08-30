#!/usr/bin/env python3
"""Second pass: more data_item gold from existing include scopes."""
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
    return []


def prov() -> dict:
    return {
        "proposed_by": "grok-4.6-data-item-fill2",
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
    sp = scope_of("spree")
    oc = scope_of("orchard-core")
    st = scope_of("strapi")
    dx = scope_of("directus")
    pb = scope_of("pocketbase")
    rm = scope_of("redmine")
    es = scope_of("easy-school")
    sb = scope_of("supabase-js")

    n = 0
    n += append(
        "wordpress",
        [
            item("wordpress-comment-author-ip", "data_item:comment_author_IP", "comment_author_IP", "src/wp-includes/class-wp-comment.php", 115, 115, ["user_identifier"], "comment_author_IP stores the commenter's client IP on the comment object.", wp, ["src/wp-includes/class-wp-comment.php"]),
            item("wordpress-rest-username-schema", "data_item:username", "username", "src/wp-includes/rest-api/endpoints/class-wp-rest-users-controller.php", 1410, 1418, ["user_identifier"], "REST user schema username is the account login name.", wp),
            item("wordpress-rest-password-schema", "data_item:password", "password", "src/wp-includes/rest-api/endpoints/class-wp-rest-users-controller.php", 1505, 1513, ["credential_secret"], "REST user schema password is the submitted plaintext password (never returned).", wp),
            item("wordpress-rest-prepare-email", "data_item:user_email", "user_email", "src/wp-includes/rest-api/endpoints/class-wp-rest-users-controller.php", 1180, 1181, ["email_address"], "prepare_item_for_database copies request email onto user_email.", wp),
            item("wordpress-rest-comment-author-email-schema", "data_item:author_email", "author_email", "src/wp-includes/rest-api/endpoints/class-wp-rest-comments-controller.php", 1516, 1525, ["email_address"], "Comment REST schema author_email is the commenter's mailbox.", wp, ["src/wp-includes/rest-api/endpoints/class-wp-rest-comments-controller.php"]),
            item("wordpress-rest-comment-author-ip-schema", "data_item:author_ip", "author_ip", "src/wp-includes/rest-api/endpoints/class-wp-rest-comments-controller.php", 1526, 1531, ["user_identifier"], "Comment REST schema author_ip is the commenter's IP address.", wp, ["src/wp-includes/rest-api/endpoints/class-wp-rest-comments-controller.php"]),
            item("wordpress-rest-comment-author-name-schema", "data_item:author_name", "author_name", "src/wp-includes/rest-api/endpoints/class-wp-rest-comments-controller.php", 1532, 1539, ["person_name"], "Comment REST schema author_name is the commenter's display name.", wp, ["src/wp-includes/rest-api/endpoints/class-wp-rest-comments-controller.php"]),
            item("wordpress-application-password-plaintext", "data_item:new_password", "new_password", "src/wp-includes/class-wp-application-passwords.php", 98, 98, ["credential_secret"], "wp_generate_password produces the plaintext application password before hashing.", wp, ["src/wp-includes/class-wp-application-passwords.php"]),
            item("wordpress-application-password-uuid", "data_item:uuid", "uuid", "src/wp-includes/class-wp-application-passwords.php", 102, 102, ["user_identifier"], "uuid uniquely identifies a stored application-password credential.", wp, ["src/wp-includes/class-wp-application-passwords.php"]),
        ],
    )
    n += append(
        "discourse",
        [
            item("discourse-email-token-email", "data_item:email", "email", "app/models/email_token.rb", 109, 109, ["email_address"], "email_tokens.email is the mailbox being confirmed or reset.", dc, ["app/models/email_token.rb"]),
            item("discourse-email-token-hash", "data_item:token_hash", "token_hash", "app/models/email_token.rb", 112, 112, ["access_token"], "email_tokens.token_hash stores the hashed email confirmation token.", dc, ["app/models/email_token.rb"]),
            item("discourse-email-token-raw", "data_item:token", "token", "app/models/email_token.rb", 45, 48, ["access_token"], "EmailToken#token exposes the unhashed confirmation token until persist.", dc, ["app/models/email_token.rb"]),
            item("discourse-auth-token-hash", "data_item:auth_token", "auth_token", "app/models/user_auth_token.rb", 301, 301, ["access_token"], "user_auth_tokens.auth_token is the hashed session cookie token.", dc, ["app/models/user_auth_token.rb"]),
            item("discourse-auth-token-client-ip", "data_item:client_ip", "client_ip", "app/models/user_auth_token.rb", 304, 304, ["user_identifier"], "user_auth_tokens.client_ip records the session client address.", dc, ["app/models/user_auth_token.rb"]),
            item("discourse-unhashed-auth-token", "data_item:unhashed_auth_token", "unhashed_auth_token", "app/models/user_auth_token.rb", 22, 22, ["access_token"], "unhashed_auth_token holds the raw session token before hashing.", dc, ["app/models/user_auth_token.rb"]),
            item("discourse-sso-external-email", "data_item:external_email", "external_email", "app/models/single_sign_on_record.rb", 16, 16, ["email_address"], "SSO records store the identity-provider email.", dc, ["app/models/single_sign_on_record.rb"]),
            item("discourse-sso-external-name", "data_item:external_name", "external_name", "app/models/single_sign_on_record.rb", 17, 17, ["person_name"], "SSO records store the identity-provider display name.", dc, ["app/models/single_sign_on_record.rb"]),
            item("discourse-sso-external-username", "data_item:external_username", "external_username", "app/models/single_sign_on_record.rb", 19, 19, ["user_identifier"], "SSO records store the identity-provider username.", dc, ["app/models/single_sign_on_record.rb"]),
            item("discourse-sso-external-id", "data_item:external_id", "external_id", "app/models/single_sign_on_record.rb", 23, 23, ["user_identifier"], "SSO external_id is the unique identity-provider subject.", dc, ["app/models/single_sign_on_record.rb"]),
            item("discourse-incoming-from-address", "data_item:from_address", "from_address", "app/models/incoming_email.rb", 82, 82, ["email_address"], "incoming_emails.from_address is the sender mailbox of inbound mail.", dc, ["app/models/incoming_email.rb"]),
            item("discourse-email-change-new-email", "data_item:new_email", "new_email", "app/models/email_change_request.rb", 39, 39, ["email_address"], "email_change_requests.new_email is the mailbox being switched to.", dc, ["app/models/email_change_request.rb"]),
            item("discourse-screened-email", "data_item:email", "email", "app/models/screened_email.rb", 77, 77, ["email_address"], "screened_emails.email is a watched signup mailbox.", dc, ["app/models/screened_email.rb"]),
            item("discourse-unsubscribe-key", "data_item:key", "key", "app/models/unsubscribe_key.rb", 61, 61, ["access_token"], "unsubscribe_keys.key is a secret one-click unsubscribe token.", dc, ["app/models/unsubscribe_key.rb"]),
            item("discourse-totp-data", "data_item:data", "data", "app/models/user_second_factor.rb", 53, 53, ["credential_secret"], "user_second_factors.data stores TOTP secret or backup-code material.", dc, ["app/models/user_second_factor.rb"]),
            item("discourse-webauthn-credential-id", "data_item:credential_id", "credential_id", "app/models/user_security_key.rb", 43, 43, ["user_identifier"], "user_security_keys.credential_id uniquely identifies a passkey.", dc, ["app/models/user_security_key.rb"]),
        ],
    )
    n += append(
        "magento",
        [
            item("magento-address-company", "data_item:company", "company", "app/code/Magento/Customer/Api/Data/AddressInterface.php", 135, 135, ["employment_information"], "AddressInterface::getCompany is the organization name on a customer address.", mg, ["app/code/Magento/Customer/Api/Data/AddressInterface.php"]),
            item("magento-address-fax", "data_item:fax", "fax", "app/code/Magento/Customer/Api/Data/AddressInterface.php", 165, 165, ["phone_number"], "AddressInterface::getFax is a fax telephone number on the address.", mg, ["app/code/Magento/Customer/Api/Data/AddressInterface.php"]),
            item("magento-address-prefix", "data_item:address_prefix", "prefix", "app/code/Magento/Customer/Api/Data/AddressInterface.php", 255, 255, ["person_name"], "Address prefix is an honorific name part on the postal address.", mg, ["app/code/Magento/Customer/Api/Data/AddressInterface.php"]),
            item("magento-address-suffix", "data_item:address_suffix", "suffix", "app/code/Magento/Customer/Api/Data/AddressInterface.php", 270, 270, ["person_name"], "Address suffix is a name suffix on the postal address.", mg, ["app/code/Magento/Customer/Api/Data/AddressInterface.php"]),
            item("magento-address-vat-id", "data_item:vat_id", "vatId", "app/code/Magento/Customer/Api/Data/AddressInterface.php", 285, 285, ["national_identifier"], "AddressInterface::getVatId is a tax/VAT identifier on the address.", mg, ["app/code/Magento/Customer/Api/Data/AddressInterface.php"]),
        ],
    )
    n += append(
        "ghost",
        [
            item("ghost-staff-user-slug", "data_item:slug", "slug", "ghost/core/core/server/data/schema/schema.js", 272, 272, ["user_identifier"], "users.slug is the unique staff profile slug.", gh),
            item("ghost-staff-location", "data_item:location", "location", "ghost/core/core/server/data/schema/schema.js", 295, 300, ["residence_information"], "users.location is free-text staff location on the profile.", gh),
            item("ghost-invite-token", "data_item:invite_token", "token", "ghost/core/core/server/data/schema/schema.js", 499, 499, ["access_token"], "invites.token is the unique staff-invite redemption secret.", gh),
            item("ghost-invite-email", "data_item:invite_email", "email", "ghost/core/core/server/data/schema/schema.js", 500, 506, ["email_address"], "invites.email is the invited staff member's mailbox.", gh),
            item("ghost-session-id", "data_item:session_id", "session_id", "ghost/core/core/server/data/schema/schema.js", 520, 520, ["access_token"], "sessions.session_id is the unique staff session cookie identifier.", gh),
            item("ghost-member-geolocation", "data_item:geolocation", "geolocation", "ghost/core/core/server/data/schema/schema.js", 673, 673, ["residence_information"], "members.geolocation stores member location derived from IP.", gh),
            item("ghost-token-value", "data_item:token", "token", "ghost/core/core/server/data/schema/schema.js", 1680, 1680, ["access_token"], "tokens.token is a stored member/auth token value.", gh),
        ],
    )
    n += append(
        "nopcommerce",
        [
            item("nopcommerce-street-address-2", "data_item:StreetAddress2", "StreetAddress2", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 64, 64, ["street_address"], "Customer.StreetAddress2 is the secondary street line.", np),
            item("nopcommerce-county", "data_item:County", "County", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 79, 79, ["address_region"], "Customer.County is the county/region on the customer profile.", np),
            item("nopcommerce-fax", "data_item:Fax", "Fax", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 104, 104, ["phone_number"], "Customer.Fax is a fax telephone number on the profile.", np),
            item("nopcommerce-vat-number", "data_item:VatNumber", "VatNumber", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 109, 109, ["national_identifier"], "Customer.VatNumber is a tax identifier stored on the account.", np),
            item("nopcommerce-company", "data_item:Company", "Company", "src/Libraries/Nop.Core/Domain/Customers/Customer.cs", 54, 54, ["employment_information"], "Customer.Company is the organization name on the storefront profile.", np),
        ],
    )
    n += append(
        "spree",
        [
            item("spree-address-firstname", "data_item:firstname", "firstname", "spree/core/app/models/spree/address.rb", 81, 81, ["person_name"], "Address.firstname is the given name required on a postal address.", sp, ["spree/core/app/models/spree/address.rb"]),
            item("spree-address-lastname", "data_item:lastname", "lastname", "spree/core/app/models/spree/address.rb", 81, 81, ["person_name"], "Address.lastname is the family name required on a postal address.", sp, ["spree/core/app/models/spree/address.rb"]),
            item("spree-address-city", "data_item:city", "city", "spree/core/app/models/spree/address.rb", 83, 83, ["city"], "Address.city is the required locality on a postal address.", sp, ["spree/core/app/models/spree/address.rb"]),
            item("spree-address-phone", "data_item:phone", "phone", "spree/core/app/models/spree/address.rb", 85, 85, ["phone_number"], "Address.phone is the contact telephone on a postal address.", sp, ["spree/core/app/models/spree/address.rb"]),
        ],
    )
    n += append(
        "orchard-core",
        [
            item("orchard-user-name", "data_item:UserName", "UserName", "src/OrchardCore/OrchardCore.Users.Core/Models/User.cs", 12, 12, ["user_identifier"], "User.UserName is the account login name.", oc),
            item("orchard-normalized-email", "data_item:NormalizedEmail", "NormalizedEmail", "src/OrchardCore/OrchardCore.Users.Core/Models/User.cs", 20, 20, ["email_address"], "User.NormalizedEmail is the canonical mailbox used for lookup.", oc),
            item("orchard-security-stamp", "data_item:SecurityStamp", "SecurityStamp", "src/OrchardCore/OrchardCore.Users.Core/Models/User.cs", 24, 24, ["access_token"], "User.SecurityStamp is the identity stamp used to invalidate sessions.", oc),
        ],
    )
    n += append(
        "strapi",
        [
            item("strapi-username", "data_item:username", "username", "packages/core/admin/server/src/content-types/User.ts", 33, 38, ["user_identifier"], "Admin User.username is an optional login identifier.", st),
            item("strapi-api-token-access-key", "data_item:accessKey", "accessKey", "packages/core/admin/server/src/content-types/api-token.ts", 50, 56, ["access_token"], "Api Token accessKey is the stored API credential string.", st, ["packages/core/admin/server/src/content-types/api-token.ts"]),
            item("strapi-api-token-encrypted-key", "data_item:encryptedKey", "encryptedKey", "packages/core/admin/server/src/content-types/api-token.ts", 57, 63, ["credential_secret"], "Api Token encryptedKey is the encrypted form of the API key.", st, ["packages/core/admin/server/src/content-types/api-token.ts"]),
        ],
    )
    n += append(
        "directus",
        [
            item("directus-external-identifier", "data_item:external_identifier", "external_identifier", "api/src/types/auth.ts", 16, 16, ["user_identifier"], "User.external_identifier is the identity-provider subject for the account.", dx),
            item("directus-session-token-type", "data_item:token", "token", "api/src/types/auth.ts", 25, 25, ["access_token"], "Session.token is the session cookie/token string.", dx),
            item("directus-share-password", "data_item:share_password", "share_password", "api/src/types/auth.ts", 48, 48, ["credential_secret"], "ShareData.share_password is an optional password protecting a share link.", dx),
        ],
    )
    n += append(
        "pocketbase",
        [
            item("pocketbase-set-password", "data_item:password", "password", "core/record_model_auth.go", 50, 54, ["credential_secret"], "SetPassword writes a plaintext password onto the auth record before hashing.", pb),
            item("pocketbase-smtp-username", "data_item:Username", "Username", "core/settings_model.go", 366, 366, ["user_identifier"], "SMTP Username is the mailbox/login used to send mail from the app.", pb, ["core/settings_model.go"]),
        ],
    )
    n += append(
        "redmine",
        [
            item("redmine-remote-ip", "data_item:remote_ip", "remote_ip", "app/models/user.rb", 120, 120, ["user_identifier"], "User#remote_ip is the transient client IP used during login.", rm),
        ],
    )
    n += append(
        "easy-school",
        [
            item("easy-school-guardian-profession", "data_item:profession", "profession", "students/models.py", 63, 63, ["employment_information"], "Guardian.profession is the parent or guardian's occupation.", es),
        ],
    )
    n += append(
        "supabase-js",
        [
            item("supabase-js-new-email", "data_item:new_email", "new_email", "packages/core/auth-js/src/lib/types.ts", 499, 499, ["email_address"], "User.new_email is the pending mailbox during email change.", sb),
            item("supabase-js-phone", "data_item:phone", "phone", "packages/core/auth-js/src/lib/types.ts", 504, 504, ["phone_number"], "User.phone is the account telephone number.", sb),
            item("supabase-js-new-phone", "data_item:new_phone", "new_phone", "packages/core/auth-js/src/lib/types.ts", 500, 500, ["phone_number"], "User.new_phone is the pending telephone during phone change.", sb),
        ],
    )
    print(f"added {n} data_items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
