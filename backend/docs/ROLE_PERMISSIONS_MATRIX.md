# 🔐 Role-Permission Matrix Reference

This document details the capability mapping across Global and Workspace-level roles in Oraculum.

## 🌐 Global Roles

| Permission | `SUPER_ADMIN` | `ADMIN` | `USER` |
| :--- | :---: | :---: | :---: |
| `manage:users` | ✅ | ✅ | ❌ |
| `view:audit_logs` | ✅ | ✅ | ❌ |
| `manage:system_settings` | ✅ | ❌ | ❌ |

---

## 🏢 Workspace Roles

| Permission | `OWNER` | `ADMIN` | `MEMBER` | `GUEST` |
| :--- | :---: | :---: | :---: | :---: |
| `workspace:view` | ✅ | ✅ | ✅ | ✅ |
| `workspace:member:invite` | ✅ | ✅ | ✅ | ❌ |
| `workspace:member:remove` | ✅ | ✅ | ❌ | ❌ |
| `workspace:update` | ✅ | ✅ | ❌ | ❌ |
| `workspace:role:update` | ✅ | ❌ | ❌ | ❌ |
| `workspace:delete` | ✅ | ❌ | ❌ | ❌ |