#!/usr/bin/env python3
"""Generate manifest.yaml files for the corpus expansion repos."""
import os
import sys

REPOS_ROOT = os.path.join(os.path.dirname(__file__), "..", "tests", "benchmark", "repos")

# repo_key, repository, commit, license, include_paths, languages, domains
REPOS = [
    ("discourse", "discourse/discourse", "768a4ed1cd8e6742fe1c1340a9c4ab01318285ec", "GPL-2.0-or-later",
     ["app/models/", "config/"], ["ruby"], ["forum", "identity"]),
    ("redmine", "redmine/redmine", "2308cb59cca772d5857f3126a344658cf08efc1b", "GPL-2.0-or-later",
     ["app/models/", "config/"], ["ruby"], ["project_management", "identity"]),
    ("wordpress", "WordPress/wordpress-develop", "98c9e238b806042f83836549f6a2b1f112721e07", "GPL-2.0-or-later",
     ["src/wp-includes/"], ["php"], ["cms", "identity"]),
    ("magento", "magento/magento2", "3a6b9667113729b21b48623687fc01b3f2d8a026", "OSL-3.0",
     ["app/code/Magento/Customer/"], ["php"], ["ecommerce", "identity"]),
    ("nopcommerce", "nopSolutions/nopCommerce", "2f9efdb213d0f4f219a2633302e6b533720d4724", "LicenseRef-LGPL-3.0",
     ["src/"], ["csharp"], ["ecommerce", "identity"]),
    ("orchard-core", "OrchardCMS/OrchardCore", "3dc6303d2c1170872e88bd338a42642e68babe64", "BSD-3-Clause",
     ["src/OrchardCore/"], ["csharp"], ["cms", "identity"]),
    ("spring-petclinic", "spring-projects/spring-petclinic", "818c4136ea971c21674525f9053de0d9c7ad8cfe", "Apache-2.0",
     ["src/main/java/org/springframework/samples/petclinic/"], ["java"], ["example", "identity"]),
    ("pocketbase", "pocketbase/pocketbase", "bc8ffed4e7265a70a6e8de76c0b0b48b945e19ef", "MIT",
     ["core/"], ["go"], ["baas", "identity"]),
    ("ghost", "TryGhost/Ghost", "73612b18663c0145dcca8611904b7f21b5f84552", "MIT",
     ["ghost/server/services/members/", "ghost/server/models/"], ["javascript"], ["cms", "identity"]),
    ("directus", "directus/directus", "a6c460a765c590c15b2e4d71e820247cbc25179e", "LicenseRef-Proprietary",
     ["api/"], ["typescript"], ["baas", "identity"]),
    ("spree", "spree/spree", "e6e9823b79177d49e1682e31482a9da5d9139140", "BSD-3-Clause",
     ["core/app/models/"], ["ruby"], ["ecommerce", "identity"]),
    ("strapi", "strapi/strapi", "aaff8e8faf9f84c899eda58fe7477633aa35b817", "MIT",
     ["packages/core/"], ["typescript"], ["cms", "identity"]),
    ("flask-login", "maxcountryman/flask-login", "c8bba84b9ba6768e878317fc46c54bd13fa1ac07", "MIT",
     ["src/flask_login/"], ["python"], ["identity", "auth"]),
    ("exposed", "JetBrains/Exposed", "4be9aee04c4751ca141c034ff6b41ed5f8339916", "Apache-2.0",
     ["exposed-core/src/main/kotlin/"], ["kotlin"], ["orm", "database"]),
    ("vapor", "vapor/vapor", "cf330f6558504b8e2acafb1ac253094d8f7ca75e", "MIT",
     ["Sources/Vapor/Authentication/"], ["swift"], ["web", "auth"]),
    ("supabase-js", "supabase/supabase-js", "b3b939a405ae663aea2fabecfa4dfcc6161d155a", "MIT",
     ["packages/"], ["typescript"], ["baas", "identity"]),
    ("auth0-express", "auth0/express-openid-connect", "9cdf98448485a4e36c11429a8be8d97549ac7727", "MIT",
     ["lib/"], ["typescript"], ["identity", "auth"]),
    ("drupal", "drupal/drupal", "141cdc1f0a359bbb277bdc08c67ba03784a9fae1", "GPL-2.0-or-later",
     ["core/modules/user/"], ["php"], ["cms", "identity"]),
    ("medusa", "medusajs/medusa", "f7317903600e5b64f06c21c29a73e0e569d2fe3a", "MIT",
     ["packages/medusa/src/models/", "packages/medusa/src/services/"], ["typescript"], ["ecommerce", "identity"]),
]


def main():
    for repo_key, repository, commit, license, include, languages, domains in REPOS:
        repo_dir = os.path.join(REPOS_ROOT, repo_key)
        os.makedirs(os.path.join(repo_dir, "annotations"), exist_ok=True)
        manifest_path = os.path.join(repo_dir, "manifest.yaml")
        lines = [
            f"repository: {repository}",
            f"commit: {commit}",
            f"license: {license}",
            "scope:",
            "  include:",
        ]
        for path in include:
            lines.append(f"    - {path}")
        lines += [
            "coverage:",
            "  layers: [data_items, components, data_flows, raw_hits, mentions]",
            "  languages:",
        ]
        for lang in languages:
            lines.append(f"    - {lang}")
        lines += [
            "  domains:",
        ]
        for domain in domains:
            lines.append(f"    - {domain}")
        lines += [
            "selection_rationale: >-",
            f"  Corpus expansion repo covering {', '.join(languages)} with PII/credential/flow patterns.",
            "annotation_version: 1",
        ]
        with open(manifest_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"  {repo_key}: manifest.yaml created")
    print(f"\nTotal: {len(REPOS)} manifests created")
    return 0


if __name__ == "__main__":
    sys.exit(main())
