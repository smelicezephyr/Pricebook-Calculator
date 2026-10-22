---
name: Google sign-in access policy
description: Durable product requirements for matching Google accounts and granting initial access.
---

Match returning Google users by Google's stable subject identifier, not by email. Do not merge accounts just because email addresses match. New Google accounts receive the non-admin user role, private settings, and no tenant access inferred from an email domain; tenant access is explicit.

**Why:** The product owner requires personal and any organization's Google accounts to authenticate into a private workspace without granting access to another user's pricing data, existing tenants, or administrative permissions.

**How to apply:** Keep these constraints when changing OAuth provisioning, account linking, or tenant-access assignment. Provision new accounts as ordinary users with user-owned settings and no tenant assignments; preserve existing role and access records unless an administrator explicitly changes them.
