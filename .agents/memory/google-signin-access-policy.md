---
name: Google sign-in access policy
description: Durable product requirements for matching Google accounts and granting initial access.
---

Match returning Google users by Google's stable subject identifier, not by email. Do not merge accounts just because email addresses match. New Google accounts receive the restricted default role and no tenant access inferred from an email domain; tenant access is explicit.

**Why:** The product owner requires personal and any organization's Google accounts to authenticate without granting a new account access to another user's pricing data or administrative permissions.

**How to apply:** Keep these constraints when changing OAuth provisioning, account linking, or tenant-access assignment. Preserve existing role and access records unless an administrator explicitly changes them.
